import type { SVGProps } from "react"

export function HydraulicPumpIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M7 8h10v8H7z" />
      <path d="M9 10h6" />
      <path d="M9 12h6" />
      <path d="M9 14h6" />
      <path d="M3 10h4" />
      <path d="M17 10h4" />
      <path d="M4 8v8" />
      <path d="M20 8v8" />
      <path d="M11 8V5" />
      <path d="M9 5h6" />
      <path d="M17 12h2a2 2 0 0 1 2 2v2" />
      <path d="M6 16h12" />
    </svg>
  )
}
