'use client'

// Signature Atelier components: ProofSeal, LoomPanel, TrustMeter,
// ProvenanceRail, AttestationStamp, PolicyVerdict, ChainReceipt,
// AgentSigil, EvidenceThread, HashChip, CopyButton.

import { useState, useCallback } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { Glyph, GlyphVerified, GlyphPending, GlyphRevoked, GlyphAgent } from '@/components/atelier/emblem'

// ─── ProofSeal ───────────────────────────────────────────────────────────────

const SEAL_TONES: Record<string, string> = {
  VERIFIED: 'seal-verified', PUBLISHED: 'seal-verified', ACTIVE: 'seal-verified', COMPLETED: 'seal-verified', APPROVED: 'seal-verified', CONNECTED: 'seal-verified', CONFIRMED: 'seal-verified', HEALTHY: 'seal-verified',
  PENDING: 'seal-pending', EVIDENCE_PENDING: 'seal-pending', VALIDATING: 'seal-pending', REVIEW_REQUIRED: 'seal-pending', REVIEW: 'seal-pending', AWAITING_APPROVAL: 'seal-pending', RUNNING: 'seal-pending', PENDING_SIGNATURE: 'seal-pending', SUSPENDED: 'seal-pending', DEGRADED: 'seal-pending', ASSIGNED: 'seal-pending', IN_PROGRESS: 'seal-pending', DRAFT: 'seal-unknown', OPEN: 'seal-unknown', BROADCAST: 'seal-pending', CREATED: 'seal-unknown', SIGNED: 'seal-pending', SIMULATED: 'seal-pending',
  REJECTED: 'seal-rejected', FAILED: 'seal-critical', DISPUTED: 'seal-critical', ERROR: 'seal-critical',
  REVOKED: 'seal-revoked',
  UNKNOWN: 'seal-unknown', DEAD: 'seal-revoked', EXPIRED: 'seal-revoked', SUPERSEDED: 'seal-unknown', ARCHIVED: 'seal-unknown',
}

export function ProofSeal({ status, label, pulse = false }: { status: string; label?: string; pulse?: boolean }) {
  const tone = SEAL_TONES[status.toUpperCase()] ?? 'seal-unknown'
  const icon = ['VERIFIED', 'PUBLISHED', 'ACTIVE', 'COMPLETED', 'APPROVED', 'CONFIRMED', 'HEALTHY'].includes(status.toUpperCase())
    ? <GlyphVerified width={11} height={11} />
    : ['REVOKED', 'EXPIRED', 'REJECTED', 'FAILED', 'DISPUTED'].includes(status.toUpperCase())
      ? <GlyphRevoked width={11} height={11} />
      : <GlyphPending width={11} height={11} />
  return (
    <span className={`proof-seal seal-land ${tone}`} title={`State: ${status}`}>
      {pulse && <span className={`status-dot pulse-soft`} style={{ background: 'currentColor', width: 5, height: 5 }} />}
      {icon}
      {label ?? status.replaceAll('_', ' ')}
    </span>
  )
}

// ─── HashChip ────────────────────────────────────────────────────────────────

export function HashChip({ value, display, prefix = '' }: { value: string; display?: string; prefix?: string }) {
  return (
    <span className="hash-chip" title={value}>
      {prefix}{display ?? value}
    </span>
  )
}

export function CopyButton({ text, size = 13 }: { text: string; size?: number }) {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* clipboard unavailable */ }
  }, [text])
  return (
    <button
      onClick={onCopy}
      className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Copy to clipboard"
      type="button"
    >
      {copied ? <Check size={size} className="text-[var(--verified)]" /> : <Copy size={size} />}
    </button>
  )
}

// ─── TrustMeter — explainable evidence completeness ─────────────────────────

