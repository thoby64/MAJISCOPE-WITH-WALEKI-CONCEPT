import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { NextResponse } from "next/server"

const execFileAsync = promisify(execFile)
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

type CoordinatePoint = {
  latitude: number
  longitude: number
}

type GeometryLayer = {
  tableName: string
  columnName: string
  geometryTypeName: string
  srsId: string
}

const ENVELOPE_BYTE_LENGTHS = [0, 32, 48, 48, 64]

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

async function runSqlite(databasePath: string, query: string) {
  const { stdout } = await execFileAsync("sqlite3", [databasePath, query], {
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout.trim()
}

function parseLayerRows(output: string): GeometryLayer[] {
  if (!output) return []

  return output
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length >= 4)
    .map(([tableName, columnName, geometryTypeName, srsId]) => ({
      tableName,
      columnName,
      geometryTypeName,
      srsId,
    }))
}

function readUInt32(buffer: Buffer, offset: number, littleEndian: boolean) {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset)
}

function readDouble(buffer: Buffer, offset: number, littleEndian: boolean) {
  return littleEndian ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset)
}

function coordinateDimensions(rawGeometryType: number) {
  if (rawGeometryType >= 3000) return 4
  if (rawGeometryType >= 1000) return 3
  return 2
}

function baseGeometryType(rawGeometryType: number) {
  return rawGeometryType % 1000
}

function parseWkbGeometry(buffer: Buffer, startOffset: number): { rings: CoordinatePoint[][]; offset: number } {
  let offset = startOffset
  const littleEndian = buffer.readUInt8(offset) === 1
  offset += 1

  const rawGeometryType = readUInt32(buffer, offset, littleEndian)
  offset += 4

  const geometryType = baseGeometryType(rawGeometryType)
  const dimensions = coordinateDimensions(rawGeometryType)
  const rings: CoordinatePoint[][] = []

  if (geometryType === 3) {
    const ringCount = readUInt32(buffer, offset, littleEndian)
    offset += 4

    for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
      const pointCount = readUInt32(buffer, offset, littleEndian)
      offset += 4

      const ring: CoordinatePoint[] = []
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const longitude = readDouble(buffer, offset, littleEndian)
        const latitude = readDouble(buffer, offset + 8, littleEndian)
        offset += dimensions * 8
        ring.push({ latitude, longitude })
      }

      if (ringIndex === 0) {
        rings.push(ring)
      }
    }
  } else if (geometryType === 6) {
    const polygonCount = readUInt32(buffer, offset, littleEndian)
    offset += 4

    for (let polygonIndex = 0; polygonIndex < polygonCount; polygonIndex += 1) {
      const parsed = parseWkbGeometry(buffer, offset)
      offset = parsed.offset
      rings.push(...parsed.rings)
    }
  } else {
    throw new Error(`Unsupported boundary geometry type: ${geometryType}`)
  }

  return { rings, offset }
}

function parseGeoPackageGeometry(hexGeometry: string) {
  const buffer = Buffer.from(hexGeometry, "hex")
  if (buffer.length < 8 || buffer.toString("ascii", 0, 2) !== "GP") {
    throw new Error("Invalid GeoPackage geometry header")
  }

  const flags = buffer.readUInt8(3)
  const envelopeIndicator = (flags >> 1) & 0b111
  const envelopeBytes = ENVELOPE_BYTE_LENGTHS[envelopeIndicator]
  if (envelopeBytes === undefined) {
    throw new Error("Unsupported GeoPackage envelope")
  }

  const wkbOffset = 8 + envelopeBytes
  return parseWkbGeometry(buffer, wkbOffset).rings
}

function normalizeRing(ring: CoordinatePoint[]) {
  if (ring.length > 1) {
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first.latitude === last.latitude && first.longitude === last.longitude) {
      return ring.slice(0, -1)
    }
  }
  return ring
}

function polygonArea(ring: CoordinatePoint[]) {
  let area = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]
    area += current.longitude * next.latitude - next.longitude * current.latitude
  }
  return Math.abs(area / 2)
}

function calculateCenter(points: CoordinatePoint[]) {
  let twiceArea = 0
  let longitudeSum = 0
  let latitudeSum = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const cross = current.longitude * next.latitude - next.longitude * current.latitude
    twiceArea += cross
    longitudeSum += (current.longitude + next.longitude) * cross
    latitudeSum += (current.latitude + next.latitude) * cross
  }

  if (Math.abs(twiceArea) > 1e-12) {
    return {
      latitude: latitudeSum / (3 * twiceArea),
      longitude: longitudeSum / (3 * twiceArea),
    }
  }

  return {
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
  }
}

function selectBoundaryRing(rings: CoordinatePoint[][]) {
  return rings
    .map(normalizeRing)
    .filter((ring) => ring.length >= 3)
    .sort((left, right) => polygonArea(right) - polygonArea(left))[0]
}

