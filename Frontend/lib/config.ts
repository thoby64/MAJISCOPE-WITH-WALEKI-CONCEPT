/**
 * Majiscope Frontend - Global Configuration
 * Centralized URL management for all API calls
 * 
 * This file is the single source of truth for backend communication
 * All backends calls should flow through this configuration
 */

// ============================================================
// API Base URL Configuration
// ============================================================
// Environment variables are embedded by Next.js during the frontend build.
const DEFAULT_BACKEND_URL = "http://localhost:8000";
const DEFAULT_PRODUCTION_BACKEND_URL = "https://majiscope.onrender.com";
const rawBackendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "";
const BACKEND_API_PREFIX = '/api';

const normalizedConfiguredBackendUrl = rawBackendUrl.replace(/\/+$/, "");
const configuredBackendIsLoopback = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(
  normalizedConfiguredBackendUrl
);
const configuredBackendIsFrontend = /https:\/\/(majiscope|majiscope-2wzv)\.onrender\.com$/i.test(
  normalizedConfiguredBackendUrl
);
const productionConfigurationIsUnsafe =
  process.env.NODE_ENV === "production" &&
  (!normalizedConfiguredBackendUrl || configuredBackendIsLoopback || configuredBackendIsFrontend);

const usingFallbackBackendUrl = !normalizedConfiguredBackendUrl || productionConfigurationIsUnsafe;
const BACKEND_URL = (
  productionConfigurationIsUnsafe
    ? DEFAULT_PRODUCTION_BACKEND_URL
    : normalizedConfiguredBackendUrl || DEFAULT_BACKEND_URL
).replace(/\/+$/, "");

const isLoopbackBackendUrl = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(BACKEND_URL);

if (!rawBackendUrl) {
  console.warn(
    `[FrontendConfig] NEXT_PUBLIC_BACKEND_URL is not set. Falling back to ${BACKEND_URL}.`
  );
  console.warn(
    "[FrontendConfig] Set NEXT_PUBLIC_BACKEND_URL to your backend LAN or deployment URL to avoid localhost-only behavior."
  );
}

if (productionConfigurationIsUnsafe) {
  console.warn(
    `[FrontendConfig] Ignoring an unsafe production backend URL and using ${DEFAULT_PRODUCTION_BACKEND_URL}.`
  );
  console.warn(
    "[FrontendConfig] Set NEXT_PUBLIC_BACKEND_URL in the Render frontend service to the deployed backend origin."
  );
}

function normalizeBackendOrigin(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith(BACKEND_API_PREFIX)
    ? withoutTrailingSlash.slice(0, -BACKEND_API_PREFIX.length)
    : withoutTrailingSlash;
}

/**
 * Global Configuration Object
 * Used throughout the application for API communication
 */
export const CONFIG = {
  // ===== Backend Server Configuration =====
  backend: {
    baseUrl: BACKEND_URL,
    apiPrefix: BACKEND_API_PREFIX,
    fullUrl: `${BACKEND_URL}${BACKEND_API_PREFIX}`,
    usingFallbackBaseUrl: usingFallbackBackendUrl,
    isLoopbackBaseUrl: isLoopbackBackendUrl,
  },

  // ===== Authentication Endpoints =====
  auth: {
    loginEndpoint: '/auth/login',
    logoutEndpoint: '/auth/logout',
    refreshEndpoint: '/auth/refresh',
    verifyEndpoint: '/auth/verify',
    requestPasswordResetEndpoint: '/auth/password-reset/request',
    validatePasswordResetEndpoint: '/auth/password-reset/validate',
    completePasswordResetEndpoint: '/auth/password-reset/complete',
  },

  // ===== Local Storage Keys =====
  storage: {
    tokenKey: 'access_token',
    refreshTokenKey: 'refresh_token',
    userKey: 'current_user',
  },

  // ===== Token Configuration =====
  token: {
    expiryBufferMs: 5 * 60 * 1000, // Refresh 5 mins before expiry
  },

  // ===== Request Configuration =====
  request: {
    timeout: 120000, // 120 seconds
    retryAttempts: 3,
    retryDelay: 1000, // 1 second
  },
};

export function resolveApiBaseUrl(backendOriginOverride?: string | null): string {
  const normalizedOrigin = normalizeBackendOrigin(backendOriginOverride || "");
  return normalizedOrigin
    ? `${normalizedOrigin}${BACKEND_API_PREFIX}`
    : CONFIG.backend.fullUrl;
}

export default CONFIG;
