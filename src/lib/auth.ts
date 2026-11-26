import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { randomToken, sha256Token, verifyTotp } from '@/lib/crypto'
import { err } from '@/lib/errors'
import type { Membership, User } from '@prisma/client'

// Session auth: opaque 256-bit tokens, sha256-hashed at rest, httpOnly
// cookies, 30-day expiry with rotation on privileged actions.

export const SESSION_COOKIE = 'pl_session'
const SESSION_TTL_DAYS = 30

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomToken(32)
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000)
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: sha256Token(token),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 256),
      expiresAt,
    },
  })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    expires: expiresAt,
  })
  return { sessionId: session.id, token, expiresAt }
}

export async function rotateSession(sessionId: string) {
  const token = randomToken(32)
  await db.session.update({
    where: { id: sessionId },
    data: { tokenHash: sha256Token(token), lastRotatedAt: new Date() },
  })
  const jar = await cookies()
  const existing = await cookies().get(SESSION_COOKIE)
  const session = await db.session.findUnique({ where: { id: sessionId } })
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    expires: session?.expiresAt ?? new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000),
  })
  void existing
  return token
}

export async function revokeSession(sessionId: string, reason: string) {
  await db.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
}

export interface AuthContext {
  user: User
  session: { id: string; lastRotatedAt: Date }
}

export async function getAuth(): Promise<AuthContext | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await db.session.findUnique({
    where: { tokenHash: sha256Token(token) },
    include: { user: true },
  })
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null
  if (session.user.status !== 'ACTIVE') return null
  return { user: session.user, session: { id: session.id, lastRotatedAt: session.lastRotatedAt } }
}

export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth()
  if (!auth) throw err('AUTH_REQUIRED')
  // rotate sessions older than 7 days
  if (Date.now() - auth.session.lastRotatedAt.getTime() > 7 * 24 * 3600 * 1000) {
    await rotateSession(auth.session.id)
  }
  return auth
}

// ─── RBAC ────────────────────────────────────────────────────────────────────

export const ROLE_RANK: Record<string, number> = {
  VIEWER: 10,
  DEVELOPER: 20,
  AGENT_OPERATOR: 25,
  AUDITOR: 30,
  ENGINEERING_LEAD: 40,
  SECURITY_ADMIN: 50,
  ADMIN: 60,
  OWNER: 100,
}

export type Capability =
  | 'org.manage' | 'org.invite' | 'org.billing'
  | 'project.create' | 'project.read' | 'project.write' | 'project.archive'
  | 'release.create' | 'release.write' | 'release.publish' | 'release.revoke'
  | 'evidence.write' | 'attestation.issue' | 'attestation.revoke'
  | 'agent.register' | 'agent.grant' | 'agent.operate' | 'agent.approve'
  | 'task.write' | 'task.review'
  | 'policy.write' | 'policy.read'
  | 'audit.read' | 'analytics.read'
  | 'apikeys.manage' | 'integrations.manage'
  | 'admin.platform'

const CAPS: Record<string, Capability[]> = {
  VIEWER: ['project.read', 'policy.read', 'audit.read'],
  DEVELOPER: ['project.read', 'project.create', 'project.write', 'release.create', 'release.write', 'evidence.write', 'task.write', 'policy.read', 'audit.read'],
  AGENT_OPERATOR: ['project.read', 'agent.register', 'agent.operate', 'agent.grant', 'evidence.write', 'task.write', 'policy.read', 'audit.read'],
  AUDITOR: ['project.read', 'policy.read', 'audit.read', 'analytics.read', 'attestation.issue'],
  ENGINEERING_LEAD: ['project.read', 'project.create', 'project.write', 'project.archive', 'release.create', 'release.write', 'release.publish', 'release.revoke', 'evidence.write', 'attestation.issue', 'attestation.revoke', 'task.write', 'task.review', 'policy.read', 'policy.write', 'audit.read', 'analytics.read', 'agent.approve', 'agent.grant'],
  SECURITY_ADMIN: ['project.read', 'policy.read', 'policy.write', 'audit.read', 'analytics.read', 'attestation.issue', 'attestation.revoke', 'release.revoke', 'agent.approve', 'agent.grant', 'agent.register', 'task.review'],
  ADMIN: ['org.manage', 'org.invite', 'org.billing', 'project.read', 'project.create', 'project.write', 'project.archive', 'release.create', 'release.write', 'release.publish', 'release.revoke', 'evidence.write', 'attestation.issue', 'attestation.revoke', 'agent.register', 'agent.grant', 'agent.operate', 'agent.approve', 'task.write', 'task.review', 'policy.read', 'policy.write', 'audit.read', 'analytics.read', 'apikeys.manage', 'integrations.manage'],
  OWNER: ['org.manage', 'org.invite', 'org.billing', 'project.read', 'project.create', 'project.write', 'project.archive', 'release.create', 'release.write', 'release.publish', 'release.revoke', 'evidence.write', 'attestation.issue', 'attestation.revoke', 'agent.register', 'agent.grant', 'agent.operate', 'agent.approve', 'task.write', 'task.review', 'policy.read', 'policy.write', 'audit.read', 'analytics.read', 'apikeys.manage', 'integrations.manage', 'admin.platform'],
}

export async function getMembership(userId: string, organizationId: string): Promise<Membership | null> {
  return db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  })
}

export async function requireMembership(userId: string, organizationId: string, capability: Capability): Promise<Membership> {
  const m = await getMembership(userId, organizationId)
  if (!m) throw err('NOT_A_MEMBER')
  const caps = CAPS[m.role] ?? []
  if (!caps.includes(capability)) throw err('FORBIDDEN', { capability, role: m.role })
  return m
}

export async function requireProjectAccess(userId: string, projectId: string, capability: Capability) {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) throw err('NOT_FOUND')
  await requireMembership(userId, project.organizationId, capability)
  return project
}

export function capabilitiesForRole(role: string): Capability[] {
  return CAPS[role] ?? []
}

// MFA gate helper for privileged login flows
export function checkMfa(user: User, code: string | undefined): void {
  if (user.mfaEnabled && user.totpSecret) {
    if (!code) throw err('AUTH_MFA_REQUIRED')
    if (!verifyTotp(user.totpSecret, code)) throw err('AUTH_MFA_INVALID')
  }
}
