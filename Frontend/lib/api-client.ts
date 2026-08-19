/**
 * MajiScope Frontend - Global API Client
 * Handles all HTTP requests to the backend
 * 
 * Features:
 * - Automatic JWT authentication
 * - Request retries with exponential backoff
 * - Request timeout handling
 * - Global error handling and 401 redirect
 * - Type-safe responses
 */

import CONFIG from '@/lib/config';
import { transformKeysToSnakeCase } from '@/lib/transform-data';

/**
 * Standard API Response Format
 * All backend responses should follow this format
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: any;
}

/**
 * API Request Options
 * Extends standard RequestInit with custom options
 */
export interface ApiRequestOptions extends RequestInit {
  disableAuth?: boolean; // Don't include Authorization header
  timeout?: number; // Request timeout in ms
  retries?: number; // Number of retry attempts
  cacheTtl?: number; // Cache successful GET responses for this many ms
  skipCache?: boolean; // Bypass GET cache and force a fresh request
  dedupe?: boolean; // Share an in-flight GET request for the same endpoint/options
}

type CacheEntry = {
  expiresAt: number;
  response: ApiResponse<any>;
};

/**
 * Global API Client Class
 * Singleton instance handles all API communication
 */
class ApiClient {
  private baseUrl: string;
  private timeout: number = CONFIG.request.timeout;
  private getCache = new Map<string, CacheEntry>();
  private inFlightGets = new Map<string, Promise<ApiResponse<any>>>();

  constructor() {
    this.baseUrl = CONFIG.backend.fullUrl;
  }

