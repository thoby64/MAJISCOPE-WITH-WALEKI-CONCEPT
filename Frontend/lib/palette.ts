// ============================================================
// MajiScope — Single Source of Truth for Color
// Brand accent is cyan/sky. All other hues are reserved for
// meaning: green = good, red = bad/urgent, amber = warning,
// everything else = neutral slate. Categorical series use the
// shared chart tokens.
//
// Use these tokens everywhere. Do NOT hardcode raw hex or
// arbitrary Tailwind colors in pages/components; import from here.
// ============================================================

// ---- Brand accent (cyan / sky) ----
const accent = {
  // Primary interactive / brand color
  base: "#0891b2",
  strong: "#0e7490",
  soft: "#0ea5e9",
  // Tinted surface + text used for on/accented states in light mode
  bg: "#e0f2fe",
  bgStrong: "#cffafe",
  text: "#155e75",
  textStrong: "#0e7490",
  // Dark mode tinted surface + text
  bgDark: "rgba(8,55,75,0.35)",
  textDark: "#7dd3fc",
} as const

// ---- Semantic colors (reserved for meaning) ----
const semantic = {
  success: {
    base: "#16a34a",
    strong: "#15803d",
    soft: "#22c55e",
    bg: "#dcfce7",
    text: "#166534",
    textSoft: "#16a34a",
  },
  warning: {
    base: "#d97706",
    strong: "#b45309",
    soft: "#f59e0b",
    bg: "#fef3c7",
    text: "#92400e",
    textSoft: "#d97706",
  },
  danger: {
    base: "#dc2626",
    strong: "#b91c1c",
    soft: "#f87171",
    bg: "#fee2e2",
    text: "#991b1b",
    textSoft: "#dc2626",
  },
  neutral: {
    base: "#64748b",
    strong: "#475569",
    soft: "#94a3b8",
    bg: "#f1f5f9",
    text: "#334155",
    textSoft: "#64748b",
  },
} as const

// ---- Chart tokens (aligned with --chart-1..5 in globals.css) ----
const chart = {
  chart1: "#0891b2", // cyan — brand, primary series
  chart2: "#16a34a", // green
  chart3: "#d97706", // amber
  chart4: "#dc2626", // red
  chart5: "#2563eb", // blue
} as const

const chartSeries = Object.values(chart)

// ---- Maps ----
const map = {
  status: {
    open: { fill: "#dc2626", stroke: "#b91c1c" },
    pendingApproval: { fill: "#d97706", stroke: "#b45309" },
    resolved: { fill: "#16a34a", stroke: "#15803d" },
  },
  boundary: {
    color: "#0891b2",
    fillColor: "#0ea5e9",
  },
  boundaryLighter: {
    color: "#22d3ee",
    fillColor: "#67e8f9",
  },
  network: {
    color: "#0891b2",
    fillColor: "#0891b2",
  },
  aggregate: {
    color: "#0891b2",
    fillColor: "#0891b2",
  },
  infrastructure: {
    // Single accent for all asset icons — asset type is conveyed by icon shape
    color: "#0891b2",
    fillColor: "#0891b2",
  },
} as const

const infraDotColors = {
  // Deeper 700-series standard shades — distinct per type but not glaring.
  valves: "#1d4ed8",
  water_sources: "#0e7490",
  storage_facilities: "#b45309",
  bulk_meters: "#b91c1c",
} as const

// ---- Tailwind class tokens for badges (status / priority / entity) ----
// Classes are chosen so light mode uses a soft tinted pill and the
// globals.css dark overrides keep dark mode readable.
const STATUS_BADGE_CLASSES = {
  accent: "border-cyan-200 bg-cyan-50 text-cyan-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  neutral: "border-slate-200 bg-slate-100 text-slate-600",
} as const

export const PALETTE = {
  accent,
  semantic,
  chart,
  chartSeries,
  map,
  infraDotColors,
  STATUS_BADGE_CLASSES,
} as const

export type PaletteAccent = keyof typeof accent
export type PaletteSemantic = keyof typeof semantic