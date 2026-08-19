import type { CSSProperties } from "react"
import { getInfrastructureIconDef } from "@/lib/infrastructure-assets"

interface InfrastructureIconProps {
  assetType?: string | null
  className?: string
  style?: CSSProperties
}

export function InfrastructureIcon({ assetType, className, style }: InfrastructureIconProps) {
  const def = getInfrastructureIconDef(assetType)
  return (
    <svg
      viewBox={def.viewBox}
      fill="none"
      stroke="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {def.paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          strokeWidth={path.strokeWidth ?? 1.8}
          strokeLinecap={path.strokeLinecap}
          strokeLinejoin={path.strokeLinejoin}
        />
      ))}
    </svg>
  )
}