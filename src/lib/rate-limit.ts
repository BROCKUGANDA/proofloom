import { db } from '@/lib/db'

// Fixed-window rate limiter backed by the database (single-node safe).
// Buckets key on (name, identifier, window-start); counts increment
// atomically via upsert.

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: Date
}

export async function rateLimit(name: string, identifier: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const window = new Date(Math.floor(Date.now() / windowMs) * windowMs)
  const key = `${name}:${identifier}`
  const row = await db.usageRecord.upsert({
    where: { key_window: { key, window } },
    create: { key, window, count: 1 },
    update: { count: { increment: 1 } },
  })
  const resetAt = new Date(window.getTime() + windowMs)
  return {
    allowed: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    limit,
    resetAt,
  }
}

// Common buckets
export const limits = {
  authAttempt: () => rateLimit('auth', 'global', 50, 5 * 60 * 1000),
  verifyPublic: (ip: string) => rateLimit('verify', ip, 120, 60 * 1000),
  apiDefault: (orgId: string) => rateLimit('api', orgId, 600, 60 * 1000),
  agentExec: (orgId: string) => rateLimit('agent-exec', orgId, 30, 60 * 1000),
  registration: (ip: string) => rateLimit('register', ip, 10, 3600 * 1000),
}
