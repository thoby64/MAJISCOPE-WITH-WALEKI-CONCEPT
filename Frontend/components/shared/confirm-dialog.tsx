"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertTriangle, Loader2, Trash2, Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  children?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  variant?: "default" | "warning" | "destructive"
  isLoading?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  variant = "destructive",
  isLoading = false,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-3 text-xl">
            <div
              className={cn(
                "dashboard-modal-accent flex h-10 w-10 items-center justify-center rounded-xl",
                variant === "destructive" && "dashboard-modal-accent-destructive",
                variant === "warning" && "dashboard-modal-accent-warning",
              )}
            >
              {variant === "destructive" ? (
                <Trash2 className="dashboard-modal-trash-icon h-5 w-5" />
              ) : variant === "warning" ? (
                <AlertTriangle className="h-5 w-5 text-white" />
              ) : (
                <Info className="h-5 w-5 text-white" />
              )}
            </div>
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="dashboard-modal-description text-base pt-2">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter className="gap-2 sm:gap-0 mt-4">
          <AlertDialogCancel disabled={isLoading} className="dashboard-modal-cancel rounded-xl">
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isLoading}
            className={cn(
              "dashboard-modal-submit rounded-xl text-white transition-colors duration-200 disabled:pointer-events-none disabled:opacity-60",
              variant === "destructive"
                ? "dashboard-modal-submit-destructive"
                : variant === "warning"
                  ? "dashboard-modal-submit-warning"
                  : ""
            )}
          >
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isLoading ? "Saving…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
