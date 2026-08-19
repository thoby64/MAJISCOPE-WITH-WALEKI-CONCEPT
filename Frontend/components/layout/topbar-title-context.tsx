"use client"

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"

type TopbarTitle = {
  eyebrow?: string
  title: string
  subtitle?: string
}

type TopbarTitleContextValue = {
  title: TopbarTitle | null
  setTitle: (title: TopbarTitle | null) => void
}

const TopbarTitleContext = createContext<TopbarTitleContextValue | null>(null)

export function TopbarTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<TopbarTitle | null>(null)
  const value = useMemo(() => ({ title, setTitle }), [title])

  return <TopbarTitleContext.Provider value={value}>{children}</TopbarTitleContext.Provider>
}

export function useTopbarTitle() {
  const context = useContext(TopbarTitleContext)
  if (!context) {
    throw new Error("useTopbarTitle must be used within TopbarTitleProvider")
  }
  return context
}
