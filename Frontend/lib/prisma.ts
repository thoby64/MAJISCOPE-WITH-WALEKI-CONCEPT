// ============================================================
// MajiScope - Optional Prisma Client Helper
// Keeps TypeScript/builds working even when Prisma packages are
// not installed for this frontend workspace.
// ============================================================

type PrismaLikeClient = any

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaLikeClient | undefined
}

function createPrismaClient(): PrismaLikeClient {
  try {
    const runtimeRequire = eval("require") as NodeRequire
    const { Pool } = runtimeRequire("pg")
    const { PrismaPg } = runtimeRequire("@prisma/adapter-pg")
    const { PrismaClient } = runtimeRequire("@prisma/client")
    const connectionString = process.env.DATABASE_URL

    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured.")
    }

    const pool = new Pool({ connectionString })
    const adapter = new PrismaPg(pool)
    return new PrismaClient({ adapter })
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[prisma] Prisma client is unavailable in this workspace:", error)
    }
    return null
  }
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}

export default prisma
