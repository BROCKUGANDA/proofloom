'use client'

// Plan & Billing view — subscription state, usage meters, plan catalog,
// simulated checkout, cancel/resume/downgrade lifecycle, billing history.
// Entitlements are enforced server-side; this surface explains them honestly.

import { useEffect, useState, useCallback } from 'react'
import { api, ClientError } from '@/lib/client'
import { useApp } from '@/components/proofloom-app'
import { ProofSeal, PanelSkeleton, EmptyState } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Check, X, Lock, ArrowUpRight, RefreshCcw, CreditCard, ShieldCheck, Zap } from 'lucide-react'

interface PlanCard {
  id: string; name: string; tagline: string; priceMonthlyCents: number
  limits: { projects: number; releasesMonthly: number; attestationsMonthly: number; agents: number; orgMembers: number }
  features: { agentCommand: boolean; policyEngine: boolean; apiKeys: boolean; exportExports: boolean; priorityChainLane: boolean }
  auditRetentionDays: number
  current: boolean
}

interface BillingPayload {
  planId: string
  status: string
  plan: { id: string; name: string; tagline: string }
  trialEndsAt?: string
  currentPeriodEnd?: string
  cancelAtPeriodEnd: boolean
  daysLeftInTrial?: number
  trialExpired?: boolean
  usage: Record<string, { used: number; limit: number; unlimited: boolean; pct: number }>
  events: { id: string; kind: string; fromPlan?: string | null; toPlan: string; createdAt: string }[]
  plans: PlanCard[]
}

const FEATURE_LABELS: Record<string, string> = {
  agentCommand: 'Agent Command console',
  policyEngine: 'Release policy engine',
  apiKeys: 'API keys & machine access',
  exportExports: 'Evidence exports (SLSA bundles)',
  priorityChainLane: 'Priority on-chain lane',
}
const LIMIT_LABELS: Record<string, string> = {
  projects: 'Projects',
  releasesMonthly: 'Releases / month',
  attestationsMonthly: 'Attestations / month',
  agents: 'AI agents',
  orgMembers: 'Org members',
}
const EVENT_LABELS: Record<string, string> = {
  TRIAL_STARTED: 'Trial started', TRIAL_ENDED: 'Trial ended — downgraded to Free',
  PLAN_CHANGED: 'Plan changed', PAYMENT_SUCCEEDED: 'Payment succeeded',
  PAYMENT_FAILED: 'Payment failed', CANCELED: 'Cancellation scheduled',
  REACTIVATED: 'Subscription reactivated', DOWNGRADED: 'Downgraded to Free',
}

