/**
 * MajiScope - Access Control Utilities
 * Defines which roles can access which pages
 */

import type { UserRole } from './types'

/**
 * Map each page to the roles that can access it
 * Page paths are relative to /dashboard
 */
export const PAGE_ACCESS_MAP: Record<string, UserRole[]> = {
  // Dashboard - accessible to all authenticated users
  '': ['admin', 'utility_manager', 'dma_manager', 'user'],
  '/': ['admin', 'utility_manager', 'dma_manager', 'user'],

  // Utilities - admin and utility managers
  '/utilities': ['admin', 'utility_manager', 'user'],
  '/utility-infrastructure': ['admin', 'utility_manager'],
  '/hydraulic-model': ['admin', 'utility_manager', 'dma_manager'],
  '/hydraulic-reports': ['admin', 'utility_manager', 'dma_manager'],

  // Utility Managers - admin only (admin can create/edit)
  '/managers': ['admin', 'user'],

  // DMAs - admin and utility managers (limited to their utility)
  '/dmas': ['admin', 'utility_manager', 'user'],

  // DMA Managers - admin and utility managers (limited to their utility)
  '/dma-managers': ['admin', 'utility_manager', 'user'],

  // Engineers - DMA managers only (limited to their DMA)
  '/engineers': ['dma_manager'],

  // Teams - DMA managers only (limited to their DMA)
  '/teams': ['dma_manager'],

  // Team Leaders - DMA managers only
  '/team-leaders': ['dma_manager'],

  // Reports - all can access (filtered by role)
  '/reports': ['admin', 'utility_manager', 'dma_manager', 'user'],

  // Analytics - admin and utility managers
  '/analytics': ['admin', 'utility_manager', 'user'],

  // Activity Logs - admin only
  '/logs': ['admin'],

  // Profile - all authenticated users
  '/profile': ['admin', 'utility_manager', 'dma_manager', 'user'],
}

/**
 * Check if a user with given role can access a page
 * @param pagePath - The page path (e.g., '/utilities')
 * @param userRole - The user's role
 * @returns true if user can access the page
 */
export function canAccessPage(pagePath: string, userRole: UserRole): boolean {
  const matchedPath = Object.keys(PAGE_ACCESS_MAP)
    .filter((path) => path && path !== '/' && (pagePath === path || pagePath.startsWith(`${path}/`)))
    .sort((a, b) => b.length - a.length)[0]
  const allowedRoles = PAGE_ACCESS_MAP[pagePath] || (matchedPath ? PAGE_ACCESS_MAP[matchedPath] : PAGE_ACCESS_MAP[''])
  return allowedRoles.includes(userRole)
}

/**
 * Get the default dashboard page for a user role
 * @param userRole - The user's role
 * @returns The dashboard page path for this role
 */
export function getDefaultDashboardPage(userRole: UserRole): string {
  switch (userRole) {
    case 'admin':
      return '/dashboard'
    case 'utility_manager':
      return '/dashboard'
    case 'dma_manager':
      return '/dashboard'
    default:
      return '/dashboard'
  }
}

/**
 * Allowed actions/operations for each role
 */
export const ROLE_PERMISSIONS = {
  admin: {
    canCreateUtility: true,
    canEditUtility: true,
    canDeleteUtility: true,
    canCreateUtilityManager: true,
    canEditUtilityManager: true,
    canDeleteUtilityManager: true,
    canCreateDMA: true,
    canEditDMA: true,
    canDeleteDMA: true,
    canCreateDMAManager: true,
    canEditDMAManager: true,
    canDeleteDMAManager: true,
    canCreateEngineer: true,
    canEditEngineer: true,
    canDeleteEngineer: true,
    canCreateTeam: true,
    canEditTeam: true,
    canDeleteTeam: true,
    canCreateTeamLeader: true,
    canEditTeamLeader: true,
    canDeleteTeamLeader: true,
    canCreateReport: true,
    canEditReport: true,
    canDeleteReport: true,
    canAssignReport: true,
    canApproveReport: true,
  },
  utility_manager: {
    canCreateUtility: false,
    canEditUtility: true,
    canDeleteUtility: false,
    canCreateUtilityManager: false,
    canEditUtilityManager: false,
    canDeleteUtilityManager: false,
    canCreateDMA: false,
    canEditDMA: false,
    canDeleteDMA: false,
    canCreateDMAManager: false,
    canEditDMAManager: false,
    canDeleteDMAManager: false,
    canCreateEngineer: false,
    canEditEngineer: false,
    canDeleteEngineer: false,
    canCreateTeam: false,
    canEditTeam: false,
    canDeleteTeam: false,
    canCreateTeamLeader: false,
    canEditTeamLeader: false,
    canDeleteTeamLeader: false,
    canCreateReport: true,
    canEditReport: true,
    canDeleteReport: true,
    canAssignReport: true,
    canApproveReport: true,
  },
  dma_manager: {
    canCreateUtility: false,
    canEditUtility: false,
    canDeleteUtility: false,
    canCreateUtilityManager: false,
    canEditUtilityManager: false,
    canDeleteUtilityManager: false,
    canCreateDMA: false,
    canEditDMA: false,
    canDeleteDMA: false,
    canCreateDMAManager: false,
    canEditDMAManager: false,
    canDeleteDMAManager: false,
    canCreateEngineer: false,
    canEditEngineer: false,
    canDeleteEngineer: false,
    canCreateTeam: false,
    canEditTeam: false,
    canDeleteTeam: false,
    canCreateTeamLeader: false,
    canEditTeamLeader: false,
    canDeleteTeamLeader: false,
    canCreateReport: true,
    canEditReport: true,
    canDeleteReport: true,
    canAssignReport: true,
    canApproveReport: false,
  },
  user: {
    canCreateUtility: true,
    canEditUtility: true,
    canDeleteUtility: true,
    canCreateUtilityManager: true,
    canEditUtilityManager: true,
    canDeleteUtilityManager: true,
    canCreateDMA: true,
    canEditDMA: true,
    canDeleteDMA: true,
    canCreateDMAManager: true,
    canEditDMAManager: true,
    canDeleteDMAManager: true,
    canCreateEngineer: true,
    canEditEngineer: true,
    canDeleteEngineer: true,
    canCreateTeam: true,
    canEditTeam: true,
    canDeleteTeam: true,
    canCreateTeamLeader: true,
    canEditTeamLeader: true,
    canDeleteTeamLeader: true,
    canCreateReport: true,
    canEditReport: true,
    canDeleteReport: true,
    canAssignReport: true,
    canApproveReport: true,
  },
}

/**
 * Get permissions for a user role
 * @param role - The user's role
 * @returns Object with permission flags
 */
export function getRolePermissions(role: UserRole) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.dma_manager
}
