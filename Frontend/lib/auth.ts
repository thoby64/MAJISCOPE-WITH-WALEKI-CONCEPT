// ============================================================
// MajiScope - Authentication Utilities
// Password hashing and verification using bcrypt
// ============================================================

import bcrypt from 'bcryptjs'
import prisma from './prisma'

const SALT_ROUNDS = 12

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

export function generateTrackingId(): string {
  const year = new Date().getFullYear()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  const sequence = Date.now().toString().slice(-4)
  return `HN-${year}-${random}${sequence}`
}

/**
 * Check if an email is unique across all user tables
 * Returns an object with the table where the email was found, or null if unique
 */
export async function checkEmailUniqueness(
  email: string,
  excludeId?: string
): Promise<{ isUnique: boolean; foundIn?: string }> {
  try {
    // Check Admin table
    const admin = await prisma.admin.findUnique({ where: { email } })
    if (admin && admin.id !== excludeId) {
      return { isUnique: false, foundIn: 'admin' }
    }
  } catch (error) {
    console.error('Error checking admin table:', error)
  }

  try {
    // Check UtilityManager table
    const utilityManager = await prisma.utilityManager.findUnique({ where: { email } })
    if (utilityManager && utilityManager.id !== excludeId) {
      return { isUnique: false, foundIn: 'utility manager' }
    }
  } catch (error) {
    console.error('Error checking utility manager table:', error)
  }

  try {
    // Check DMAManager table
    const dmaManager = await prisma.dMAManager.findUnique({ where: { email } })
    if (dmaManager && dmaManager.id !== excludeId) {
      return { isUnique: false, foundIn: 'DMA manager' }
    }
  } catch (error) {
    console.error('Error checking DMA manager table:', error)
  }

  try {
    // Check Engineer table
    const engineer = await prisma.engineer.findUnique({ where: { email } })
    if (engineer && engineer.id !== excludeId) {
      return { isUnique: false, foundIn: 'engineer' }
    }
  } catch (error) {
    console.error('Error checking engineer table:', error)
  }

  return { isUnique: true }
}

/**
 * Generate a random password for new accounts
 */
export function generateRandomPassword(length: number = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%'
  let password = ''
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}