function fmtPrice(cents: number) {
  return cents === 0 ? '$0' : `$${Math.round(cents / 100)}`
}
function fmtLimit(n: number) {
  return n === -1 ? 'Unlimited' : n === 0 ? '—' : String(n)
}
function fmtDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function UsageBar({ label, used, limit, unlimited }: { label: string; used: number; limit: number; unlimited: boolean }) {
  const pct = unlimited ? 8 : Math.min(100, limit === 0 ? (used > 0 ? 100 : 4) : Math.round((used / Math.max(1, limit)) * 100))
  const hot = !unlimited && limit > 0 && used >= limit
  const warm = !unlimited && limit > 0 && used >= limit * 0.8
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono text-xs ${hot ? 'text-[var(--critical)]' : warm ? 'text-[var(--pending)]' : 'text-foreground'}`}>
          {used.toLocaleString()} / {unlimited ? '∞' : limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: hot ? 'var(--critical)' : warm ? 'var(--pending)' : 'var(--accent)' }}
        />
      </div>
    </div>
  )
}

export function BillingView() {
  const { orgId, toast, refreshSession, session } = useApp()
  const [data, setData] = useState<BillingPayload | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [checkout, setCheckout] = useState<PlanCard | null>(null)
  const [confirmDowngrade, setConfirmDowngrade] = useState(false)
  const activeOrg = session?.organizations?.find(o => o.id === orgId)
  const isAdmin = activeOrg && ['OWNER', 'ADMIN'].includes(activeOrg.role)

  const load = useCallback(async () => {
    if (!orgId) return
    try { setData(await api.get<BillingPayload>(`/api/billing?orgId=${orgId}`)) }
    catch (e) { toast('error', 'Could not load billing', e instanceof ClientError ? e.message : undefined) }
  }, [orgId, toast])

  useEffect(() => { void load() }, [load])

  const act = useCallback(async (action: string, extra?: Record<string, unknown>, label?: string) => {
    setBusy(action)
    try {
      await api.post('/api/billing', { action, orgId, ...extra })
      toast('success', label ?? 'Plan updated')
      await load()
      await refreshSession()
    } catch (e) {
      toast('error', 'Plan change failed', e instanceof ClientError ? e.message : undefined)
    } finally { setBusy(null) }
  }, [orgId, load, toast, refreshSession])

  if (!data) return <div className="space-y-3">{[0, 1, 2].map(i => <PanelSkeleton key={i} rows={3} />)}</div>

  const onFree = data.planId === 'FREE'
  const trialing = data.status === 'TRIALING'
  const canStartTrial = onFree && !data.events.some(e => e.kind === 'TRIAL_STARTED' || e.kind === 'TRIAL_ENDED')

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Billing & entitlements</p>
        <h1 className="text-2xl atelier-display mt-1">Plan &amp; Billing</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          One subscription per workspace. Public surfaces — explorers, the Proof Atlas, and the verification
          portal — are always free; plans govern what your team can publish.
        </p>
      </header>

      {/* Current plan panel */}
      <section className="loom-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">{data.plan.name}</h2>
              <ProofSeal
                status={data.status === 'TRIALING' ? 'PENDING' : data.status === 'ACTIVE' ? 'VERIFIED' : data.trialExpired ? 'REVOKED' : 'UNKNOWN'}
                label={data.status}
              />
              {data.cancelAtPeriodEnd && <ProofSeal status="PENDING" label="cancels at period end" />}
            </div>
            <p className="text-sm text-muted-foreground mt-1">{data.plan.tagline}</p>
            {trialing && (
              <p className="text-sm mt-2">
                <span className="text-[var(--pending)] font-medium">
                  Trial ends {fmtDate(data.trialEndsAt)} — {data.daysLeftInTrial} day{data.daysLeftInTrial === 1 ? '' : 's'} left.
                </span>{' '}
                <span className="text-muted-foreground">After that, the workspace downgrades to Free automatically: agents, policies and API keys lock, and monthly allowances drop. Nothing is deleted.</span>
              </p>
            )}
            {data.trialExpired && (
              <p className="text-sm mt-2 text-[var(--critical)]">
                Your trial has ended. Pro features are locked and allowances are reduced. Upgrade to restore them — your history is intact.
              </p>
            )}
            {data.currentPeriodEnd && data.status === 'ACTIVE' && !trialing && (
              <p className="text-xs text-muted-foreground mt-2">
                Current period ends {fmtDate(data.currentPeriodEnd)}{data.cancelAtPeriodEnd ? ' — then downgrades to Free' : ''}.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 items-stretch">
            {canStartTrial && (
              <Button onClick={() => void act('start_trial', undefined, '14-day trial started')} disabled={busy === 'start_trial'} className="btn-press">
                <Zap size={14} className="mr-1.5" /> Start 14-day Pro trial
              </Button>
            )}
            {data.cancelAtPeriodEnd && (
              <Button variant="outline" onClick={() => void act('resume', undefined, 'Subscription reactivated')} disabled={busy === 'resume'} className="btn-press">
                <RefreshCcw size={14} className="mr-1.5" /> Resume subscription
              </Button>
            )}
            {!onFree && !data.cancelAtPeriodEnd && (
              <Button variant="outline" onClick={() => void act('cancel', undefined, 'Cancellation scheduled')} disabled={busy === 'cancel'} className="btn-press">
                Cancel at period end
              </Button>
            )}
          </div>
        </div>

        {/* Usage meters */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 mt-5 pt-5 border-t border-[var(--border)]">
          <UsageBar label="Projects" {...data.usage.projects} />
          <UsageBar label="Releases this month" {...data.usage.releasesMonthly} />
          <UsageBar label="Attestations this month" {...data.usage.attestationsMonthly} />
          <UsageBar label="AI agents" {...data.usage.agents} />
          <UsageBar label="Org members" {...data.usage.members} />
        </div>
      </section>

      {/* Plan catalog */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Plans</h2>
          <span className="text-xs text-muted-foreground font-mono">catalog {new Date().getFullYear()}.11</span>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-3">
          {data.plans.map(plan => {
            const isCurrent = plan.current
            const isUpgradeTarget = plan.id === 'PRO' || plan.id === 'ENTERPRISE'
            return (
              <div
                key={plan.id}
                className={`loom-panel p-4 flex flex-col ${isCurrent ? 'border-[var(--accent)]' : ''} ${plan.id === 'PRO' ? 'relative' : ''}`}
              >
                {plan.id === 'PRO' && (
                  <span className="absolute -top-2.5 left-4 seal-verified proof-seal bg-[var(--surface)]">Most popular</span>
                )}
                <div className="flex items-baseline justify-between">
                  <h3 className="font-semibold">{plan.name}</h3>
                  <p className="text-xl atelier-display">
                    {fmtPrice(plan.priceMonthlyCents)}
                    <span className="text-xs text-muted-foreground font-sans">/mo{plan.priceMonthlyCents > 0 ? ' · per workspace' : ''}</span>
                  </p>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{plan.tagline}</p>
                <ul className="mt-3 space-y-1.5 text-xs flex-1">
                  {Object.entries(LIMIT_LABELS).map(([k, label]) => (
                    <li key={k} className="flex items-center gap-2">
                      {plan.limits[k as keyof PlanCard['limits']] === 0
                        ? <X size={12} className="text-muted-foreground shrink-0" />
                        : <Check size={12} className="text-[var(--verified)] shrink-0" />}
                      <span className={plan.limits[k as keyof PlanCard['limits']] === 0 ? 'text-muted-foreground' : ''}>
                        {label}: {fmtLimit(plan.limits[k as keyof PlanCard['limits']])}
                      </span>
                    </li>
                  ))}
                  {Object.entries(FEATURE_LABELS).map(([k, label]) => (
                    <li key={k} className="flex items-center gap-2">
                      {plan.features[k as keyof PlanCard['features']]
                        ? <Check size={12} className="text-[var(--verified)] shrink-0" />
                        : <X size={12} className="text-muted-foreground shrink-0" />}
                      <span className={plan.features[k as keyof PlanCard['features']] ? '' : 'text-muted-foreground'}>{label}</span>
                    </li>
                  ))}
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <ShieldCheck size={12} className="shrink-0" /> Audit retention: {plan.auditRetentionDays} days
                  </li>
                </ul>
                <div className="mt-4">
                  {isCurrent ? (
                    <Button variant="outline" size="sm" disabled className="w-full">Current plan</Button>
                  ) : isUpgradeTarget ? (
                    <Button
                      size="sm" className="w-full btn-press"
                      onClick={() => setCheckout(plan)}
                      disabled={!isAdmin || busy === 'upgrade'}
                    >
                      {!isAdmin && <Lock size={12} className="mr-1" />} Upgrade
                    </Button>
                  ) : plan.id === 'TRIAL' ? (
                    <Button
                      variant="outline" size="sm" className="w-full btn-press"
                      disabled={!isAdmin || !canStartTrial || busy === 'start_trial'}
                      onClick={() => void act('start_trial', undefined, '14-day trial started')}
                    >
                      {!isAdmin ? <><Lock size={12} className="mr-1" /> Admin only</> : canStartTrial ? 'Start trial' : 'Trial used'}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost" size="sm" className="w-full btn-press"
                      disabled={!isAdmin || onFree || busy === 'downgrade_now'}
                      onClick={() => setConfirmDowngrade(true)}
                    >
                      Downgrade to Free
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Billing history */}
      <section className="loom-panel p-5">
        <h2 className="text-lg font-semibold">Billing history</h2>
        {data.events.length === 0 ? (
          <EmptyState
            title="No billing events yet"
            hint="Plan changes, trial milestones and payments appear here as an append-only ledger."
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {data.events.map(e => (
              <li key={e.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-[var(--border)] last:border-0">
                <ProofSeal
                  status={e.kind === 'PAYMENT_SUCCEEDED' || e.kind === 'TRIAL_STARTED' ? 'VERIFIED' : e.kind === 'PAYMENT_FAILED' || e.kind === 'TRIAL_ENDED' ? 'REJECTED' : 'PENDING'}
                  label={e.kind}
                />
                <span className="flex-1 text-muted-foreground">
                  {EVENT_LABELS[e.kind] ?? e.kind}
                  {e.fromPlan && e.fromPlan !== e.toPlan ? ` · ${e.fromPlan} → ${e.toPlan}` : ''}
                </span>
                <span className="text-xs text-muted-foreground font-mono">{fmtDate(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Simulated checkout dialog */}
      <Dialog open={!!checkout} onOpenChange={o => !o && setCheckout(null)}>
        <DialogContent className="sm:max-w-md">
          {checkout && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CreditCard size={16} className="text-[var(--accent)]" /> Upgrade to {checkout.name}
                </DialogTitle>
                <DialogDescription>
                  {fmtPrice(checkout.priceMonthlyCents)}/month per workspace, billed monthly. This demo runs a
                  simulated payment provider — no card is charged. The Stripe/Paddle integration point is the
                  same plan-change transaction the demo activates.
                </DialogDescription>
              </DialogHeader>
              <ul className="text-sm space-y-1.5 my-2">
                <li className="flex justify-between"><span className="text-muted-foreground">Plan</span><span className="font-medium">{checkout.name}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">Projects</span><span className="font-mono text-xs">{fmtLimit(checkout.limits.projects)}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">Releases / month</span><span className="font-mono text-xs">{fmtLimit(checkout.limits.releasesMonthly)}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">Agents unlocked</span><span className="font-mono text-xs">{fmtLimit(checkout.limits.agents)}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">Audit retention</span><span className="font-mono text-xs">{checkout.auditRetentionDays} days</span></li>
              </ul>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCheckout(null)}>Cancel</Button>
                <Button
                  className="btn-press"
                  disabled={busy === 'upgrade'}
                  onClick={async () => {
                    const plan = checkout.id
                    setCheckout(null)
                    await act('upgrade', { plan }, `Upgraded to ${checkout.name} — Pro features unlocked`)
                  }}
                >
                  <ArrowUpRight size={14} className="mr-1" /> Confirm upgrade
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Downgrade confirmation */}
      <Dialog open={confirmDowngrade} onOpenChange={setConfirmDowngrade}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Downgrade to Free now?</DialogTitle>
            <DialogDescription>
              Agent Command, the policy engine and API keys lock immediately, and monthly allowances drop to
              the Free plan. Projects, releases, attestations and your audit trail are kept — you can upgrade
              again any time to restore access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDowngrade(false)}>Keep current plan</Button>
            <Button
              variant="destructive"
              disabled={busy === 'downgrade_now'}
              onClick={async () => {
                setConfirmDowngrade(false)
                await act('downgrade_now', undefined, 'Downgraded to Free')
              }}
            >
              Downgrade now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