  /**
   * Build full URL for endpoint
   * @param endpoint - API endpoint (e.g., '/auth/login')
   * @returns Full URL for the request
   */
  private buildUrl(endpoint: string): string {
    if (endpoint.startsWith('http')) return endpoint;
    return `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  }

  private getRequestKey(url: string, options: RequestInit, disableAuth: boolean): string {
    const token =
      disableAuth || typeof window === 'undefined'
        ? ''
        : localStorage.getItem(CONFIG.storage.tokenKey) || '';
    return JSON.stringify({
      url,
      method: (options.method || 'GET').toUpperCase(),
      body: options.body || null,
      token,
    });
  }

  private readCache<T>(key: string): ApiResponse<T> | null {
    const cached = this.getCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.getCache.delete(key);
      return null;
    }
    return cached.response as ApiResponse<T>;
  }

  private writeCache<T>(key: string, response: ApiResponse<T>, ttl: number): void {
    if (!response.success || ttl <= 0) return;
    this.getCache.set(key, {
      expiresAt: Date.now() + ttl,
      response,
    });
  }

  invalidateCache(match?: string | RegExp): void {
    if (!match) {
      this.getCache.clear();
      this.inFlightGets.clear();
      return;
    }

    for (const key of Array.from(this.getCache.keys())) {
      if (typeof match === 'string' ? key.includes(match) : match.test(key)) {
        this.getCache.delete(key);
      }
    }
    for (const key of Array.from(this.inFlightGets.keys())) {
      if (typeof match === 'string' ? key.includes(match) : match.test(key)) {
        this.inFlightGets.delete(key);
      }
    }
  }

  /**
   * Get authorization header with JWT token
   * @returns Headers object with Authorization bearer token
   */
  private getAuthHeader(): HeadersInit {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem(CONFIG.storage.tokenKey);

    if (!token) return {};

    return {
      Authorization: `Bearer ${token}`,
    };
  }

  /**
   * Fetch with timeout support
   * @param url - Request URL
   * @param options - Request options
   * @param timeout - Timeout in milliseconds
   * @returns Fetch response
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handle 401 Unauthorized errors
   * Clears auth tokens and redirects to login
   */
  private handle401(): void {
    if (typeof window === 'undefined') return;

    // Clear all auth data
    localStorage.removeItem(CONFIG.storage.tokenKey);
    localStorage.removeItem(CONFIG.storage.refreshTokenKey);
    localStorage.removeItem(CONFIG.storage.userKey);

    // Redirect to login page
    window.location.href = '/login';
  }

  /**
   * Main request method
   * Handles authentication, retries, timeouts, and error handling
   * 
   * @param endpoint - API endpoint
   * @param options - Request options
   * @returns Promise<ApiResponse<T>>
   */
  async request<T = any>(
    endpoint: string,
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const {
      method = 'GET',
      body,
      disableAuth = false,
      timeout = this.timeout,
      retries = CONFIG.request.retryAttempts,
      cacheTtl = 0,
      skipCache = false,
      dedupe = true,
      ...restOptions
    } = options;

    const url = this.buildUrl(endpoint);
    const normalizedMethod = method.toUpperCase();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...restOptions.headers,
    };

    // Add auth header if not disabled
    if (!disableAuth) {
      Object.assign(headers, this.getAuthHeader());
    }

    const requestKey = this.getRequestKey(url, { method: normalizedMethod, body }, disableAuth);
    const isCacheableGet = normalizedMethod === 'GET' && !skipCache;

    if (isCacheableGet && cacheTtl > 0) {
      const cached = this.readCache<T>(requestKey);
      if (cached) return cached;
    }

    if (isCacheableGet && dedupe && this.inFlightGets.has(requestKey)) {
      return this.inFlightGets.get(requestKey) as Promise<ApiResponse<T>>;
    }

    const executeRequest = async (): Promise<ApiResponse<T>> => {
      let lastError: any;

      // Retry logic with exponential backoff
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          // Transform request body from camelCase to snake_case
          const transformedBody = body ? transformKeysToSnakeCase(body) : undefined;

          const response = await this.fetchWithTimeout(
            url,
            {
              method: normalizedMethod,
              headers,
              body: transformedBody ? JSON.stringify(transformedBody) : undefined,
              ...restOptions,
            },
            timeout
          );

          // Handle 401 - Unauthorized
          if (response.status === 401 && !disableAuth) {
            this.handle401();
            throw new Error('Unauthorized - redirecting to login');
          }

          // Parse response
          let data: any;
          try {
            data = await response.json();
          } catch {
            data = {};
          }

          // Handle non-ok responses
          if (!response.ok) {
            return {
              success: false,
              error: data.error || data.detail || `HTTP ${response.status}`,
              code: data.code,
              details: data.details,
            };
          }

          // Success
          const apiResponse: ApiResponse<T> = {
            success: true,
            data: data.data || data,
          };
          if (isCacheableGet && cacheTtl > 0) {
            this.writeCache(requestKey, apiResponse, cacheTtl);
          }
          return apiResponse;
        } catch (error: any) {
          lastError = error;

          // Don't retry on last attempt
          if (attempt === retries) break;

          // Wait before retrying with exponential backoff
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              CONFIG.request.retryDelay * Math.pow(2, attempt)
            )
          );
        }
      }

      // All retries failed
      const wasAborted =
        lastError?.name === 'AbortError' ||
        /operation was aborted|aborterror|aborted/i.test(lastError?.message || '');

      return {
        success: false,
        error: lastError?.message || 'Network request failed',
        code: wasAborted ? 'ABORTED' : 'NETWORK_ERROR',
      };
    };

    const requestPromise = executeRequest();

    if (isCacheableGet && dedupe) {
      this.inFlightGets.set(requestKey, requestPromise);
      requestPromise.finally(() => {
        this.inFlightGets.delete(requestKey);
      });
    }

    if (normalizedMethod !== 'GET') {
      this.invalidateCache();
    }

    return requestPromise;
  }

  /**
   * GET request
   */
  get<T = any>(endpoint: string, options?: ApiRequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  post<T = any>(endpoint: string, body?: any, options?: ApiRequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  /**
   * PUT request
   */
  put<T = any>(endpoint: string, body?: any, options?: ApiRequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  /**
   * PATCH request
   */
  patch<T = any>(endpoint: string, body?: any, options?: ApiRequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body });
  }

  /**
   * DELETE request
   */
  delete<T = any>(endpoint: string, options?: ApiRequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

export default apiClient;
