'use client'

// Public verification portal — no account needed. Queries the platform and
// the on-chain realm, renders the full check-by-check verdict with explicit
// limitations, and offers the embeddable widget + JSON API hand-off.

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/client'
import { useApp, navigate, type Route } from '@/components/proofloom-app'
import { ProofSeal, HashChip, CopyButton, Spinner } from '@/components/atelier/kit'
import { GlyphVerified, GlyphPending, GlyphRevoked } from '@/components/atelier/emblem'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

interface CheckResult { requirement: string; passed: boolean; detail: string }
interface Report {
  targetType: string
  targetId: string
  verdict: string
  checks: CheckResult[]
  onChain?: { network: string; realm: string; txHash?: string; chainVerdict?: string; releaseStatus?: string }
  limitations: string[]
  durationMs: number
  matches?: { releaseId: string; protocolId: string; project: string; version: string; status: string }[]
}

const VERDICT_TONE: Record<string, string> = {
  VERIFIED: 'seal-verified', PENDING: 'seal-pending', REVOKED: 'seal-revoked',
  EXPIRED: 'seal-revoked', FAILED: 'seal-critical', UNKNOWN: 'seal-unknown', PARTIAL: 'seal-pending',
}

export function VerifyPortalView({ route }: { route: Route; go: (r: Route) => void; session: unknown; orgId: unknown }) {
  const { toast } = useApp()
  const initial = (route as { query?: string }).query ?? ''
  const [query, setQuery] = useState(initial)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    setLoading(true)
    setReport(null)
    try {
      const isDigest = /^[0-9a-f]{64}$/.test(trimmed)
      const isProtocolId = /^[a-z0-9-]+-[0-9a-z.+-]+$/i.test(trimmed) && !isDigest
      const kind = isDigest ? 'digest' : 'attestation'
      // Try release protocol id first, then attestation, then digest.
      const attempts = isDigest
        ? [`/api/verify/digest/${trimmed}`]
        : isProtocolId
          ? [`/api/verify/release/${encodeURIComponent(trimmed)}`, `/api/verify/attestation/${encodeURIComponent(trimmed)}`]
          : [`/api/verify/attestation/${encodeURIComponent(trimmed)}`]
      let last: Report | null = null
      for (const path of attempts) {
        const res = await api.get<Report>(path)
        if (res.verdict !== 'UNKNOWN' || attempts.length === 1) { last = res; break }
        last = res
      }
      setReport(last)
    } catch (e) {
      setReport({
        targetType: 'QUERY', targetId: trimmed, verdict: 'UNKNOWN', checks: [],
        limitations: [], durationMs: 0,
      })
      void e
      toast('error', 'Verification query failed', 'The endpoint may be unreachable. Try again shortly.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { if (initial) void run(initial) }, [initial, run])

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-10 space-y-8">
      <header className="text-center">
        <p className="eyebrow mb-3">Public verification portal</p>
        <h1 className="atelier-display" style={{ fontSize: 'var(--text-3xl)' }}>Verify a record</h1>
        <p className="text-sm text-muted-foreground mt-3 max-w-xl mx-auto">
          Enter a release protocol id (<span className="font-mono-sm">project-1.2.3</span>), an attestation
          identifier, or a sha256 content digest. No account needed — the protocol is public.
        </p>
      </header>

      <form onSubmit={e => { e.preventDefault(); void run(query) }} className="flex gap-2 max-w-2xl mx-auto" role="search">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="project-1.2.3 · attestation id · sha256 digest"
            className="pl-9 font-mono-sm" aria-label="Verification query" />
        </div>
        <Button type="submit" disabled={loading} className="btn-press">Verify</Button>
      </form>

      <div className="text-center text-xs text-muted-foreground space-x-3">
        <span>Machine API:</span>
        <code className="hash-chip">GET /api/verify/release/&#123;id&#125;</code>
        <code className="hash-chip">GET /api/verify/digest/&#123;sha256&#125;</code>
      </div>

      {loading && <div className="flex justify-center"><Spinner label="querying platform and chain state" /></div>}

      {report && !loading && (
        <div className="loom-panel-raised p-6 space-y-6">
          {/* Verdict header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              {report.verdict === 'VERIFIED' ? <GlyphVerified className="text-[var(--verified)] w-7 h-7 seal-land" />
                : report.verdict === 'PENDING' ? <GlyphPending className="text-[var(--pending)] w-7 h-7" />
                : ['REVOKED', 'EXPIRED'].includes(report.verdict) ? <GlyphRevoked className="text-[var(--revoked)] w-7 h-7" />
                : <GlyphPending className="text-muted-foreground w-7 h-7" />}
              <div>
                <p className="atelier-display text-xl">{report.verdict}</p>
                <p className="font-mono-sm text-muted-foreground">{report.targetType.toLowerCase()} · {report.targetId.slice(0, 40)}{report.targetId.length > 40 ? '…' : ''}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`proof-seal ${VERDICT_TONE[report.verdict] ?? 'seal-unknown'}`}>{report.verdict}</span>
              {report.targetType !== 'DIGEST' && report.targetId && (
                <Button variant="outline" size="sm" className="btn-press" onClick={() => {
                  const url = `${window.location.origin}/#/verify/${encodeURIComponent(report.targetId)}`
                  void navigator.clipboard.writeText(url)
                  toast('success', 'Verification URL copied', url)
                }}>Copy shareable link</Button>
              )}
            </div>
          </div>

          {/* Digest matches */}
          {report.matches && report.matches.length > 0 && (
            <div className="space-y-2">
              <p className="eyebrow">Releases committing this digest</p>
              {report.matches.map(m => (
                <div key={m.releaseId} className="flex items-center gap-3 p-3 loom-panel flex-wrap">
                  <HashChip value={m.protocolId} display={m.protocolId} />
                  <ProofSeal status={m.status} />
                  <span className="text-xs text-muted-foreground">{m.project} v{m.version}</span>
                  <span className="flex-1" />
                  <Button size="sm" variant="ghost" className="btn-press" onClick={() => void run(m.protocolId)}>
                    verify record →
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Checks */}
          {report.checks.length > 0 && (
            <div className="space-y-2">
              <p className="eyebrow">Verification checks — what was actually checked</p>
              {report.checks.map((c, i) => (
                <div key={i} className="flex items-start gap-2.5 text-sm">
                  {c.passed ? <GlyphVerified className="text-[var(--verified)] mt-0.5 shrink-0" />
                    : <GlyphPending className="text-[var(--pending)] mt-0.5 shrink-0" />}
                  <div>
                    <span className="font-mono-sm">{c.requirement}</span>
                    <span className="text-muted-foreground"> — {c.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* On-chain state */}
          {report.onChain && (
            <div className="loom-panel p-4 space-y-2">
              <p className="eyebrow">On-chain state</p>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-muted-foreground">network:</span> <HashChip value={report.onChain.network} display={report.onChain.network} />
                {report.onChain.releaseStatus && <ProofSeal status={report.onChain.releaseStatus} label={`realm status: ${report.onChain.releaseStatus}`} />}
                {report.onChain.txHash && <HashChip value={report.onChain.txHash} display={`tx ${report.onChain.txHash.slice(0, 12)}…${report.onChain.txHash.slice(-6)}`} />}
              </div>
              {report.onChain.realm && (
                <p className="font-mono-sm text-muted-foreground break-all">realm: {report.onChain.realm}</p>
              )}
            </div>
          )}

          {/* Limitations */}
          <div className="parchment-section rounded-md p-4">
            <p className="eyebrow mb-2">What this verdict does NOT claim</p>
            <ul className="text-sm space-y-1.5" style={{ color: 'color-mix(in oklab, var(--text-on-editorial) 80%, transparent)' }}>
              {report.limitations.map((l, i) => <li key={i}>— {l}</li>)}
              <li>— Verification reflects recorded evidence at query time; it does not judge whether the software is safe to run.</li>
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">Completed in {report.durationMs}ms · results are machine-readable at the JSON endpoints above.</p>
        </div>
      )}

      {/* Embeddable widget */}
      <div className="loom-panel p-5">
        <p className="eyebrow mb-2">Embed verification anywhere</p>
        <p className="text-sm text-muted-foreground mb-3">
          Drop this snippet into any site to render a live verification badge. Third parties verify without a PROOFLOOM account.
        </p>
        <pre className="font-mono-sm text-xs p-3 rounded-md overflow-x-auto scroll-slim" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
{`<iframe src="${typeof window !== 'undefined' ? window.location.origin : ''}/#/verify/YOUR_RELEASE_ID"
        width="420" height="180" style="border:0" title="PROOFLOOM verification"></iframe>`}
        </pre>
      </div>
    </div>
  )
}
