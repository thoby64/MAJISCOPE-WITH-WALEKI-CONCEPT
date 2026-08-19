export interface InfrastructureIconPath {
  d: string
  strokeWidth?: number
  strokeLinecap?: "round" | "butt"
  strokeLinejoin?: "round" | "miter"
}

export interface InfrastructureIconDef {
  viewBox: string
  paths: InfrastructureIconPath[]
}

export const INFRASTRUCTURE_ICONS: Record<string, InfrastructureIconDef> = {
  infrastructure_upload: {
    viewBox: "0 0 21 21",
    paths: [
      { d: "M4 14h13", strokeWidth: 1.8, strokeLinecap: "round" },
      { d: "M7.5 14v3.5M13.5 14v3.5", strokeWidth: 1.8, strokeLinecap: "round" },
      { d: "M6.5 17.5h2M12.5 17.5h2", strokeWidth: 1.8, strokeLinecap: "round" },
      { d: "M7.2 9 10.5 5.8l3.3 3.2", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" },
      { d: "M10.5 14v-8.2", strokeWidth: 1.8, strokeLinecap: "round" },
    ],
  },
  pipe_network: {
    viewBox: "0 0 21 21",
    paths: [
      { d: "M4 7h13", strokeWidth: 1.8, strokeLinecap: "round" },
      { d: "M7.5 7v7M10.5 7v7M13.5 7v7", strokeWidth: 1.8, strokeLinecap: "round" },
      { d: "M6 14h3M9 14h3M12 14h3", strokeWidth: 1.8, strokeLinecap: "round" },
    ],
  },
  valves: {
    viewBox: "0 0 21 21",
    paths: [
      {
        d: "M5 8.5h3.2l2.3 2.1 2.3-2.1H16v7h-3.2l-2.3-2.1-2.3 2.1H5v-7Z",
        strokeWidth: 1.8,
        strokeLinejoin: "round",
      },
      { d: "M10.5 6.2v3.6M8.5 6.2h4", strokeWidth: 1.8, strokeLinecap: "round" },
    ],
  },
  water_sources: {
    viewBox: "0 0 21 21",
    paths: [
      {
        d: "M10.5 3.8c2.8 3.1 4.2 5.3 4.2 7.3a4.2 4.2 0 1 1-8.4 0c0-2 1.4-4.2 4.2-7.3Z",
        strokeWidth: 1.8,
        strokeLinejoin: "round",
      },
    ],
  },
  storage_facilities: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11", strokeWidth: 1.8 },
      {
        d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.132-1.803l7.95-3.974a2 2 0 0 1 1.837 0l7.948 3.974A2 2 0 0 1 22 8z",
        strokeWidth: 1.8,
      },
      { d: "M6 13h12", strokeWidth: 1.8 },
      { d: "M6 17h12", strokeWidth: 1.8 },
    ],
  },
  bulk_meters: {
    viewBox: "0 0 21 21",
    paths: [
      { d: "M1.8 10.5h5.7M13.5 10.5h5.7", strokeWidth: 2.2, strokeLinecap: "round" },
      { d: "M10.5 5.2a5.3 5.3 0 1 0 0 10.6 5.3 5.3 0 1 0 0-10.6Z", strokeWidth: 1.6, strokeLinejoin: "round" },
      { d: "M10.6 10.4 13.8 7.2", strokeWidth: 2.2, strokeLinecap: "round" },
    ],
  },
}

export function getInfrastructureIconDef(assetType?: string | null): InfrastructureIconDef {
  return INFRASTRUCTURE_ICONS[assetType || ""] || INFRASTRUCTURE_ICONS.valves
}

export function infrastructureIconPathsHtml(assetType?: string | null): string {
  return getInfrastructureIconDef(assetType)
    .paths.map((path) => {
      const attributes = [
        `d="${path.d}"`,
        'fill="none"',
        'stroke="currentColor"',
        `stroke-width="${path.strokeWidth ?? 1.8}"`,
      ]
      if (path.strokeLinecap) attributes.push(`stroke-linecap="${path.strokeLinecap}"`)
      if (path.strokeLinejoin) attributes.push(`stroke-linejoin="${path.strokeLinejoin}"`)
      return `<path ${attributes.join(" ")}/>`
    })
    .join("")
}