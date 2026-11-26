import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireMembership, ROLE_RANK, capabilitiesForRole } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { randomToken, sha256Token } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

// GET /api/orgs/[orgId]/members — member roster (members only)
export async function GET(req: NextRequest, ctx: { params: Promise<{ orgId: string }> }) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const { orgId } = await ctx.params
    await requireMembership(user.id, orgId, 'project.read')
    const members = await db.membership.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, email: true, displayName: true, gnoAddress: true, avatarSeed: true, createdAt: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const invitations = await db.invitation.findMany({
      where: { organizationId: orgId, status: 'PENDING' },
    })
    return {
      members: members.map(m => ({
        userId: m.userId, email: m.user.email, displayName: m.user.displayName,
        gnoAddress: m.user.gnoAddress, role: m.role, capabilities: capabilitiesForRole(m.role),
        joinedAt: m.createdAt,
      })),
      invitations: invitations.map(i => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt })),
    }
  })
}

// POST /api/orgs/[orgId]/members — invite a member (org.invite capability)
export async function POST(req: NextRequest, ctx: { params: Promise<{ orgId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { orgId } = await ctx.params
    await requireMembership(user.id, orgId, 'org.invite')
    const body = await readJson<{ email?: string; role?: string }>(req)
    if (!body.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) throw err('VALIDATION_FAILED', { field: 'email' })
    const role = body.role ?? 'DEVELOPER'
    if (!(role in ROLE_RANK) || ROLE_RANK[role] >= ROLE_RANK.OWNER) throw err('VALIDATION_FAILED', { field: 'role', reason: 'cannot invite at or above OWNER' })

    const existingUser = await db.user.findUnique({ where: { email: body.email.toLowerCase() } })
    if (existingUser) {
      const existingMember = await db.membership.findUnique({ where: { userId_organizationId: { userId: existingUser.id, organizationId: orgId } } })
      if (existingMember) throw err('DUPLICATE', { reason: 'already a member' })
    }

    const token = randomToken(24)
    const invitation = await db.invitation.create({
      data: {
        organizationId: orgId,
        email: body.email.toLowerCase(),
        role,
        tokenHash: sha256Token(token),
        invitedBy: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    })
    await audit({
      organizationId: orgId, actorUserId: user.id, action: 'org.invite',
      targetType: 'INVITATION', targetId: invitation.id,
      metadata: { email: invitation.email, role }, ip: clientIp(req), traceId,
    })
    // The invite URL is returned directly: deployments without an email
    // provider surface it in the UI instead of pretending mail was sent.
    return { invitationId: invitation.id, inviteUrl: `/invite/${token}`, email: invitation.email, role, expiresAt: invitation.expiresAt }
  })
}

// DELETE /api/orgs/[orgId]/members?userId= — remove member or revoke invite
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ orgId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { orgId } = await ctx.params
    const actor = await requireMembership(user.id, orgId, 'org.manage')
    const url = new URL(req.url)
    const targetUserId = url.searchParams.get('userId')
    const invitationId = url.searchParams.get('invitationId')

    if (invitationId) {
      const inv = await db.invitation.update({ where: { id: invitationId }, data: { status: 'REVOKED' } })
      if (inv.organizationId !== orgId) throw err('TENANT_ISOLATION')
      await audit({ organizationId: orgId, actorUserId: user.id, action: 'org.invite_revoke', targetType: 'INVITATION', targetId: invitationId, ip: clientIp(req), traceId })
      return { ok: true }
    }
    if (!targetUserId) throw err('VALIDATION_FAILED', { missing: ['userId or invitationId'] })
    if (targetUserId === actor.userId) throw err('VALIDATION_FAILED', { reason: 'cannot remove yourself' })
    const target = await db.membership.findUnique({ where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } } })
    if (!target) throw err('NOT_FOUND')
    if (target.role === 'OWNER') throw err('FORBIDDEN', { reason: 'owners cannot be removed; transfer ownership first' })
    await db.membership.delete({ where: { id: target.id } })
    await audit({ organizationId: orgId, actorUserId: user.id, action: 'org.member_remove', targetType: 'MEMBERSHIP', targetId: target.id, metadata: { removedUserId: targetUserId }, ip: clientIp(req), traceId })
    return { ok: true }
  })
}
