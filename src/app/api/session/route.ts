import { withApi, requireAuthShim } from '@/lib/api'
import { db } from '@/lib/db'
import { activeChain } from '@/lib/chain'
import { capabilitiesForRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET /api/session — the authenticated client's boot payload.
export async function GET() {
  return withApi(async () => {
    const auth = await requireAuthShim()
    if (!auth) {
      return { authenticated: false, chain: { chainId: activeChain().chainId, label: activeChain().label, rpc: activeChain().rpc, realmPrefix: activeChain().realmPrefix } }
    }
    const memberships = await db.membership.findMany({
      where: { userId: auth.user.id },
      include: {
        organization: {
          include: {
            _count: { select: { projects: true, memberships: true } },
            subscription: true,
          },
        },
      },
    })
    const notifications = await db.notification.findMany({
      where: { userId: auth.user.id, readAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return {
      authenticated: true,
      user: {
        id: auth.user.id, email: auth.user.email, displayName: auth.user.displayName,
        gnoAddress: auth.user.gnoAddress, mfaEnabled: auth.user.mfaEnabled, avatarSeed: auth.user.avatarSeed,
      },
      organizations: memberships.map(m => {
        const sub = m.organization.subscription
        const trialLapsed = sub?.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt.getTime() <= Date.now()
        return {
          id: m.organizationId,
          slug: m.organization.slug,
          name: m.organization.name,
          role: m.role,
          capabilities: capabilitiesForRole(m.role),
          projects: m.organization._count.projects,
          members: m.organization._count.memberships,
          billing: {
            planId: sub?.planId ?? 'FREE',
            status: trialLapsed ? 'EXPIRED' : sub?.status ?? 'ACTIVE',
            trialEndsAt: sub?.trialEndsAt?.toISOString(),
            daysLeftInTrial: sub?.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt.getTime() > Date.now()
              ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86400e3))
              : undefined,
            trialExpired: sub?.trialEndsAt != null && (sub.planId === 'FREE' && sub.status === 'EXPIRED' || trialLapsed && sub.planId !== 'PRO'),
          },
        }
      }),
      unreadNotifications: notifications.length,
      chain: { chainId: activeChain().chainId, label: activeChain().label, rpc: activeChain().rpc, realmPrefix: activeChain().realmPrefix },
    }
  })
}
