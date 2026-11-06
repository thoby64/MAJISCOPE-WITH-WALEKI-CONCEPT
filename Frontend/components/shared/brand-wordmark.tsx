import { cn } from "@/lib/utils"
import { useId } from "react"

type BrandWordmarkProps = {
  className?: string
  wordClassName?: string
  underlineClassName?: string
  size?: "sm" | "md" | "lg" | "xl"
  theme?: "dark" | "light"
  centered?: boolean
  underline?: boolean
}

const sizeClasses: Record<NonNullable<BrandWordmarkProps["size"]>, string> = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-4xl",
  xl: "text-5xl",
}

const underlineWidths: Record<NonNullable<BrandWordmarkProps["size"]>, string> = {
  sm: "w-12",
  md: "w-16",
  lg: "w-20",
  xl: "w-24",
}

export function BrandWordmark({
  className,
  wordClassName,
  underlineClassName,
  size = "md",
  theme = "dark",
  centered = false,
  underline = true,
}: BrandWordmarkProps) {
  const waveGradientId = useId()
  const scopeTone = theme === "dark" ? "text-white" : "text-[#18313c]"
  const majiTone = theme === "dark"
    ? "bg-gradient-to-r from-[#45b8ad] via-[#70cbc3] to-[#8abfce] bg-clip-text text-transparent drop-shadow-[0_1px_4px_rgba(69,184,173,0.14)]"
    : "bg-gradient-to-r from-[#087e83] via-[#258b8e] to-[#326f83] bg-clip-text text-transparent"

  return (
    <span
      className={cn(
        "relative inline-flex flex-col",
        centered ? "items-center" : "items-start",
        className
      )}
    >
      <span
        className={cn(
          "block font-black tracking-tight",
          sizeClasses[size],
          wordClassName
        )}
      >
        <span className={majiTone}>
          Maji
        </span>
        <span className={scopeTone}>
          Scope
        </span>
      </span>
      {underline ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 120 18"
          preserveAspectRatio="none"
          className={cn("mt-0.5 h-2.5 overflow-visible", underlineWidths[size], underlineClassName)}
        >
          <defs>
            <linearGradient id={waveGradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#168d91" />
              <stop offset="48%" stopColor="#55c5bb" />
              <stop offset="100%" stopColor={theme === "dark" ? "#ffffff" : "#18313c"} />
            </linearGradient>
          </defs>
          <path
            d="M3 12 C24 12 33 4 53 5 C77 6 92 16 117 5"
            fill="none"
            stroke={`url(#${waveGradientId})`}
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          <path
            d="M8 16 C29 16 39 10 56 10 C69 10 78 13 88 14"
            fill="none"
            stroke="#a7e7dd"
            strokeOpacity="0.48"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
          <circle cx="117" cy="5" r="1.8" fill={theme === "dark" ? "#ffffff" : "#18313c"} />
        </svg>
      ) : null}
    </span>
  )
}
