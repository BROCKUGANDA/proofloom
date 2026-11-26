import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp, requireAuthShim } from '@/lib/api'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { billingSummary, effectiveSubscription, PLANS, TRIAL_DAYS, type PlanId } from '@/lib/entitlements'

export const dynamic = 'force-dynamic'

// GET /api/billing — plan, status, usage meters and event history for the org.
export async function GET(req: NextRequest) {
  return withApi(async () => {
    const auth = await requireAuthShim()
    if (!auth) throw err('AUTH_REQUIRED')
    const orgId = new URL(req.url).searchParams.get('orgId') ?? ''
    const membership = await db.membership.findUnique({
      where: { userId_organizationId: { userId: auth.user.id, organizationId: orgId } },
    })
    if (!membership) throw err('NOT_A_MEMBER')
    const summary = await billingSummary(orgId)
    const sub = await effectiveSubscription(orgId)
    const events = await db.billingEvent.findMany({
      where: { subscriptionId: sub.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return {
      ...summary,
      events: events.map(e => ({ id: e.id, kind: e.kind, fromPlan: e.fromPlan, toPlan: e.toPlan, createdAt: e.createdAt })),
      plans: Object.values(PLANS).map(p => ({
        id: p.id, name: p.name, tagline: p.tagline, priceMonthlyCents: p.priceMonthlyCents,
        limits: p.limits, features: p.features, auditRetentionDays: p.auditRetentionDays,
        current: p.id === summary.planId,
      })),
    }
  })
}

interface BillingBody { action?: string; plan?: string; orgId?: string }

// POST /api/billing — plan lifecycle actions. Simulated payment provider:
// upgrades activate immediately and record PAYMENT_SUCCEEDED; the integration
// point for Stripe/Paddle is the plan-change transaction below.
export async function POST(req: NextRequest) {
  return withApi(async (traceId) => {
    const auth = await requireAuthShim()
    if (!auth) throw err('AUTH_REQUIRED')
    const body = await readJson<BillingBody>(req)
    const orgId = body.orgId ?? ''
    const membership = await db.membership.findUnique({
      where: { userId_organizationId: { userId: auth.user.id, organizationId: orgId } },
    })
    if (!membership) throw err('NOT_A_MEMBER')
    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      throw err('FORBIDDEN', { reason: 'billing actions require OWNER or ADMIN' })
    }

    const sub = await effectiveSubscription(orgId)
    const fromPlan = sub.planId

    if (body.action === 'start_trial') {
      if (sub.status !== 'ACTIVE' || fromPlan !== 'FREE') {
        throw err('BILLING_INVALID_TRANSITION', { current: `${sub.status}/${fromPlan}` })
      }
      // One trial per organization: the TRIAL_STARTED/TRIAL_ENDED events are tombstones.
      const hadTrial = await db.billingEvent.findFirst({
        where: { subscriptionId: sub.id, kind: { in: ['TRIAL_STARTED', 'TRIAL_ENDED'] } },
      })
      if (hadTrial) throw err('BILLING_INVALID_TRANSITION', { reason: 'trial already used' })
      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400e3)
      const updated = await db.$transaction(async (tx) => {
        const r = await tx.subscription.updateMany({
          where: { id: sub.id, status: 'ACTIVE', planId: 'FREE' },
          data: { status: 'TRIALING', planId: 'TRIAL', trialEndsAt, currentPeriodEnd: trialEndsAt },
        })
        if (r.count === 0) throw err('BILLING_INVALID_TRANSITION', { reason: 'concurrent change' })
        await tx.billingEvent.create({
          data: { subscriptionId: sub.id, kind: 'TRIAL_STARTED', fromPlan, toPlan: 'TRIAL', metadata: JSON.stringify({ days: TRIAL_DAYS }) },
        })
        return trialEndsAt
      })
      await audit({ organizationId: orgId, actorUserId: auth.user.id, action: 'billing.trial_started', targetType: 'Subscription', targetId: sub.id, metadata: { trialEndsAt: updated.toISOString() }, traceId })
      return billingSummary(orgId)
    }

    if (body.action === 'upgrade' || body.action === 'change_plan') {
      const planId = (body.plan ?? 'PRO') as PlanId
      if (!PLANS[planId] || planId === 'TRIAL' || planId === 'FREE') {
        throw err('VALIDATION_FAILED', { field: 'plan', allowed: ['PRO', 'ENTERPRISE'] })
      }
      if (sub.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt.getTime() > Date.now()) {
        // Upgrading mid-trial: keep the trial clock as the current period end.
        await db.$transaction(async (tx) => {
          const r = await tx.subscription.updateMany({
            where: { id: sub.id, status: 'TRIALING' },
            data: { planId, status: 'ACTIVE', currentPeriodEnd: sub.trialEndsAt as Date },
          })
          if (r.count === 0) throw err('BILLING_INVALID_TRANSITION', { reason: 'concurrent change' })
          await tx.billingEvent.create({
            data: { subscriptionId: sub.id, kind: 'PAYMENT_SUCCEEDED', fromPlan, toPlan: planId, metadata: JSON.stringify({ provider: 'internal-simulated', note: 'upgraded during trial' }) },
          })
        })
      } else {
        const periodEnd = new Date(Date.now() + 30 * 86400e3)
        await db.$transaction(async (tx) => {
          const r = await tx.subscription.updateMany({
            where: { id: sub.id, status: { in: ['ACTIVE', 'EXPIRED', 'PAST_DUE', 'CANCELED'] } },
            data: { planId, status: 'ACTIVE', currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, trialEndsAt: null },
          })
          if (r.count === 0) throw err('BILLING_INVALID_TRANSITION', { reason: 'concurrent change' })
          await tx.billingEvent.create({
            data: { subscriptionId: sub.id, kind: 'PAYMENT_SUCCEEDED', fromPlan, toPlan: planId, metadata: JSON.stringify({ provider: 'internal-simulated', periodEnd: periodEnd.toISOString() }) },
          })
        })
      }
      await audit({ organizationId: orgId, actorUserId: auth.user.id, action: 'billing.plan_changed', targetType: 'Subscription', targetId: sub.id, metadata: { fromPlan, toPlan: planId }, traceId })
      return billingSummary(orgId)
    }

    if (body.action === 'cancel') {
      if (sub.status !== 'ACTIVE' || sub.planId === 'FREE') throw err('BILLING_INVALID_TRANSITION', { current: `${sub.status}/${fromPlan}` })
      await db.subscription.updateMany({
        where: { id: sub.id, status: 'ACTIVE' },
        data: { cancelAtPeriodEnd: true },
      })
      await db.billingEvent.create({
        data: { subscriptionId: sub.id, kind: 'CANCELED', fromPlan, toPlan: fromPlan, metadata: JSON.stringify({ cancelsAt: sub.currentPeriodEnd?.toISOString() ?? null }) },
      })
      await audit({ organizationId: orgId, actorUserId: auth.user.id, action: 'billing.canceled', targetType: 'Subscription', targetId: sub.id, metadata: { fromPlan }, traceId })
      return billingSummary(orgId)
    }

    if (body.action === 'resume') {
      if (!sub.cancelAtPeriodEnd) throw err('BILLING_INVALID_TRANSITION', { reason: 'not scheduled to cancel' })
      await db.subscription.updateMany({
        where: { id: sub.id, cancelAtPeriodEnd: true },
        data: { cancelAtPeriodEnd: false },
      })
      await db.billingEvent.create({
        data: { subscriptionId: sub.id, kind: 'REACTIVATED', fromPlan, toPlan: fromPlan },
      })
      await audit({ organizationId: orgId, actorUserId: auth.user.id, action: 'billing.resumed', targetType: 'Subscription', targetId: sub.id, traceId })
      return billingSummary(orgId)
    }

    if (body.action === 'downgrade_now') {
      if (sub.planId === 'FREE') throw err('BILLING_INVALID_TRANSITION', { reason: 'already on FREE' })
      await db.$transaction(async (tx) => {
        const r = await tx.subscription.updateMany({
          where: { id: sub.id, planId: { not: 'FREE' } },
          data: { planId: 'FREE', status: 'ACTIVE', cancelAtPeriodEnd: false, trialEndsAt: null, currentPeriodEnd: null },
        })
        if (r.count === 0) throw err('BILLING_INVALID_TRANSITION', { reason: 'concurrent change' })
        await tx.billingEvent.create({
          data: { subscriptionId: sub.id, kind: 'DOWNGRADED', fromPlan, toPlan: 'FREE', metadata: JSON.stringify({ immediate: true }) },
        })
      })
      await audit({ organizationId: orgId, actorUserId: auth.user.id, action: 'billing.downgraded', targetType: 'Subscription', targetId: sub.id, metadata: { fromPlan, immediate: true }, traceId })
      return billingSummary(orgId)
    }

    throw err('NOT_FOUND', { route: `billing/${body.action}` })
  })
}
