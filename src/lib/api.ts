import { NextRequest, NextResponse } from 'next/server'
import { isErr, type ProofloomError } from '@/lib/errors'
import { rateLimit } from '@/lib/rate-limit'

// Uniform API envelope: { data } | { error: { code, message, recovery } }.
// Adds request correlation ids and rate-limit headers.

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init)
}

export function fail(e: ProofloomError, traceId?: string) {
  return NextResponse.json(
    { error: { code: e.code, message: e.message, recovery: e.recovery, details: e.details }, traceId },
    { status: e.status },
  )
}

export function handleError(e: unknown, traceId?: string) {
  if (isErr(e)) return fail(e, traceId)
  console.error(JSON.stringify({ level: 'error', traceId, message: String((e as Error)?.message ?? e) }))
  return fail({ code: 'INTERNAL', status: 500, message: 'An unexpected error occurred.', recovery: 'Retry; if it persists include the trace id in a bug report.', retryable: true }, traceId)
}

export async function withApi<T>(fn: (traceId: string) => Promise<T>): Promise<NextResponse> {
  const traceId = Math.random().toString(16).slice(2) + Date.now().toString(16)
  try {
    const data = await fn(traceId)
    const res = ok(data)
    res.headers.set('X-Trace-Id', traceId)
    return res
  } catch (e) {
    const res = handleError(e, traceId)
    res.headers.set('X-Trace-Id', traceId)
    return res
  }
}

export async function readJson<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw { code: 'VALIDATION_FAILED', status: 400, message: 'Request body must be JSON.', recovery: 'Send a JSON body.', retryable: true }
  }
}

export async function guardRate(name: string, identifier: string, limit: number, windowMs: number) {
  const rl = await rateLimit(name, identifier, limit, windowMs)
  if (!rl.allowed) {
    throw { code: 'RATE_LIMITED', status: 429, message: 'Too many requests.', recovery: `Wait until ${rl.resetAt.toISOString()}.`, retryable: true, details: { resetAt: rl.resetAt } }
  }
}

export function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

// Get the auth context if present, null otherwise (does not throw).
import { getAuth, type AuthContext } from '@/lib/auth'
export async function requireAuthShim(): Promise<AuthContext | null> {
  try {
    return await getAuth()
  } catch {
    return null
  }
}

// String field validation helper
export function requireFields(body: Record<string, unknown>, fields: string[]) {
  const missing = fields.filter(f => body[f] === undefined || body[f] === null || body[f] === '')
  if (missing.length > 0) {
    throw { code: 'VALIDATION_FAILED', status: 400, message: `Missing required fields: ${missing.join(', ')}`, recovery: 'Provide the missing fields.', retryable: true, details: { missing } }
  }
}