export function TrustMeter({ segments, label }: { segments: { passed: boolean; requirement: string }[]; label?: string }) {
  const total = segments.length
  const passed = segments.filter(s => s.passed).length
  const ratio = total === 0 ? 0 : passed / total
  return (
    <div className="flex items-center gap-2.5" title={label ?? `${passed}/${total} checks passed`}>
      <div className="flex gap-[3px]" role="meter" aria-valuenow={passed} aria-valuemin={0} aria-valuemax={total}>
        {segments.map((s, i) => (
          <span key={i} className="w-[10px] h-[4px] rounded-[1px]" style={{ background: s.passed ? 'var(--verified)' : 'var(--pending)' }} />
        ))}
      </div>
      <span className="font-mono-sm text-muted-foreground">{passed}/{total}</span>
      <span className="sr-only">{Math.round(ratio * 100)}% of verification checks passed</span>
    </div>
  )
}

// ─── PolicyVerdict ───────────────────────────────────────────────────────────

export function PolicyVerdict({ checks }: { checks: { requirement: string; passed: boolean; detail: string }[] }) {
  if (!checks.length) return <p className="text-muted-foreground text-sm">No policy configured — protocol baseline applies.</p>
  return (
    <div className="space-y-1.5">
      {checks.map((c, i) => (
        <div key={i} className="flex items-start gap-2.5 text-sm">
          {c.passed ? <GlyphVerified className="text-[var(--verified)] mt-[3px] shrink-0" /> : <GlyphPending className="text-[var(--pending)] mt-[3px] shrink-0" />}
          <div>
            <span className="font-mono-sm text-foreground">{c.requirement}</span>
            <span className="text-muted-foreground"> — {c.detail}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── ChainReceipt — transaction lifecycle ────────────────────────────────────

export function ChainReceipt({ tx, explorer }: {
  tx: { txHash?: string | null; status: string; kind: string; chainId?: string | null; createdAt?: string | Date; confirmedAt?: string | Date | null; error?: string | null }
  explorer?: string
}) {
  return (
    <div className="loom-panel p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Glyph name="commitment" className="text-[var(--accent)] shrink-0" />
          <span className="text-sm font-medium truncate">{tx.kind.replaceAll('_', ' ').toLowerCase()}</span>
        </div>
        <ProofSeal status={tx.status} />
      </div>
      {tx.txHash && (
        <div className="flex items-center gap-2 mt-2">
          <HashChip value={tx.txHash} display={tx.txHash.length > 22 ? `${tx.txHash.slice(0, 12)}…${tx.txHash.slice(-8)}` : tx.txHash} />
          <CopyButton text={tx.txHash} />
          {explorer && (
            <a href={`${explorer}/tx/${tx.txHash}`} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent-info)] hover:underline">explorer ↗</a>
          )}
        </div>
      )}
      {tx.error && <p className="text-xs text-[var(--critical)] mt-1.5">{tx.error}</p>}
    </div>
  )
}

// ─── AgentSigil ──────────────────────────────────────────────────────────────

export function AgentSigil({ name, size = 28, active = true }: { name: string; size?: number; active?: boolean }) {
  // Deterministic sigil hue from the agent name.
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  const hue = 150 + (h % 120) // stay within the restrained teal-amber band
  return (
    <span
      className="inline-flex items-center justify-center rounded-md shrink-0"
      style={{
        width: size, height: size,
        background: `color-mix(in oklab, hsl(${hue} 42% 45%) 16%, var(--surface-raised))`,
        border: `1px solid color-mix(in oklab, hsl(${hue} 42% 45%) 45%, transparent)`,
        opacity: active ? 1 : 0.5,
      }}
      aria-label={`Agent ${name}`}
    >
      <GlyphAgent width={size * 0.55} height={size * 0.55} />
    </span>
  )
}

// ─── ProvenanceRail — release lifecycle timeline ─────────────────────────────

const LIFECYCLE = ['DRAFT', 'EVIDENCE_PENDING', 'VALIDATING', 'REVIEW_REQUIRED', 'APPROVED', 'PUBLISHED', 'VERIFIED']

export function ProvenanceRail({ status, history }: { status: string; history?: { from: string; to: string; at: string | Date }[] }) {
  const idx = LIFECYCLE.indexOf(status)
  const terminal = ['REJECTED', 'REVOKED', 'SUPERSEDED', 'DISPUTED'].includes(status)
  return (
    <div className="flex items-center gap-0 flex-wrap" role="img" aria-label={`Release state: ${status}`}>
      {LIFECYCLE.map((step, i) => {
        const reached = !terminal && i <= idx
        const current = !terminal && i === idx
        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <span
                className={`w-[9px] h-[9px] rounded-full border ${current ? 'trace-node-verified' : ''}`}
                style={{
                  borderColor: reached ? 'var(--verified)' : 'var(--border-strong)',
                  background: reached && !current ? 'var(--verified)' : current ? 'var(--verified)' : 'transparent',
                }}
              />
              <span className={`font-mono text-[9px] tracking-wide ${current ? 'text-foreground' : 'text-muted-foreground'}`}>
                {step.replaceAll('_', ' ')}
              </span>
            </div>
            {i < LIFECYCLE.length - 1 && (
              <span className="w-6 h-[1px] mx-1 mb-4" style={{ background: reached && i < idx ? 'var(--verified)' : 'var(--border)' }} />
            )}
          </div>
        )
      })}
      {terminal && (
        <span className="ml-3"><ProofSeal status={status} /></span>
      )}
    </div>
  )
}

// ─── EvidenceThread ──────────────────────────────────────────────────────────

export function EvidenceThread({ title, kind, digest, createdAt, sizeBytes, integrityOk }: {
  title: string; kind: string; digest: string; createdAt?: string | Date; sizeBytes?: number; integrityOk?: boolean
}) {
  return (
    <div className="evidence-thread">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">{title}</span>
        <span className="eyebrow">{kind.replaceAll('_', ' ')}</span>
        {integrityOk === false && (
          <span className="proof-seal seal-critical"><Glyph name="mismatch" className="w-3 h-3" /> digest mismatch</span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <HashChip value={digest} display={digest.slice(0, 16) + '…' + digest.slice(-8)} />
        <CopyButton text={digest} />
        {sizeBytes != null && <span className="text-xs text-muted-foreground">{(sizeBytes / 1024).toFixed(1)} KiB</span>}
        {createdAt && <span className="text-xs text-muted-foreground">{new Date(createdAt).toLocaleString()}</span>}
      </div>
    </div>
  )
}

// ─── AttestationStamp ────────────────────────────────────────────────────────

export function AttestationStamp({ attestation, onRevoke }: {
  attestation: { protocolId: string; category: string; status: string; issuerAddress: string; digest: string; onChain: boolean; issuedAt?: string | Date; chainTxHash?: string | null }
  onRevoke?: () => void
}) {
  const active = attestation.status === 'ACTIVE'
  return (
    <div className="loom-panel p-3.5">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Glyph name="commitment" className="text-[var(--accent)]" />
            <span className="text-sm font-medium">{attestation.category.replaceAll('_', ' ')}</span>
            {attestation.onChain && <span className="proof-seal seal-info">on-chain</span>}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <HashChip value={attestation.issuerAddress} display={`issuer ${attestation.issuerAddress.slice(0, 10)}…${attestation.issuerAddress.slice(-6)}`} />
            <HashChip value={attestation.digest} display={`sha256 ${attestation.digest.slice(0, 10)}…`} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ProofSeal status={attestation.status} />
          {active && onRevoke && (
            <button onClick={onRevoke} className="text-xs text-[var(--critical)] hover:underline" type="button">revoke</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Loading ─────────────────────────────────────────────────────────────────

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="loom-panel p-4 space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 rounded bg-[var(--surface-raised)] animate-pulse" style={{ width: `${72 - i * 12}%` }} />
      ))}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
      <Loader2 className="animate-spin" size={14} />
      {label ?? 'Loading'}
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="loom-panel p-8 text-center">
      <div className="flex justify-center mb-3 opacity-70"><Glyph name="release" className="w-8 h-8 text-muted-foreground" /></div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
