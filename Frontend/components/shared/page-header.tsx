import { Button } from "@/components/ui/button"
import { Plus, type LucideIcon } from "lucide-react"

interface PageHeaderProps {
  title: string
  description?: string
  actionLabel?: string
  actionIcon?: LucideIcon
  onAction?: () => void
}

export function PageHeader({
  title,
  description,
  actionLabel,
  actionIcon: ActionIcon = Plus,
  onAction,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-3 sm:mt-0">
          <ActionIcon className="mr-2 h-4 w-4" />
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
