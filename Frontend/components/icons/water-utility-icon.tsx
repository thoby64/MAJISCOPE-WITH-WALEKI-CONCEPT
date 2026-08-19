import { forwardRef } from "react"
import type { LucideIcon, LucideProps } from "lucide-react"

export const WaterUtilityIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(({ className, ...props }, ref) => (
  <svg
    ref={ref}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    {...props}
  >
    <path d="M10 3h4" />
    <path d="M8 6.5a4 1.75 0 0 1 8 0V12H8z" />
    <path d="M9 12l-2.2 9" />
    <path d="M15 12l2.2 9" />
    <path d="M5 21h14" />
    <path d="M12 12v3" />
    <path d="M12 17.5c1 1.2 1.6 2 1.6 2.8a1.6 1.6 0 0 1-3.2 0c0-.8.6-1.6 1.6-2.8z" />
  </svg>
))

WaterUtilityIcon.displayName = "WaterUtilityIcon"