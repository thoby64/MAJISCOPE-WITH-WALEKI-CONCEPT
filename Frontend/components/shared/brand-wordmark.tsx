import { cn } from "@/lib/utils"

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
  const scopeTone =
    theme === "dark"
      ? "bg-gradient-to-r from-white via-cyan-100 to-white"
      : "bg-gradient-to-r from-slate-950 via-slate-700 to-slate-950"

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
        <span className="bg-gradient-to-r from-cyan-300 via-blue-400 to-teal-300 bg-clip-text text-transparent drop-shadow-lg">
          Maji
        </span>
        <span className={cn("bg-clip-text text-transparent", scopeTone)}>
          Scope
        </span>
      </span>
      {underline ? (
        <span
          className={cn(
            "mt-1 h-1 rounded-full bg-gradient-to-r from-transparent via-cyan-400 to-transparent",
            underlineWidths[size],
            underlineClassName
          )}
        />
      ) : null}
    </span>
  )
}
