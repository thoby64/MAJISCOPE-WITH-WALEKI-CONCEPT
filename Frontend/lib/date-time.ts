const TANZANIA_LOCALE = "en-TZ"
const TANZANIA_TIME_ZONE = "Africa/Dar_es_Salaam"

type DateInput = Date | string | number

// ISO 8601 datetime without any timezone designator ("Z" or "+hh:mm").
// The backend stores naive UTC timestamps, so such strings must be read as UTC.
// JavaScript's `new Date()` otherwise treats them as *local* time, which made
// readings appear hours off (e.g. 3h behind in Tanzania, UTC+3).
const NAIVE_ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/

export function normalizeNaiveIsoAsUtc(value: string): string {
  if (typeof value === "string" && NAIVE_ISO_DATE_TIME.test(value.trim())) {
    return `${value.trim()}Z`
  }
  return value
}

function parseDate(value: DateInput) {
  const normalised = typeof value === "string" ? normalizeNaiveIsoAsUtc(value) : value
  const date = normalised instanceof Date ? normalised : new Date(normalised)
  return Number.isNaN(date.getTime()) ? null : date
}

function safeFormat(date: Date, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat(TANZANIA_LOCALE, {
      timeZone: TANZANIA_TIME_ZONE,
      ...options,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(date)
  }
}

export function formatTanzaniaDate(value: DateInput, fallback = "N/A") {
  const date = parseDate(value)
  if (!date) return fallback
  return safeFormat(date, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export function formatTanzaniaTime(value: DateInput, fallback = "N/A") {
  const date = parseDate(value)
  if (!date) return fallback
  return safeFormat(date, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

export function formatTanzaniaDateTime(value: DateInput, fallback = "N/A") {
  const date = parseDate(value)
  if (!date) return fallback
  return `${formatTanzaniaDate(date, fallback)}, ${formatTanzaniaTime(date, fallback)}`
}

export function formatTanzaniaShortDate(value: DateInput, fallback = "N/A") {
  const date = parseDate(value)
  if (!date) return fallback
  return safeFormat(date, {
    day: "numeric",
    month: "short",
  })
}

export function formatTanzaniaMonthLabel(value: DateInput, fallback = "") {
  const date = parseDate(value)
  if (!date) return fallback
  return safeFormat(date, { month: "short" })
}
