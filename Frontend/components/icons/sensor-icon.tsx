import type { SVGProps } from "react"

export function SensorIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
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
      {/* Left connection points - circles */}
      <circle cx="3" cy="6" r="1.5" />
      <circle cx="3" cy="12" r="1.5" />
      <circle cx="3" cy="18" r="1.5" />
      {/* Lines from circles to body */}
      <path d="M4.5 6H8" />
      <path d="M4.5 12H8" />
      <path d="M4.5 18H8" />
      {/* Rectangular sensor body */}
      <rect x="8" y="4" width="8" height="16" rx="1.5" />
      {/* Dome/bump on right side */}
      <path d="M16 10a2 2 0 0 1 2 2 2 2 0 0 1-2 2" />
      {/* Signal arcs */}
      <path d="M20.5 8.5a6 6 0 0 1 0 7" />
      <path d="M22.5 6a9.5 9.5 0 0 1 0 12" />
    </svg>
  )
}