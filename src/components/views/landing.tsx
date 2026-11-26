'use client'

// Landing view — ATELIER editorial environment.
// Editorial composition: problem → protocol → surfaces → composability.

import { useEffect, useState } from 'react'
import { Emblem, Wordmark } from '@/components/atelier/emblem'
import { ProofSeal, HashChip } from '@/components/atelier/kit'
import { useApp, navigate, type Route } from '@/components/proofloom-app'
import { api } from '@/lib/client'
import { ArrowRight, ArrowUpRight, ShieldCheck, FileSearch, Boxes, Network, Fingerprint, GitBranch, KeyRound } from 'lucide-react'

interface PublicSummary {
  projects: { id: string; slug: string; name: string; description: string; releaseCount: number }[]
  releases: { id: string; protocolId: string; project: string; version: string; status: string }[]
  chain: { chainId: string; label: string; realmPrefix: string }
  onChainStats: { projects: number; components: number; releases: number; attestations: number } | null
}

export function LandingView({ go }: { route: Route; go: (r: Route) => void; session: unknown; orgId: unknown }) {
  const { session } = useApp()
  const [summary, setSummary] = useState<PublicSummary | null>(null)

  useEffect(() => {
    api.get<PublicSummary>('/api/public/explore?kind=summary')
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  const authed = !!session?.authenticated

  return (
    <div>
      {/* Hero — editorial parchment */}
      <section className="parchment-section">
        <div className="mx-auto max-w-[1400px] px-4 lg:px-6 py-16 lg:py-24">
          <div className="max-w-3xl">
            <p className="eyebrow mb-5">Gnome Tavern Hackathon · Gno.land Onyx Testnet</p>
            <h1 className="atelier-display" style={{ fontSize: 'clamp(2.6rem, 6vw, 4.6rem)' }}>
              Software claims are cheap.<br />
              <em style={{ fontStyle: 'italic', color: 'color-mix(in oklab, var(--text-on-editorial) 72%, transparent)' }}>
                Evidence isn&apos;t.
              </em>
            </h1>
            <p className="mt-6 text-lg leading-relaxed max-w-2xl" style={{ color: 'color-mix(in oklab, var(--text-on-editorial) 78%, transparent)' }}>
              PROOFLOOM is a verifiable provenance layer for software and AI agents.
              Every release carries cryptographic evidence, every attestation is committed
              on-chain, and anyone — not just customers — can verify the record
              through the public protocol.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={() => go(authed ? { view: 'workspace' } : { view: 'auth' })}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold btn-press"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                {authed ? 'Open workspace' : 'Start verifying'} <ArrowRight size={15} />
              </button>
              <button
                onClick={() => go({ view: 'verify' })}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold btn-press border"
                style={{ borderColor: 'color-mix(in oklab, var(--text-on-editorial) 25%, transparent)', color: 'var(--text-on-editorial)' }}
              >
                <FileSearch size={15} /> Verify a release — no account needed
              </button>
            </div>
            <div className="mt-10 flex flex-wrap gap-2">
              <HashChip value="onyx-1" display="chain: onyx-1" />
              <HashChip value="gno.land" display="network: gno.land" />
              <HashChip value="realms" display={`realms: r/${summary?.chain.realmPrefix.split('/').pop() ?? 'proofloom'}/*`} />
            </div>
          </div>
        </div>
      </section>

      {/* The problem — observatory */}
      <section className="mx-auto max-w-[1400px] px-4 lg:px-6 py-16">
        <div className="grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4">
            <p className="eyebrow mb-4">The problem</p>
            <h2 className="atelier-display" style={{ fontSize: 'var(--text-3xl)' }}>
              Trust today is a <em style={{ fontStyle: 'italic' }}>dashboard screenshot</em>.
            </h2>
          </div>
          <div className="lg:col-span-8 grid md:grid-cols-3 gap-4">
            {[
              { icon: GitBranch, title: 'A release "passed tests"', body: 'Says who? Where are the test records? Could an auditor re-derive the result from the artifact digest alone?' },
              { icon: Boxes, title: 'An AI agent "completed the task"', body: 'Agents ship real work. Nothing records what they ran, with what permissions, and who approved the outcome.' },
              { icon: ShieldCheck, title: 'An org "reviewed the dependency"', body: 'Software claims live in READMEs, tickets, private dashboards. None of it is independently checkable.' },
            ].map(item => (
              <div key={item.title} className="loom-panel p-5">
                <item.icon size={20} className="text-[var(--accent)] mb-3" />
                <p className="text-sm font-semibold mb-2">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The protocol — evidence flow */}
      <section className="border-y border-[var(--border)] obs-grid">
        <div className="mx-auto max-w-[1400px] px-4 lg:px-6 py-16">
          <p className="eyebrow mb-3">The protocol</p>
          <h2 className="atelier-display max-w-2xl" style={{ fontSize: 'var(--text-3xl)' }}>
            Evidence becomes a public record. Claims become commitments.
          </h2>
          <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { n: '01', t: 'Register', d: 'Projects and components get protocol identifiers, owned by real Gno addresses.' },
              { n: '02', t: 'Produce', d: 'Releases carry source revision, build environment, tests, SBOM, and a sha256 artifact digest.' },
              { n: '03', t: 'Commit', d: 'Issuers attest. Digests and signatures are committed to Gno.land realms — small, verifiable, permanent.' },
              { n: '04', t: 'Verify', d: 'Anyone queries the public verify realm: policy verdicts, revocations, issuer proofs — no account required.' },
            ].map(s => (
              <div key={s.n} className="loom-panel-raised p-5">
                <p className="font-mono text-xs text-[var(--accent)] mb-3">{s.n}</p>
                <p className="text-sm font-semibold mb-2">{s.t}</p>
                <p className="text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>

          {/* Realm architecture strip */}
          <div className="mt-10 loom-panel p-5">
            <p className="eyebrow mb-3">On-chain surface — gno.land/r/…/proofloom/</p>
            <div className="flex flex-wrap gap-2">
              {['core', 'registry', 'releases', 'attestations', 'agents', 'policies', 'verify'].map(pkg => (
                <span key={pkg} className="hash-chip" style={{ color: pkg === 'verify' ? 'var(--accent)' : undefined }}>{pkg}</span>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mt-3">
              The verify realm is the composability contract: external realms import it and answer
              verification questions without holding any authority.
            </p>
          </div>
        </div>
      </section>

      {/* Live protocol state */}
      <section className="mx-auto max-w-[1400px] px-4 lg:px-6 py-16">
        <div className="flex items-baseline justify-between flex-wrap gap-4 mb-8">
          <div>
            <p className="eyebrow mb-3">Live on the testnet</p>
            <h2 className="atelier-display" style={{ fontSize: 'var(--text-2xl)' }}>Public records, right now</h2>
          </div>
          <button onClick={() => go({ view: 'explore' })} className="text-sm text-[var(--accent)] hover:underline inline-flex items-center gap-1">
            Open explorers <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="grid md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Projects registered', value: summary?.onChainStats?.projects ?? summary?.projects.length ?? 0, source: 'platform registry' },
            { label: 'Releases published', value: summary?.onChainStats?.releases ?? summary?.releases.length ?? 0, source: 'platform registry' },
            { label: 'Attestations recorded', value: summary?.onChainStats?.attestations ?? 0, source: 'platform registry' },
            { label: 'Network', value: 'onyx-1', source: summary?.onChainStats ? 'on-chain realm' : 'platform registry' },
          ].map(stat => (
            <div key={stat.label} className="loom-panel p-5">
              <p className="text-3xl atelier-display">{typeof stat.value === 'number' ? stat.value : <span className="text-xl">{stat.value}</span>}</p>
              <p className="text-sm mt-1">{stat.label}</p>
              <p className="eyebrow mt-2">source: {stat.source}</p>
            </div>
          ))}
        </div>
        {summary && summary.releases.length > 0 ? (
          <div className="loom-panel divide-y divide-[var(--border)]">
            {summary.releases.slice(0, 5).map(r => (
              <div key={r.id} className="flex items-center gap-3 p-4 flex-wrap">
                <HashChip value={r.protocolId} display={r.protocolId} />
                <ProofSeal status={r.status} />
                <span className="flex-1" />
                <button onClick={() => go({ view: 'verify', query: r.protocolId })} className="text-xs text-[var(--accent)] hover:underline">
                  verify this record →
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="loom-panel p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No published releases yet. Register a project and publish the first record.
            </p>
            <button onClick={() => go(authed ? { view: 'workspace' } : { view: 'auth' })} className="mt-3 text-sm text-[var(--accent)] hover:underline">
              Get started →
            </button>
          </div>
        )}
      </section>

      {/* Agent accountability */}
      <section className="border-y border-[var(--border)]">
        <div className="mx-auto max-w-[1400px] px-4 lg:px-6 py-16 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="eyebrow mb-3">Agent accountability</p>
            <h2 className="atelier-display" style={{ fontSize: 'var(--text-3xl)' }}>
              AI agents are first-class participants — never implicit authorities.
            </h2>
            <p className="text-muted-foreground mt-4">
              Agents register with scoped, expiring, revocable permissions. Their work produces
              structured execution reports with content digests. Publication always requires a
              human approval. Every receipt is auditable — on-chain when it matters.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['least-privilege grants', 'approval gates', 'execution receipts', 'duplicate protection', 'emergency revocation'].map(t => (
                <span key={t} className="proof-seal seal-info">{t}</span>
              ))}
            </div>
          </div>
          <div className="loom-panel p-5 space-y-3">
            {[
              { step: 'Task assigned', detail: 'Project owner assigns a task with evidence requirements' },
              { step: 'Scoped execution', detail: 'Agent runs under READ/EVIDENCE/TASK_UPDATE scopes — never publish' },
              { step: 'Report + digest', detail: 'Structured report validated against schema; sha256 bound' },
              { step: 'Human approval', detail: 'Reviewer approves or rejects; receipt recorded' },
              { step: 'Attestation', detail: 'Commitment issued; optionally committed on-chain' },
            ].map((s, i) => (
              <div key={s.step} className="flex gap-3">
                <span className="font-mono text-xs text-[var(--accent)] pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <p className="text-sm font-medium">{s.step}</p>
                  <p className="text-xs text-muted-foreground">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust & pricing teaser */}
      <section className="mx-auto max-w-[1400px] px-4 lg:px-6 py-16 grid md:grid-cols-3 gap-4">
        {[
          { icon: Fingerprint, title: 'Verification is public', body: 'The public portal, JSON API, and embeddable widget let anyone verify a record without registering.', cta: 'Verification portal', r: { view: 'verify' } as Route },
          { icon: KeyRound, title: 'Keys stay yours', body: 'Signing happens in your wallet (Adena / GnoConnect). The platform never sees a private key, and secrets never enter protocol state.', cta: 'Security centre', r: { view: 'docs', section: 'security' } as Route },
          { icon: Network, title: 'Commercial from day one', body: 'Free for public projects and verification. Team plans add private registries, policy enforcement, and audit exports.', cta: 'Pricing', r: { view: 'billing' } as Route },
        ].map(card => (
          <div key={card.title} className="loom-panel p-6">
            <card.icon size={20} className="text-[var(--accent)] mb-3" />
            <p className="font-semibold mb-2">{card.title}</p>
            <p className="text-sm text-muted-foreground mb-4">{card.body}</p>
            <button onClick={() => go(card.r)} className="text-sm text-[var(--accent)] hover:underline inline-flex items-center gap-1">
              {card.cta} <ArrowUpRight size={13} />
            </button>
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-y border-[var(--border)] obs-grid">
        <div className="mx-auto max-w-[1400px] px-4 lg:px-6 py-16">
          <p className="eyebrow">Pricing</p>
          <h2 className="atelier-display mt-2" style={{ fontSize: 'var(--text-2xl)' }}>
            Verification is free. Scale is priced like infrastructure.
          </h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Public records stay public on every plan. Plans govern what your team can publish —
            and every workspace starts with a 14-day Pro trial, no card required.
          </p>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-8">
            {[
              { name: 'Free', price: '$0', tag: 'Public verification, forever.', points: ['2 projects', '3 releases / month', '10 attestations / month', 'Public explorers + verify API'], current: false, highlight: false },
              { name: 'Pro', price: '$49', tag: 'For shipping teams that prove their work.', points: ['25 projects, 100 releases / month', 'Agent Command + policy engine', 'API keys & evidence exports', '90-day audit retention'], current: false, highlight: true },
              { name: 'Enterprise', price: '$499', tag: 'Governance, retention, priority lane.', points: ['Unlimited projects & members', '50 agents, priority on-chain lane', '365-day audit retention', 'Governance reviews & SLA'], current: false, highlight: false },
            ].map(p => (
              <div key={p.name} className={`loom-panel p-5 relative ${p.highlight ? 'border-[var(--accent)]' : ''}`}>
                {p.highlight && <span className="absolute -top-2.5 left-4 proof-seal seal-verified bg-[var(--surface)]">Most popular</span>}
                <div className="flex items-baseline justify-between">
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="text-xl atelier-display">{p.price}<span className="text-xs text-muted-foreground font-sans">/mo</span></p>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{p.tag}</p>
                <ul className="mt-3 space-y-1.5 text-xs">
                  {p.points.map(pt => (
                    <li key={pt} className="flex items-start gap-2">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--verified)" strokeWidth="2" className="mt-0.5 shrink-0"><path d="M3 8.5l3 3L13 5" /></svg>
                      {pt}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => go(authed ? { view: 'billing' } : { view: 'auth' })}
                  className={`mt-4 w-full py-2 rounded-md text-sm btn-press border ${p.highlight ? 'font-semibold' : ''}`}
                  style={p.highlight
                    ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' }
                    : { borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                >
                  {authed ? 'See plans' : p.name === 'Free' ? 'Start free' : 'Start 14-day trial'}
                </button>
              </div>
            ))}
            <div className="loom-panel p-5 flex flex-col justify-center">
              <p className="eyebrow mb-2">No card required</p>
              <p className="text-sm text-muted-foreground mb-4">
                One click provisions a trial workspace with the full product unlocked. At day 14 it
                downgrades to Free automatically — nothing is deleted, upgrade any time.
              </p>
              <button
                onClick={() => go({ view: 'auth' })}
                className="inline-flex items-center gap-1.5 text-sm text-[var(--accent)] hover:underline"
              >
                Try the one-click demo <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-[1400px] px-4 lg:px-6 py-16">
        <p className="eyebrow">Questions</p>
        <h2 className="atelier-display mt-2 mb-8" style={{ fontSize: 'var(--text-2xl)' }}>
          What reviewers, auditors and engineers ask us
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { q: 'Does verifying a release require an account?', a: 'No. The verification portal, the JSON API, and every public explorer are open. Verification is the product\'s free core — you paste a release id, attestation id, or digest and receive the full verdict with every check that ran.' },
            { q: 'What happens when the AI agent makes a mistake?', a: 'Nothing reaches the chain without a human approval gate. Agents hold least-privilege, expiring grants; their executions are recorded with input and output digests; every publication requires an explicit approval — and every approval, revocation and grant change lands in the append-only audit trail.' },
            { q: 'Where do the attestations live?', a: 'Digests and lifecycle state are committed to PROOFLOOM realms on the Gno.land Onyx testnet. Evidence bytes live with the release record; the chain holds the tamper-evident commitments. Other realms can import the public verify facade to answer "is this release verified?" without holding authority.' },
            { q: 'Who signs on-chain operations?', a: 'You do, for anything owned by you — wallet linking uses a signature challenge, and user-owned operations are signed client-side in Adena or GnoConnect. Platform-operated transactions run through a separate deployment account whose credential is runtime-only and never committed.' },
            { q: 'What happens to my workspace at the end of a trial?', a: 'It downgrades to Free automatically: agents, the policy engine and API keys lock, monthly allowances drop — but projects, releases, attestations and the audit trail are kept. Upgrade restores everything; there is no export hostage-taking.' },
            { q: 'Can we self-host the protocol realms?', a: 'Yes. The realm suite in chain/realms deploys with gnodev to any Gno.land node — local, testnet, or main. The product speaks to it through the same public API, so a self-hosted registry and the hosted explorer can coexist over identical commitments.' },
          ].map(f => (
            <details key={f.q} className="loom-panel p-5 group">
              <summary className="flex items-center justify-between cursor-pointer list-none font-medium text-sm">
                {f.q}
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 transition-transform group-open:rotate-45 text-muted-foreground"><path d="M8 3v10M3 8h10" /></svg>
              </summary>
              <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="parchment-section">
        <div className="mx-auto max-w-[1400px] px-4 lg:px-6 py-20 text-center">
          <Emblem size={40} tone="ink" className="mx-auto mb-6" />
          <h2 className="atelier-display" style={{ fontSize: 'var(--text-3xl)' }}>
            Build the record. Prove the work.
          </h2>
          <p className="mt-3 text-sm" style={{ color: 'color-mix(in oklab, var(--text-on-editorial) 65%, transparent)' }}>
            PROOFLOOM — the architecture of trust, made visible.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <button
              onClick={() => go(authed ? { view: 'workspace' } : { view: 'auth' })}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold btn-press"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              {authed ? 'Open workspace' : 'Create an account'} <ArrowRight size={15} />
            </button>
            <button
              onClick={() => go({ view: 'atlas' })}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold btn-press border"
              style={{ borderColor: 'color-mix(in oklab, var(--text-on-editorial) 25%, transparent)', color: 'var(--text-on-editorial)' }}
            >
              Explore the Proof Atlas
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
