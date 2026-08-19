// ============================================================
// HydraNet - Auth Store (Zustand)
// Handles authentication state with API integration
// Uses global API client for all backend communication
// ============================================================

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { apiClient } from "@/lib/api-client"
import CONFIG from "@/lib/config"

export interface CurrentUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'utility_manager' | 'dma_manager'
  phone: string | null
  avatar: string | null
  status: string
  createdAt: string
  updatedAt: string
  // Utility manager info
  utilityId?: string | null
  utilityName?: string | null
  // DMA manager info
  dmaId?: string | null
  dmaName?: string | null
}

interface AuthState {
  currentUser: CurrentUser | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentUser: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })

        try {
          // Call backend authentication endpoint
          const response = await apiClient.post(CONFIG.auth.loginEndpoint, {
            email,
            password,
          }, {
            disableAuth: true,
          })

          if (!response.success || !response.data) {
            set({
              isLoading: false,
              error: response.error || "Login failed",
            })
            return false
          }

          // Store JWT token in localStorage
          localStorage.setItem(
            CONFIG.storage.tokenKey,
            response.data.access_token
          )

          // Map backend response to frontend CurrentUser format
          const backendUser = response.data.user
          const currentUser: CurrentUser = {
            id: backendUser.id,
            email: backendUser.email,
            name: backendUser.name,
            phone: backendUser.phone || null,
            avatar: backendUser.avatar || null,
            status: backendUser.status,
            // Convert snake_case to camelCase for timestamps
            createdAt: backendUser.created_at || new Date().toISOString(),
            updatedAt: backendUser.updated_at || new Date().toISOString(),
            // Map user_type to frontend role
            role: backendUser.user_type === 'user' 
              ? 'admin' 
              : (backendUser.user_type as 'utility_manager' | 'dma_manager'),
            // Add manager-specific fields if available
            utilityId: backendUser.utility_id || null,
            utilityName: backendUser.utility_name || null,
            dmaId: backendUser.dma_id || null,
            dmaName: backendUser.dma_name || null,
          }

          // Store user information
          set({
            currentUser,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          })
          return true
        } catch (error: any) {
          set({
            isLoading: false,
            error: error.message || "An error occurred during login",
          })
          // Clear all auth tokens
          localStorage.removeItem(CONFIG.storage.tokenKey)
          localStorage.removeItem(CONFIG.storage.refreshTokenKey)
          localStorage.removeItem(CONFIG.storage.userKey)

          return false
        }
      },

      logout: () => {
        set({
          currentUser: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        })
      },

      clearError: () => {
        set({ error: null })
      },
    }),
    {
      name: "hydranet-auth",
      partialize: (state) => ({
        currentUser: state.currentUser,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
