import { db } from '@/lib/db'
import { err } from '@/lib/errors'

// Billing & entitlements engine.
//
// Model: every organization carries exactly one Subscription. Plans are a
// static catalog (code-defined, versioned by `catalogVersion`) — the source
// of truth for limits, so pricing changes are a code review, not a migration.
//
// Trial mechanics: a TRIAL subscription carries trialEndsAt. The effective
// plan is evaluated lazily on every read/write: if the trial has lapsed, a
// race-safe conditional update downgrades it to FREE exactly once, and the
// caller sees the FREE plan for this and every subsequent request. No cron
// dependency, no drift, no double-downgrade.
//
// Enforcement: assertCap for hard ceilings (projects, agents, members),
// assertMetered for monthly volumes (releases, attestations), requireFeature
// for plan-gated feature areas (agent command, policies, API keys, exports).
// All gates throw 402-class errors with an upgrade path in `recovery`.

export type PlanId = 'FREE' | 'TRIAL' | 'PRO' | 'ENTERPRISE'

export interface PlanDef {
  id: PlanId
  name: string
  tagline: string
  priceMonthlyCents: number
  limits: {
    projects: number // -1 = unlimited
    releasesMonthly: number
    attestationsMonthly: number
    agents: number
    orgMembers: number
  }
  features: {
    agentCommand: boolean
    policyEngine: boolean
    apiKeys: boolean
    exportExports: boolean
    priorityChainLane: boolean
  }
  auditRetentionDays: number
}

export const TRIAL_DAYS = 14
export const CATALOG_VERSION = '2026.11'

export const PLANS: Record<PlanId, PlanDef> = {
  FREE: {
    id: 'FREE', name: 'Free', tagline: 'Public verification, forever.',
    priceMonthlyCents: 0,
    limits: { projects: 2, releasesMonthly: 3, attestationsMonthly: 10, agents: 0, orgMembers: 2 },
    features: { agentCommand: false, policyEngine: false, apiKeys: false, exportExports: false, priorityChainLane: false },
    auditRetentionDays: 30,
  },
  TRIAL: {
    id: 'TRIAL', name: 'Trial', tagline: 'Everything in Pro, free for 14 days.',
    priceMonthlyCents: 0,
    limits: { projects: 25, releasesMonthly: 100, attestationsMonthly: 500, agents: 10, orgMembers: 10 },
    features: { agentCommand: true, policyEngine: true, apiKeys: true, exportExports: true, priorityChainLane: false },
    auditRetentionDays: 90,
  },
  PRO: {
    id: 'PRO', name: 'Pro', tagline: 'For shipping teams that prove their work.',
    priceMonthlyCents: 4900,
    limits: { projects: 25, releasesMonthly: 100, attestationsMonthly: 500, agents: 10, orgMembers: 10 },
    features: { agentCommand: true, policyEngine: true, apiKeys: true, exportExports: true, priorityChainLane: false },
    auditRetentionDays: 90,
  },
  ENTERPRISE: {
    id: 'ENTERPRISE', name: 'Enterprise', tagline: 'Governance, retention, priority lane.',
    priceMonthlyCents: 49900,
    limits: { projects: -1, releasesMonthly: -1, attestationsMonthly: -1, agents: 50, orgMembers: -1 },
    features: { agentCommand: true, policyEngine: true, apiKeys: true, exportExports: true, priorityChainLane: true },
    auditRetentionDays: 365,
  },
}

export interface SubscriptionView {
  planId: PlanDef['id']
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
  plan: PlanDef
  trialEndsAt?: string
  currentPeriodEnd?: string
  cancelAtPeriodEnd: boolean
  daysLeftInTrial?: number
  trialExpired?: boolean
}

function monthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

// Evaluate the effective subscription. Lazily downgrades a lapsed trial
// exactly once using a conditional update (race-safe under concurrency).
export async function effectiveSubscription(organizationId: string) {
  let sub = await db.subscription.findUnique({ where: { organizationId } })
  if (!sub) {
    // Lazy provisioning — organizations created before billing existed start on FREE.
    sub = await db.subscription.create({
      data: { organizationId, planId: 'FREE', status: 'ACTIVE' },
    })
  }
  if (sub.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt.getTime() <= Date.now()) {
    const updated = await db.subscription.updateMany({
      where: { id: sub.id, status: 'TRIALING' }, // conditional — only one writer wins
      data: {
        status: 'EXPIRED', planId: 'FREE',
        currentPeriodEnd: null, cancelAtPeriodEnd: false,
      },
    })
    if (updated.count > 0) {
      await db.billingEvent.create({
        data: { subscriptionId: sub.id, kind: 'TRIAL_ENDED', fromPlan: 'TRIAL', toPlan: 'FREE', metadata: JSON.stringify({ reason: 'trial_elapsed' }) },
      })
    }
    sub = await db.subscription.findUniqueOrThrow({ where: { organizationId } })
  }
  return sub
}

export async function planForOrg(organizationId: string): Promise<PlanDef> {
  const sub = await effectiveSubscription(organizationId)
  return PLANS[sub.planId as PlanId] ?? PLANS.FREE
}

