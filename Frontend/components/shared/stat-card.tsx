"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react"

interface StatCardProps {
  title: string
  value: number
  suffix?: string
  icon: LucideIcon
  trend?: { value: number; isPositive: boolean }
  gradient?: "blue" | "emerald" | "amber" | "red" | "cyan"
  className?: string
}

const GRADIENT_MAP = {
  blue: "from-sky-700 to-blue-800",
  emerald: "from-emerald-700 to-teal-800",
  amber: "from-amber-600 to-orange-700",
  red: "from-rose-700 to-red-800",
  cyan: "from-cyan-700 to-sky-800",
}

export function StatCard({
  title,
  value,
  suffix = "",
  icon: Icon,
  trend,
  gradient = "blue",
  className,
}: StatCardProps) {
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    const duration = 800
    const steps = 30
    const increment = value / steps
    let current = 0
    let step = 0

    const timer = setInterval(() => {
      step++
      current = Math.min(Math.round(increment * step), value)
      setDisplayValue(current)
      if (step >= steps) {
        clearInterval(timer)
        setDisplayValue(value)
      }
    }, duration / steps)

    return () => clearInterval(timer)
  }, [value])

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-gradient-to-br p-5 text-white shadow-md shadow-slate-900/10 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/15",
        GRADIENT_MAP[gradient],
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-white/80">{title}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight animate-count-up">
            {displayValue.toLocaleString()}
            {suffix}
          </p>
          {trend && (
            <div className="mt-2 flex items-center gap-1 text-xs font-medium text-white/80">
              {trend.isPositive ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              <span>
                {trend.isPositive ? "+" : ""}
                {trend.value}% from last month
              </span>
            </div>
          )}
        </div>
        <Icon className="h-7 w-7 shrink-0 text-white/90" />
      </div>
    </div>
  )
}
