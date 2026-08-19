/**
 * Utility functions to transform API response data
 * Converts snake_case from backend to camelCase for frontend
 * and vice versa for request bodies
 */

/**
 * Convert snake_case string to camelCase
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase())
}

/**
 * Convert camelCase string to snake_case
 */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/**
 * Recursively convert all object keys from snake_case to camelCase
 */
export function transformKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(transformKeys)
  } else if (obj !== null && typeof obj === 'object') {
    const transformed: any = {}
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const camelKey = snakeToCamel(key)
        transformed[camelKey] = transformKeys(obj[key])
      }
    }
    return transformed
  }
  return obj
}

/**
 * Recursively convert all object keys from camelCase to snake_case
 * Used for request bodies sent to backend
 */
export function transformKeysToSnakeCase(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(transformKeysToSnakeCase)
  } else if (obj !== null && typeof obj === 'object') {
    const transformed: any = {}
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const snakeKey = camelToSnake(key)
        transformed[snakeKey] = transformKeysToSnakeCase(obj[key])
      }
    }
    return transformed
  }
  return obj
}

/**
 * Transform a list response from {total, items} format
 */
export function transformListResponse<T>(data: any): {total: number; items: T[]} {
  return {
    total: data.total || 0,
    items: (data.items || []).map(transformKeys) as T[]
  }
}

/**
 * Transform a single item response
 */
export function transformItem<T>(data: any): T {
  return transformKeys(data) as T
}
