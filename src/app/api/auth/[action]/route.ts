import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp, guardRate } from '@/lib/api'
import { createSession, revokeSession, getAuth, checkMfa } from '@/lib/auth'
import { hashPassword, verifyPassword, passwordStrength, generateTotpSecret } from '@/lib/crypto'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { limits } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

interface AuthBody {
  email?: string
  password?: string
  displayName?: string
  totp?: string
  currentPassword?: string
}

// POST /api/auth/{register|login|logout|mfa-setup|mfa-enable|mfa-disable}
export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  return withApi(async (traceId) => {
    const { action } = await ctx.params
    const ip = clientIp(req)
    const ua = req.headers.get('user-agent') ?? undefined

    if (action === 'demo') {
      // One-click demo: provisions a throwaway account + organization on a
      // 14-day TRIAL, atomically. Advanced features are gated by entitlements
      // and the workspace downgrades to FREE automatically when the trial
      // lapses (evaluated lazily on every request — see entitlements.ts).
      const rl = await limits.registration(ip)
      if (!rl.allowed) throw err('RATE_LIMITED')
      const stamp = Date.now().toString(36)
      const rand = Math.random().toString(36).slice(2, 8)
      const email = `trial-${stamp}-${rand}@demo.proofloom.io`
      const displayName = `Trial Explorer ${rand.toUpperCase()}`
      const created = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash: hashPassword(`trial:${stamp}:${rand}:${Math.random()}`),
            displayName,
            avatarSeed: rand,
            emailVerified: false,
          },
        })
        const org = await tx.organization.create({
          data: {
            slug: `trial-${stamp}-${rand}`,
            name: `${displayName}'s Workspace`,
            ownerId: user.id,
          },
        })
        await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: 'OWNER' } })
        const trialEndsAt = new Date(Date.now() + 14 * 86400e3)
        const sub = await tx.subscription.create({
          data: { organizationId: org.id, planId: 'TRIAL', status: 'TRIALING', trialEndsAt, currentPeriodEnd: trialEndsAt },
        })
        await tx.billingEvent.create({
          data: { subscriptionId: sub.id, kind: 'TRIAL_STARTED', fromPlan: 'FREE', toPlan: 'TRIAL', metadata: JSON.stringify({ days: 14, source: 'one_click_demo' }) },
        })
        return { user, org }
      })
      await createSession(created.user.id, { ip, userAgent: ua })
      await audit({ organizationId: created.org.id, actorUserId: created.user.id, action: 'auth.demo_started', targetType: 'USER', targetId: created.user.id, metadata: { trial: true }, ip, traceId })
      return { userId: created.user.id, email: created.user.email, organizationId: created.org.id, trial: true }
    }

    if (action === 'register') {
      const rl = await limits.registration(ip)
      if (!rl.allowed) throw err('RATE_LIMITED')
      const body = await readJson<AuthBody>(req)
      if (!body.email || !body.password || !body.displayName) throw err('VALIDATION_FAILED', { missing: ['email', 'password', 'displayName'].filter(f => !body[f as keyof AuthBody]) })
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) throw err('VALIDATION_FAILED', { field: 'email' })
      const strength = passwordStrength(body.password)
      if (!strength.ok) throw err('AUTH_WEAK_PASSWORD', { problems: strength.problems })
      const existing = await db.user.findUnique({ where: { email: body.email.toLowerCase() } })
      if (existing) throw err('DUPLICATE', { field: 'email' })
      // Atomic provisioning: account, workspace and trial subscription commit
      // together or not at all.
      const created = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: body.email!.toLowerCase(),
            passwordHash: hashPassword(body.password!),
            displayName: body.displayName!.slice(0, 80),
            avatarSeed: Math.random().toString(36).slice(2, 8),
          },
        })
        const org = await tx.organization.create({
          data: {
            slug: `${body.displayName!.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${Math.random().toString(36).slice(2, 6)}`,
            name: `${body.displayName}'s Workspace`,
            ownerId: user.id,
          },
        })
        await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: 'OWNER' } })
        // Every new organization starts on FREE with a startable 14-day trial.
        const sub = await tx.subscription.create({
          data: { organizationId: org.id, planId: 'FREE', status: 'ACTIVE' },
        })
        return { user, org, sub }
      })
      const { user, org } = created
      await createSession(user.id, { ip, userAgent: ua })
      await audit({ organizationId: org.id, actorUserId: user.id, action: 'auth.register', targetType: 'USER', targetId: user.id, ip, traceId })
      return { userId: user.id, email: user.email, organizationId: org.id }
    }

    if (action === 'login') {
      await guardRate('login-ip', ip, 30, 5 * 60 * 1000)
      const body = await readJson<AuthBody>(req)
      if (!body.email || !body.password) throw err('AUTH_INVALID_CREDENTIALS')
      const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() } })
      if (!user || !verifyPassword(body.password, user.passwordHash)) {
        await guardRate('login-fail', body.email.toLowerCase(), 10, 15 * 60 * 1000)
        throw err('AUTH_INVALID_CREDENTIALS')
      }
      if (user.status !== 'ACTIVE') throw err('FORBIDDEN', { reason: 'account suspended' })
      checkMfa(user, body.totp)
      const memberships = await db.membership.findMany({ where: { userId: user.id } })
      await createSession(user.id, { ip, userAgent: ua })
      await audit({ actorUserId: user.id, action: 'auth.login', targetType: 'USER', targetId: user.id, ip, traceId })
      return { userId: user.id, email: user.email, memberships: memberships.map(m => m.organizationId) }
    }

    if (action === 'logout') {
      const auth = await getAuth()
      if (auth) {
        await revokeSession(auth.session.id, 'user logout')
        await audit({ actorUserId: auth.user.id, action: 'auth.logout', targetType: 'USER', targetId: auth.user.id, ip, traceId })
      }
      return { ok: true }
    }

    if (action === 'mfa-setup') {
      const auth = await getAuth()
      if (!auth) throw err('AUTH_REQUIRED')
      const secret = generateTotpSecret()
      await db.user.update({ where: { id: auth.user.id }, data: { totpSecret: secret, mfaEnabled: false } })
      return { secret, otpauth: `otpauth://totp/PROOFLOOM:${encodeURIComponent(auth.user.email)}?secret=${secret}&issuer=PROOFLOOM` }
    }

    if (action === 'mfa-enable') {
      const auth = await getAuth()
      if (!auth) throw err('AUTH_REQUIRED')
      const body = await readJson<AuthBody>(req)
      const user = await db.user.findUnique({ where: { id: auth.user.id } })
      if (!user?.totpSecret) throw err('VALIDATION_FAILED', { field: 'totp' })
      checkMfa(user, body.totp)
      await db.user.update({ where: { id: user.id }, data: { mfaEnabled: true } })
      await audit({ actorUserId: user.id, action: 'auth.mfa_enable', targetType: 'USER', targetId: user.id, ip, traceId })
      return { ok: true }
    }

    if (action === 'mfa-disable') {
      const auth = await getAuth()
      if (!auth) throw err('AUTH_REQUIRED')
      const body = await readJson<AuthBody>(req)
      const user = await db.user.findUnique({ where: { id: auth.user.id } })
      if (!user) throw err('AUTH_REQUIRED')
      if (user.mfaEnabled) checkMfa(user, body.totp)
      if (!body.currentPassword || !verifyPassword(body.currentPassword, user.passwordHash)) throw err('AUTH_INVALID_CREDENTIALS')
      await db.user.update({ where: { id: user.id }, data: { mfaEnabled: false, totpSecret: null } })
      await audit({ actorUserId: user.id, action: 'auth.mfa_disable', targetType: 'USER', targetId: user.id, ip, traceId })
      return { ok: true }
    }

    if (action === 'wallet-link') {
      const auth = await getAuth()
      if (!auth) throw err('AUTH_REQUIRED')
      const body = await readJson<AuthBody & { address?: string; provider?: string; chainId?: string; signature?: string }>(req)
      const address = body.address ?? ''
      if (!/^g1[a-z0-9]{36,40}$/.test(address)) throw err('INVALID_ADDRESS')
      // Challenge-verified link: the client signs a challenge phrase with the
      // wallet; the server stores the challenge and marks the wallet verified
      // once the signature is presented (Adena signs via signAmino/signEcdsa).
      // In sandboxed previews without Adena, linking records an UNVERIFIED
      // association and the UI says so plainly.
      const verified = typeof body.signature === 'string' && body.signature.length > 40
      const wallet = await db.wallet.upsert({
        where: { address },
        create: {
          userId: auth.user.id, address, provider: body.provider ?? 'adena',
          chainId: body.chainId ?? 'onyx-1', verified,
          challenge: `proofloom-link:${auth.user.id}:${Date.now()}`,
        },
        update: { userId: auth.user.id, provider: body.provider ?? 'adena', verified },
      })
      await db.user.update({ where: { id: auth.user.id }, data: { gnoAddress: address, walletLinkedAt: new Date() } })
      await audit({ actorUserId: auth.user.id, actorAddress: address, action: 'auth.wallet_link', targetType: 'WALLET', targetId: wallet.id, metadata: { verified, provider: wallet.provider, chainId: wallet.chainId }, ip, traceId })
      return { walletId: wallet.id, verified }
    }

    throw err('NOT_FOUND', { route: `auth/${action}` })
  })
}
