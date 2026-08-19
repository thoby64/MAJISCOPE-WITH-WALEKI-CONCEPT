import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { NextResponse } from "next/server"

const execFileAsync = promisify(execFile)
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const ENVELOPE_BYTE_LENGTHS = [0, 32, 48, 48, 64]

type CoordinatePoint = {
  latitude: number
  longitude: number
}

type BoundaryPolygon = CoordinatePoint[][]

type GeometryLayer = {
  tableName: string
  columnName: string
  geometryTypeName: string
  srsId: string
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

async function runSqlite(databasePath: string, query: string) {
  const { stdout } = await execFileAsync("sqlite3", [databasePath, query], {
    maxBuffer: 24 * 1024 * 1024,
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

function parseWkbGeometry(buffer: Buffer, startOffset: number): { polygons: BoundaryPolygon[]; offset: number } {
  let offset = startOffset
  const littleEndian = buffer.readUInt8(offset) === 1
  offset += 1

  const rawGeometryType = readUInt32(buffer, offset, littleEndian)
  offset += 4

  const geometryType = baseGeometryType(rawGeometryType)
  const dimensions = coordinateDimensions(rawGeometryType)
  const polygons: BoundaryPolygon[] = []

  if (geometryType === 3) {
    const ringCount = readUInt32(buffer, offset, littleEndian)
    offset += 4

    const polygon: BoundaryPolygon = []
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
      polygon.push(ring)
    }

    polygons.push(polygon)
  } else if (geometryType === 6) {
    const polygonCount = readUInt32(buffer, offset, littleEndian)
    offset += 4

    for (let polygonIndex = 0; polygonIndex < polygonCount; polygonIndex += 1) {
      const parsed = parseWkbGeometry(buffer, offset)
      offset = parsed.offset
      polygons.push(...parsed.polygons)
    }
  } else {
    throw new Error(`Unsupported utility boundary geometry type: ${geometryType}`)
  }

  return { polygons, offset }
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
  return parseWkbGeometry(buffer, wkbOffset).polygons
}

function closeRing(ring: CoordinatePoint[]) {
  const validRing = ring.filter(
    (point) =>
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      point.latitude >= -90 &&
      point.latitude <= 90 &&
      point.longitude >= -180 &&
      point.longitude <= 180
  )

  if (validRing.length < 3) return []

  const first = validRing[0]
  const last = validRing[validRing.length - 1]
  const closed =
    first.latitude === last.latitude && first.longitude === last.longitude
      ? validRing
      : [...validRing, first]

  return closed.map((point) => [point.longitude, point.latitude])
}

function normalizePolygons(polygons: BoundaryPolygon[]) {
  return polygons
    .map((polygon) =>
      polygon
        .map(closeRing)
        .filter((ring) => ring.length >= 4)
    )
    .filter((polygon) => polygon.length > 0)
}

function extractPolygonsFromGeoJson(input: unknown): BoundaryPolygon[] {
  const polygons: BoundaryPolygon[] = []

  const pointFromCoordinate = (point: unknown): CoordinatePoint | null => {
    if (!Array.isArray(point) || point.length < 2) return null
    const longitude = Number(point[0])
    const latitude = Number(point[1])
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
    return { latitude, longitude }
  }

  const polygonFromCoordinates = (coordinates: unknown): BoundaryPolygon | null => {
    if (!Array.isArray(coordinates)) return null
    const polygon = coordinates
      .map((ring) => (Array.isArray(ring) ? ring.map(pointFromCoordinate).filter(Boolean) : []))
      .filter((ring) => ring.length >= 3) as BoundaryPolygon
    return polygon.length ? polygon : null
  }

  const visitGeometry = (geometry: any) => {
    if (!geometry || typeof geometry !== "object") return

    if (geometry.type === "Polygon") {
      const polygon = polygonFromCoordinates(geometry.coordinates)
      if (polygon) polygons.push(polygon)
      return
    }

    if (geometry.type === "MultiPolygon") {
      if (Array.isArray(geometry.coordinates)) {
        geometry.coordinates.forEach((coordinates: unknown) => {
          const polygon = polygonFromCoordinates(coordinates)
          if (polygon) polygons.push(polygon)
        })
      }
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

  return polygons
}

async function extractFromGeoPackage(filePath: string) {
  const layerOutput = await runSqlite(
    filePath,
    "select table_name || char(9) || column_name || char(9) || geometry_type_name || char(9) || srs_id from gpkg_geometry_columns;"
  )
  const layers = parseLayerRows(layerOutput)
  const polygonLayer = layers.find((layer) => layer.geometryTypeName.toUpperCase().includes("POLYGON"))

  if (!polygonLayer) {
    throw new Error("No polygon or multipolygon utility boundary layer was found in the GeoPackage.")
  }

  if (polygonLayer.srsId !== "4326") {
    throw new Error(`Unsupported GeoPackage coordinate system ${polygonLayer.srsId}. Please upload EPSG:4326 boundary data.`)
  }

  const geometryOutput = await runSqlite(
    filePath,
    `select hex(${quoteIdentifier(polygonLayer.columnName)}) from ${quoteIdentifier(polygonLayer.tableName)} where ${quoteIdentifier(polygonLayer.columnName)} is not null;`
  )

  const polygons = geometryOutput
    .split("\n")
    .filter(Boolean)
    .flatMap((hexGeometry) => parseGeoPackageGeometry(hexGeometry))

  return {
    polygons,
    layerName: polygonLayer.tableName,
    geometryType: polygonLayer.geometryTypeName,
  }
}

async function extractFromGeoJson(file: File) {
  const payload = JSON.parse(await file.text())
  return {
    polygons: extractPolygonsFromGeoJson(payload),
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
      return jsonError("Upload a utility boundary file to extract service geometry.")
    }

    if (file.size <= 0) {
      return jsonError("The uploaded boundary file is empty.")
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError("The uploaded boundary file is too large. Please use a file under 12 MB.")
    }

    const extension = path.extname(file.name).toLowerCase()
    let extracted: { polygons: BoundaryPolygon[]; layerName: string; geometryType: string }

    if (extension === ".gpkg") {
      temporaryPath = path.join(os.tmpdir(), `utility-boundary-${randomUUID()}.gpkg`)
      await fs.writeFile(temporaryPath, Buffer.from(await file.arrayBuffer()))
      extracted = await extractFromGeoPackage(temporaryPath)
    } else if (extension === ".geojson" || extension === ".json") {
      extracted = await extractFromGeoJson(file)
    } else {
      return jsonError("Unsupported boundary file. Please upload a GeoPackage (.gpkg) or GeoJSON file.")
    }

    const polygons = normalizePolygons(extracted.polygons)
    if (!polygons.length) {
      return jsonError("No usable utility service polygons were found in the uploaded file.")
    }

    const boundaryGeojson =
      polygons.length === 1
        ? { type: "Polygon" as const, coordinates: polygons[0] }
        : { type: "MultiPolygon" as const, coordinates: polygons }

    return NextResponse.json({
      boundaryGeojson,
      source: {
        fileName: file.name,
        layerName: extracted.layerName,
        geometryType: extracted.geometryType,
        polygonCount: polygons.length,
        pointCount: polygons.reduce(
          (sum, polygon) => sum + polygon.reduce((ringSum, ring) => ringSum + ring.length, 0),
          0
        ),
      },
    })
  } catch (error) {
    console.error("Utility boundary extraction failed:", error)
    return jsonError(error instanceof Error ? error.message : "Failed to extract utility boundary geometry.", 422)
  } finally {
    if (temporaryPath) {
      await fs.unlink(temporaryPath).catch(() => undefined)
    }
  }
}
