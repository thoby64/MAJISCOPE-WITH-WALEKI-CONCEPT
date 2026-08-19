"use client"

import { OperationsDashboard } from "@/components/dashboard/operations-dashboard"
import { useAuthStore } from "@/store/auth-store"

export default function DashboardPage() {
  const { currentUser } = useAuthStore()

  if (!currentUser) return null

  return <OperationsDashboard />
}
