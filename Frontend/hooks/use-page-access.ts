'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/auth-store'
import { canAccessPage } from '@/lib/access-control'

/**
 * Hook to protect pages based on user role
 * Redirects to dashboard if user doesn't have access to the current page
 * 
 * Usage in any page component:
 * ```tsx
 * export default function MyPage() {
 *   usePageAccess()  // This will check access and redirect if needed
 *   // ... rest of page
 * }
 * ```
 */
export function usePageAccess() {
  const router = useRouter()
  const pathname = usePathname()
  const { currentUser, isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated || !currentUser) {
      // Not authenticated - will be handled by layout auth guard
      return
    }

    // Extract page path relative to /dashboard
    const pagePath = pathname.replace('/dashboard', '') || '/'

    // Check if user has access to this page
    const hasAccess = canAccessPage(pagePath, currentUser.role)

    if (!hasAccess) {
      console.warn(`User ${currentUser.email} attempted to access ${pathname}`)
      // Redirect to dashboard
      router.replace('/dashboard')
    }
  }, [pathname, currentUser, isAuthenticated, router])
}