export async function subscriptionView(organizationId: string): Promise<SubscriptionView> {
  const sub = await effectiveSubscription(organizationId)
  const plan = PLANS[sub.planId as PlanId] ?? PLANS.FREE
  const trialExpired = sub.status === 'EXPIRED' && sub.trialEndsAt !== null
  return {
    planId: plan.id,
    status: sub.status as SubscriptionView['status'],
    plan,
    trialEndsAt: sub.trialEndsAt?.toISOString(),
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString(),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    daysLeftInTrial: sub.status === 'TRIALING' && sub.trialEndsAt
      ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86400e3))
      : undefined,
    trialExpired,
  }
}

// ─── Usage metering ──────────────────────────────────────────────────────────

async function usageCount(organizationId: string, key: string): Promise<number> {
  const row = await db.entitlementUsage.findUnique({
    where: { organizationId_key_period: { organizationId, key, period: monthStart() } },
  })
  return row?.count ?? 0
}

// Atomically increment a metered counter; returns the new count.
async function trackUsage(organizationId: string, key: string, by = 1): Promise<number> {
  const row = await db.entitlementUsage.upsert({
    where: { organizationId_key_period: { organizationId, key, period: monthStart() } },
    create: { organizationId, key, period: monthStart(), count: by },
    update: { count: { increment: by } },
  })
  return row.count
}

async function rollBackUsage(organizationId: string, key: string, by = 1) {
  await db.entitlementUsage.updateMany({
    where: { organizationId, key, period: monthStart(), count: { gte: by } },
    data: { count: { decrement: by } },
  })
}

// ─── Enforcement gates ───────────────────────────────────────────────────────

function upgradeError(code: 'ENTITLEMENT_REQUIRED' | 'ENTITLEMENT_LIMIT', detail: Record<string, unknown>) {
  return err(code, detail)
}

// Hard ceiling on a countable entity (projects, agents, members).
export async function assertCap(organizationId: string, key: 'projects' | 'agents' | 'orgMembers', currentCount: number) {
  const plan = await planForOrg(organizationId)
  const limit = plan.limits[key]
  if (limit === -1) return
  if (currentCount >= limit) {
    throw upgradeError('ENTITLEMENT_LIMIT', {
      feature: key, limit, plan: plan.id,
      upgradeHint: `The ${plan.name} plan allows ${limit === 0 ? 'no' : limit} ${key === 'orgMembers' ? 'members' : key}. Upgrade to raise this cap.`,
    })
  }
}

// Monthly metered resource (releases, attestations). Throws 402 with the
// current usage so the UI can render a "you've used N of M" panel.
export async function assertMetered(organizationId: string, key: 'releases' | 'attestations') {
  const plan = await planForOrg(organizationId)
  const limit = plan.limits[key === 'releases' ? 'releasesMonthly' : 'attestationsMonthly']
  if (limit === -1) return
  const used = await usageCount(organizationId, key)
  if (used >= limit) {
    throw upgradeError('ENTITLEMENT_LIMIT', {
      feature: key, limit, used, plan: plan.id, period: monthStart().toISOString(),
      upgradeHint: `You've used ${used} of ${limit} monthly ${key} on the ${plan.name} plan. Upgrade for a higher allowance.`,
    })
  }
}

// Records consumption AFTER a successful create. Never blocks the write path.
export async function recordUsage(organizationId: string, key: 'releases' | 'attestations') {
  await trackUsage(organizationId, key)
}

export async function refundUsage(organizationId: string, key: 'releases' | 'attestations') {
  await rollBackUsage(organizationId, key)
}

// Plan-gated feature areas.
export async function requireFeature(organizationId: string, feature: keyof PlanDef['features']) {
  const plan = await planForOrg(organizationId)
  if (!plan.features[feature]) {
    throw upgradeError('ENTITLEMENT_REQUIRED', {
      feature, plan: plan.id,
      upgradeHint: `${feature} is a Pro feature. The ${plan.name} plan does not include it — upgrade to unlock.`,
    })
  }
}

// ─── Session/UI summary ──────────────────────────────────────────────────────

export async function billingSummary(organizationId: string) {
  const view = await subscriptionView(organizationId)
  const plan = PLANS[view.planId] ?? PLANS.FREE
  const usage = {
    releases: await usageCount(organizationId, 'releases'),
    attestations: await usageCount(organizationId, 'attestations'),
  }
  const [projects, agents, members] = await Promise.all([
    db.project.count({ where: { organizationId, status: 'ACTIVE' } }),
    db.agent.count({ where: { organizationId, status: 'ACTIVE' } }),
    db.membership.count({ where: { organizationId } }),
  ])
  const cap = (used: number, limit: number) => ({ used, limit, unlimited: limit === -1, pct: limit === -1 ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100)) })
  return {
    ...view,
    catalogVersion: CATALOG_VERSION,
    usage: {
      projects: cap(projects, plan.limits.projects),
      agents: cap(agents, plan.limits.agents),
      members: cap(members, plan.limits.orgMembers),
      releasesMonthly: cap(usage.releases, plan.limits.releasesMonthly),
      attestationsMonthly: cap(usage.attestations, plan.limits.attestationsMonthly),
    },
  }
}
