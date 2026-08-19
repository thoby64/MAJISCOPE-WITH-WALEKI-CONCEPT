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
      {/* Sensor body */}
      <rect x="4" y="2" width="14" height="18" rx="2" />
      {/* Pin */}
      <path d="M18 6l3-2 3 2" />
      {/* Wave indicators */}
      <path d="M8 8c1.5-2 3.5-2 5 0" />
      <path d="M8 12c1.5-2 3.5-2 5 0" />
      <path d="M8 16c1.5-2 3.5-2 5 0" />
    </svg>
  )
}