'use client'

// Documentation view: developer docs, API reference, protocol architecture,
// security & trust centre, pricing — one editorial surface with sections.

import { navigate, type Route } from '@/components/proofloom-app'
import { HashChip, CopyButton } from '@/components/atelier/kit'
import { useEffect } from 'react'
import { useApp } from '@/components/proofloom-app'

export function DocsView({ route }: { route: Route; go: (r: Route) => void; session: unknown; orgId: unknown }) {
  const { toast } = useApp()
  const section = (route as { section?: string }).section ?? 'start'

  useEffect(() => {
    document.getElementById(`doc-${section}`)?.scrollIntoView({ behavior: 'smooth' })
  }, [section])

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const sections = [
    { id: 'start', label: 'Getting started' },
    { id: 'protocol', label: 'Protocol architecture' },
    { id: 'api', label: 'API reference' },
    { id: 'security', label: 'Security & trust' },
    { id: 'pricing', label: 'Pricing' },
  ]

  return (
    <div className="mx-auto max-w-[1100px] px-4 lg:px-6 py-10 flex gap-8">
      <nav className="hidden lg:block w-52 shrink-0" aria-label="Documentation sections">
        <div className="sticky top-[calc(var(--header-h)+24px)] space-y-1">
          {sections.map(s => (
            <button key={s.id} onClick={() => navigate({ view: 'docs', section: s.id })}
              className={`block w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${section === s.id ? 'text-foreground bg-[var(--surface)] border border-[var(--border)]' : 'text-muted-foreground hover:text-foreground'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="flex-1 min-w-0 space-y-14">
        {/* Getting started */}
        <section id="doc-start">
          <p className="eyebrow mb-3">Getting started</p>
          <h1 className="atelier-display" style={{ fontSize: 'var(--text-2xl)' }}>Publish your first verified release</h1>
          <ol className="mt-5 space-y-4 text-sm">
            {[
              ['Create an account', 'A default organization is created for you. Invite teammates with scoped roles later.'],
              ['Register a project', 'Projects get a protocol slug — the root identifier for everything that follows.'],
              ['Create a release', 'Pin the source commit, name the build environment, attach the sha256 artifact digest.'],
              ['Attach evidence', 'Build logs, test reports, SBOMs, scan results — each is content-hashed (sha256) at upload.'],
              ['Attest', 'Issuers attest categories against evidence digests. Attestation ids are deterministic: subject-category-issuer.'],
              ['Publish on-chain', 'Commit the release to the releases realm on Gno.land Onyx. State-based reconciliation confirms it.'],
              ['Verify publicly', 'Anyone verifies via the portal, the JSON API, or the embeddable widget — no account needed.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="font-mono text-xs text-[var(--accent)] pt-1">{String(i + 1).padStart(2, '0')}</span>
                <div><p className="font-medium">{t}</p><p className="text-muted-foreground">{d}</p></div>
              </li>
            ))}
          </ol>
        </section>

        {/* Protocol */}
        <section id="doc-protocol">
          <p className="eyebrow mb-3">Protocol architecture</p>
          <h2 className="atelier-display" style={{ fontSize: 'var(--text-xl)' }}>Realms, ownership, composability</h2>
          <div className="mt-4 loom-panel p-5 space-y-3 text-sm">
            <p className="text-muted-foreground">
              PROOFLOOM deploys seven realm packages under a single publisher namespace. Each has one
              responsibility, explicit ownership, and value-copy read interfaces. No goroutines, no OS access,
              no networking inside realms — deterministic execution only.
            </p>
            <div className="font-mono-sm text-xs space-y-1.5">
              {[
                ['core', 'validation helpers, deterministic ids, status vocabulary (pure library)'],
                ['registry', 'projects + components; the ownership backbone every realm consults'],
                ['releases', 'release records + the authoritative state machine (DRAFT → … → PUBLISHED/VERIFIED)'],
                ['attestations', 'evidence commitments: subject+category+issuer, revocation, expiry'],
                ['agents', 'agent identities, scoped expiring grants, execution receipts'],
                ['policies', 'versioned publication policies per project'],
                ['verify', 'read-only verification facade — the composability contract for third parties'],
              ].map(([pkg, d]) => (
                <div key={pkg} className="flex gap-3">
                  <span className="text-[var(--accent)] w-24 shrink-0">{pkg}</span>
                  <span className="text-muted-foreground">{d}</span>
                </div>
              ))}
            </div>
            <div className="pt-3 border-t border-[var(--border)]">
              <p className="font-medium mb-1.5">Consumer example (composability proof)</p>
              <p className="text-muted-foreground mb-2">
                A separate consumer realm imports only the verify facade and implements its own release gate —
                it holds no authority over protocol state and never imports write-side realms:
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="hash-chip">import &quot;…/proofloom/verify&quot;</code>
                <span className="text-muted-foreground">→</span>
                <code className="hash-chip">ReleaseGate(releaseID) (bool, string)</code>
              </div>
            </div>
          </div>
        </section>

        {/* API */}
        <section id="doc-api">
          <p className="eyebrow mb-3">API reference</p>
          <h2 className="atelier-display" style={{ fontSize: 'var(--text-xl)' }}>Public verification API</h2>
          <p className="text-sm text-muted-foreground mt-2">No account, no key. Rate-limited per IP (120 req/min).</p>
          <div className="mt-4 space-y-2">
            {[
              ['GET', '/api/verify/release/{protocolId}', 'Full verification report: 10 checks, on-chain state, limitations'],
              ['GET', '/api/verify/attestation/{protocolId}', 'Attestation status: ACTIVE / REVOKED / EXPIRED / unknown'],
              ['GET', '/api/verify/digest/{sha256}', 'Published releases committing a content digest'],
              ['GET', '/api/public/explore?kind=summary', 'Public projects, releases, attestations, chain stats'],
              ['GET', '/api/public/explore?kind=project&id={slug}', 'Public project record with releases and policy'],
              ['GET', '/api/health', 'Service and chain health (readiness probe)'],
            ].map(([method, path, d]) => (
              <div key={path} className="loom-panel p-3.5 flex items-center gap-3 flex-wrap">
                <span className={`proof-seal ${method === 'GET' ? 'seal-info' : 'seal-pending'}`}>{method}</span>
                <code className="font-mono-sm text-xs flex-1 break-all">{path}</code>
                <span className="text-xs text-muted-foreground w-full md:w-auto">{d}</span>
              </div>
            ))}
          </div>
          <div className="loom-panel p-5 mt-4">
            <p className="eyebrow mb-2">Try it</p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="hash-chip">curl {origin}/api/public/explore?kind=summary</code>
              <CopyButton text={`curl ${origin}/api/public/explore?kind=summary`} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Authenticated endpoints (projects, releases, attestations, agents, policies) use session cookies or
              Bearer API credentials. Uniform envelope: <code className="font-mono-sm">{`{ data }`}</code> or
              <code className="font-mono-sm"> {`{ error: { code, message, recovery } }`}</code>.
            </p>
          </div>
        </section>

        {/* Security */}
        <section id="doc-security">
          <p className="eyebrow mb-3">Security & trust centre</p>
          <h2 className="atelier-display" style={{ fontSize: 'var(--text-xl)' }}>What we protect, and how</h2>
          <div className="mt-4 grid md:grid-cols-2 gap-3">
            {[
              ['Authentication', 'scrypt password hashing (memory-hard), opaque 256-bit session tokens hashed at rest, httpOnly + SameSite cookies, 7-day rotation, server-side MFA (TOTP).'],
              ['Authorization', 'Role capability matrix enforced server-side on every handler — the UI never gates security. Tenant isolation on all queries.'],
              ['State machines', 'Release and task transitions validated server-side and mirrored in the realms; published records immutable except visible revocation.'],
              ['Evidence integrity', 'sha256 content addressing at ingest; verification re-computes digests from bytes and reports mismatches explicitly.'],
              ['On-chain authority', 'Authorization enforced by realm functions (cur.Previous().Address()), never by UI. Adversarial realm tests cover caller spoofing, duplicate ops, cross-realm abuse.'],
              ['Secrets', 'API keys hashed (sha256); operator mnemonic only via environment at runtime; webhook HMAC validation; no secrets in protocol state.'],
              ['Rate limiting', 'Fixed-window DB-backed limiter on auth, public verification, API and agent executions.'],
              ['Audit', 'Append-only audit events for every privileged action with actor, target, IP and trace id. No delete path exists.'],
            ].map(([t, d]) => (
              <div key={t} className="loom-panel p-4">
                <p className="text-sm font-semibold mb-1.5">{t}</p>
                <p className="text-xs text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
          <div className="parchment-section rounded-md p-5 mt-4 text-sm">
            <p className="eyebrow mb-2">Honest limitations</p>
            <ul className="space-y-1.5" style={{ color: 'color-mix(in oklab, var(--text-on-editorial) 78%, transparent)' }}>
              <li>— PROOFLOOM has not been independently audited. A third-party review is a mainnet-readiness gate.</li>
              <li>— Testnet deployments are subject to testnet resets; platform records remain the durable system of record.</li>
              <li>— Verification proves origin and integrity of evidence — not that software is safe to run.</li>
              <li>— Inline evidence is capped at 512 KiB; object-storage-backed evidence verifies by digest and reference.</li>
            </ul>
          </div>
        </section>

        {/* Pricing */}
        <section id="doc-pricing">
          <p className="eyebrow mb-3">Pricing</p>
          <h2 className="atelier-display" style={{ fontSize: 'var(--text-xl)' }}>Verification is free. Scale is paid.</h2>
          <div className="mt-4 grid md:grid-cols-3 gap-3">
            {[
              { name: 'Public & OSS', price: '$0', items: ['Unlimited public verification', 'Public project registry', 'Community policy templates', 'Public JSON API'] },
              { name: 'Team', price: '$49/mo', items: ['Private projects & registries', 'Policy enforcement & simulation', 'Agent registry & approvals', 'Audit export, API credentials'] },
              { name: 'Enterprise', price: 'Custom', items: ['Self-hosted deployment', 'SSO & org SSO policy packs', 'Compliance evidence workflows', 'SLA-backed verification API'] },
            ].map(tier => (
              <div key={tier.name} className={`p-5 ${tier.name === 'Team' ? 'loom-panel-raised border-[color:var(--accent)]' : 'loom-panel'}`}>
                <p className="text-sm font-semibold">{tier.name}</p>
                <p className="atelier-display text-3xl mt-2">{tier.price}</p>
                <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                  {tier.items.map(i => <li key={i}>— {i}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            No token. Verification stays public regardless of plan — the protocol layer is commons, the operational layer is the product.
          </p>
        </section>
      </div>
    </div>
  )
}