function extractRingsFromGeoJson(input: unknown): CoordinatePoint[][] {
  const rings: CoordinatePoint[][] = []

  const visitGeometry = (geometry: any) => {
    if (!geometry || typeof geometry !== "object") return

    if (geometry.type === "Polygon") {
      const exterior = geometry.coordinates?.[0]
      if (Array.isArray(exterior)) {
        rings.push(
          exterior
            .filter((point: unknown) => Array.isArray(point) && point.length >= 2)
            .map((point: number[]) => ({ longitude: Number(point[0]), latitude: Number(point[1]) }))
        )
      }
      return
    }

    if (geometry.type === "MultiPolygon") {
      geometry.coordinates?.forEach((polygon: number[][][]) => {
        const exterior = polygon?.[0]
        if (Array.isArray(exterior)) {
          rings.push(
            exterior
              .filter((point: unknown) => Array.isArray(point) && point.length >= 2)
              .map((point: number[]) => ({ longitude: Number(point[0]), latitude: Number(point[1]) }))
          )
        }
      })
      return
    }

    if (geometry.type === "GeometryCollection") {
      geometry.geometries?.forEach(visitGeometry)
    }
  }

  const value = input as any
  if (value?.type === "FeatureCollection") {
    value.features?.forEach((feature: any) => visitGeometry(feature?.geometry))
  } else if (value?.type === "Feature") {
    visitGeometry(value.geometry)
  } else {
    visitGeometry(value)
  }

  return rings
}

async function extractFromGeoPackage(filePath: string) {
  const layerOutput = await runSqlite(
    filePath,
    "select table_name || char(9) || column_name || char(9) || geometry_type_name || char(9) || srs_id from gpkg_geometry_columns;"
  )
  const layers = parseLayerRows(layerOutput)
  const polygonLayer = layers.find((layer) => layer.geometryTypeName.toUpperCase().includes("POLYGON"))

  if (!polygonLayer) {
    throw new Error("No polygon or multipolygon boundary layer was found in the GeoPackage.")
  }

  if (polygonLayer.srsId !== "4326") {
    throw new Error(`Unsupported GeoPackage coordinate system ${polygonLayer.srsId}. Please upload EPSG:4326 boundary data.`)
  }

  const geometryOutput = await runSqlite(
    filePath,
    `select hex(${quoteIdentifier(polygonLayer.columnName)}) from ${quoteIdentifier(polygonLayer.tableName)} where ${quoteIdentifier(polygonLayer.columnName)} is not null;`
  )

  const rings = geometryOutput
    .split("\n")
    .filter(Boolean)
    .flatMap((hexGeometry) => parseGeoPackageGeometry(hexGeometry))

  return {
    rings,
    layerName: polygonLayer.tableName,
    geometryType: polygonLayer.geometryTypeName,
  }
}

async function extractFromGeoJson(file: File) {
  const payload = JSON.parse(await file.text())
  return {
    rings: extractRingsFromGeoJson(payload),
    layerName: "GeoJSON",
    geometryType: "POLYGON",
  }
}

export async function POST(request: Request) {
  let temporaryPath: string | null = null

  try {
    const formData = await request.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return jsonError("Upload a boundary file to extract DMA geometry.")
    }

    if (file.size <= 0) {
      return jsonError("The uploaded boundary file is empty.")
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError("The uploaded boundary file is too large. Please use a file under 12 MB.")
    }

    const extension = path.extname(file.name).toLowerCase()
    let extracted: { rings: CoordinatePoint[][]; layerName: string; geometryType: string }

    if (extension === ".gpkg") {
      temporaryPath = path.join(os.tmpdir(), `dma-boundary-${randomUUID()}.gpkg`)
      await fs.writeFile(temporaryPath, Buffer.from(await file.arrayBuffer()))
      extracted = await extractFromGeoPackage(temporaryPath)
    } else if (extension === ".geojson" || extension === ".json") {
      extracted = await extractFromGeoJson(file)
    } else {
      return jsonError("Unsupported boundary file. Please upload a GeoPackage (.gpkg) or GeoJSON file.")
    }

    const boundaryPoints = selectBoundaryRing(extracted.rings)
    if (!boundaryPoints || boundaryPoints.length < 3) {
      return jsonError("No usable polygon boundary points were found in the uploaded file.")
    }

    const center = calculateCenter(boundaryPoints)

    return NextResponse.json({
      center,
      boundaryPoints,
      source: {
        fileName: file.name,
        layerName: extracted.layerName,
        geometryType: extracted.geometryType,
        pointCount: boundaryPoints.length,
      },
    })
  } catch (error) {
    console.error("DMA boundary extraction failed:", error)
    return jsonError(error instanceof Error ? error.message : "Failed to extract DMA boundary geometry.", 422)
  } finally {
    if (temporaryPath) {
      await fs.unlink(temporaryPath).catch(() => undefined)
    }
  }
}
