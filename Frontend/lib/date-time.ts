const TANZANIA_LOCALE = "en-TZ"
const TANZANIA_TIME_ZONE = "Africa/Dar_es_Salaam"

type DateInput = Date | string | number

function parseDate(value: DateInput) {
  const date = value instanceof Date ? value : new Date(value)
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
