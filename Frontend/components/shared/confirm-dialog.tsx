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
import { AlertTriangle, Trash2, Info } from "lucide-react"
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
  variant?: "default" | "destructive"
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
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-white/95 backdrop-blur-xl border-slate-200/50 shadow-2xl shadow-slate-200/50 rounded-2xl max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-3 text-xl">
            <div className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center shadow-lg",
              variant === "destructive" 
                ? "bg-gradient-to-br from-red-500 to-rose-600 shadow-red-500/20" 
                : "bg-gradient-to-br from-cyan-500 to-sky-600 shadow-cyan-500/20"
            )}>
              {variant === "destructive" ? (
                <Trash2 className="h-5 w-5 text-white" />
              ) : (
                <Info className="h-5 w-5 text-white" />
              )}
            </div>
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-600 text-base pt-2">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter className="gap-2 sm:gap-0 mt-4">
          <AlertDialogCancel className="rounded-xl border-slate-200 hover:bg-slate-50">
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(
              "rounded-xl text-white shadow-lg transition-all duration-300",
              variant === "destructive"
                ? "bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 shadow-red-500/25 hover:shadow-red-500/40"
                : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 shadow-cyan-500/25 hover:shadow-cyan-500/40"
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}