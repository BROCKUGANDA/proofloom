'use client'

// Release detail: the provenance surface for one release — lifecycle rail,
// evidence library with digests, attestation issuance + revocation, on-chain
// publication and reconciliation, public verification hand-off.

import { useCallback, useEffect, useState } from 'react'
import { api, ClientError } from '@/lib/client'
import { useApp, navigate, type Route } from '@/components/proofloom-app'
import { ProofSeal, EmptyState, PanelSkeleton, HashChip, CopyButton, ProvenanceRail, EvidenceThread, AttestationStamp, ChainReceipt, PolicyVerdict, TrustMeter } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Plus, Upload, Link2, ShieldCheck, RefreshCw } from 'lucide-react'

interface ReleaseDetail {
  release: {
    id: string; version: string; commitHash: string; branch: string; repoUrl: string
    buildEnv: string; pipelineRef: string; artifactDigest?: string | null; artifactName: string
    status: string; publishedAt?: string | null; supersededBy?: string | null; createdAt: string
    component?: { name: string; artifactType: string } | null
    protocolId: string
    allowedTransitions: { next: string; capability: string }[]
  }
  policyVerdict: { passed: boolean; checks: { requirement: string; passed: boolean; detail: string }[] } | null
  evidence: never[]
  attestations: {
    id: string; protocolId: string; category: string; status: string; issuerAddress: string
    digest: string; onChain: boolean; chainTxHash?: string | null; issuedAt: string
  }[]
  transactions: { id: string; kind: string; status: string; txHash?: string | null; createdAt: string; error?: string | null }[]
}

export function ReleaseView({ route }: { route: Route; go: (r: Route) => void; session: unknown; orgId: unknown }) {
  const { toast } = useApp()
  const releaseId = (route as { releaseId?: string }).releaseId ?? ''
  const [data, setData] = useState<ReleaseDetail | null>(null)

  const load = useCallback(async () => {
    if (!releaseId) return
    try {
      setData(await api.get<ReleaseDetail>(`/api/releases/${releaseId}`))
    } catch (e) {
      if (e instanceof ClientError) {
        toast('error', e.apiError.message, e.apiError.recovery)
        navigate({ view: 'workspace' })
      }
    }
  }, [releaseId, toast])

  useEffect(() => { void load() }, [load])

  if (!data) return <div className="space-y-3"><PanelSkeleton rows={5} /></div>
  const r = data.release

  const transition = async (action: string, extra?: Record<string, unknown>) => {
    try {
      await api.patch(`/api/releases/${r.id}`, { action, ...extra })
      toast('success', `Release ${action.replaceAll('-', ' ')}`)
      await load()
    } catch (e) {
      if (e instanceof ClientError) toast('error', e.apiError.message, e.apiError.recovery)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <button onClick={() => window.history.back()} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
        <ArrowLeft size={14} /> Back
      </button>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-mono text-xl font-semibold">{r.protocolId}</h1>
          <ProofSeal status={r.status} />
        </div>
        <div className="flex items-center gap-3 mt-3 flex-wrap text-xs text-muted-foreground">
          <HashChip value={r.commitHash} display={`commit ${r.commitHash.slice(0, 12)}`} />
          <CopyButton text={r.commitHash} />
          {r.branch && <span>branch {r.branch}</span>}
          {r.buildEnv && <span>built in {r.buildEnv}</span>}
          {r.component && <span>{r.component.artifactType}: {r.component.name}</span>}
        </div>
      </div>

      {/* Lifecycle rail */}
      <div className="loom-panel p-4 overflow-x-auto scroll-slim">
        <ProvenanceRail status={r.status} />
        <div className="flex gap-2 mt-4 flex-wrap">
          {r.allowedTransitions.length === 0 && <span className="text-xs text-muted-foreground">Terminal state — the record is immutable except for visible revocation/supersession marks.</span>}
          {r.allowedTransitions.map(t => (
            <Button key={t.next} size="sm" variant="outline" className="btn-press"
              onClick={() => void transition(actionFor(t.next))}>
              {labelFor(t.next)}
            </Button>
          ))}
          {r.artifactDigest && (
            <Button size="sm" variant="ghost" className="btn-press" onClick={() => navigate({ view: 'verify', query: r.protocolId })}>
              <Link2 size={13} className="mr-1.5" /> Verify publicly
            </Button>
          )}
        </div>
        {r.supersededBy && (
          <p className="text-xs text-muted-foreground mt-2">
            Superseded by <span className="font-mono-sm">{r.supersededBy}</span>
          </p>
        )}
      </div>

      {/* Artifact digest */}
      <div className="loom-panel p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="eyebrow">Artifact commitment</p>
          {r.artifactDigest ? <ProofSeal status="ACTIVE" label="sha256" /> : <ProofSeal status="PENDING" label="digest required before publish" />}
        </div>
        {r.artifactDigest ? (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <HashChip value={r.artifactDigest} display={r.artifactDigest} />
            <CopyButton text={r.artifactDigest} />
          </div>
        ) : (
          <DigestSetter releaseId={r.id} onSet={load} />
        )}
      </div>

      {/* Policy verdict */}
      {data.policyVerdict && (
        <div className="loom-panel p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <p className="eyebrow">Publication policy</p>
            <TrustMeter segments={data.policyVerdict.checks} label="policy checks" />
          </div>
          <PolicyVerdict checks={data.policyVerdict.checks} />
        </div>
      )}

      {/* Evidence */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="eyebrow">Evidence library</p>
          <AddEvidenceDialog releaseId={r.id} canAdd={['DRAFT', 'EVIDENCE_PENDING', 'VALIDATING', 'REVIEW_REQUIRED', 'APPROVED'].includes(r.status)} onAdded={load} />
        </div>
        <EvidenceList releaseId={r.id} />
      </div>

      {/* Attestations */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="eyebrow">Attestations ({data.attestations.length})</p>
          <AddAttestationDialog release={r} onIssued={load} />
        </div>
        {data.attestations.length === 0 ? (
          <EmptyState title="No attestations yet" hint="Issuers attest this release with evidence digests. Active attestations satisfy the publication policy." />
        ) : (
          <div className="space-y-2">
            {data.attestations.map(a => (
              <AttestationStamp key={a.id} attestation={a} onRevoke={async () => {
                try {
                  await api.del(`/api/attestations/${a.id}`)
                  toast('success', 'Attestation revoked', 'The record remains publicly visible as revoked.')
                  await load()
                } catch (e) {
                  toast('error', e instanceof ClientError ? e.apiError.message : 'Failed')
                }
              }} />
            ))}
          </div>
        )}
      </div>

      {/* Chain transactions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="eyebrow">Chain lifecycle</p>
          <Button size="sm" variant="outline" className="btn-press" onClick={async () => {
            try {
              const res = await api.post<{ txId: string; txHash: string; explorerUrl: string; signing: string }>('/api/chain', { op: 'publish-on-chain', releaseId: r.id })
              toast('success', 'Broadcast to Onyx', `tx ${res.txHash.slice(0, 14)}… (${res.signing}-signed)`)
              await load()
            } catch (e) {
              toast('error', e instanceof ClientError ? e.apiError.message : 'Broadcast failed', e instanceof ClientError ? e.apiError.recovery : undefined)
            }
          }}>
            <ShieldCheck size={14} className="mr-1.5" /> Commit release on-chain
          </Button>
        </div>
        {data.transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No on-chain transactions yet. Publication commits the release commitment to the releases realm.</p>
        ) : (
          <div className="space-y-2">
            {data.transactions.map(tx => <ChainReceipt key={tx.id} tx={tx} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function actionFor(next: string): string {
  return { EVIDENCE_PENDING: 'submit-evidence', VALIDATING: 'validate', REVIEW_REQUIRED: 'require-review', APPROVED: 'approve', PUBLISHED: 'publish', VERIFIED: 'verify', REVOKED: 'revoke', SUPERSEDED: 'supersede', DISPUTED: 'dispute', REJECTED: 'reject' }[next] ?? next.toLowerCase()
}
function labelFor(next: string): string {
  return { EVIDENCE_PENDING: 'Submit evidence', VALIDATING: 'Start validation', REVIEW_REQUIRED: 'Require review', APPROVED: 'Approve', PUBLISHED: 'Publish', VERIFIED: 'Mark verified', REVOKED: 'Revoke', REJECTED: 'Reject' }[next] ?? next
}

function DigestSetter({ releaseId, onSet }: { releaseId: string; onSet: () => Promise<void> }) {
  const { toast } = useApp()
  const [digest, setDigest] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex gap-2 mt-2">
      <Input value={digest} onChange={e => setDigest(e.target.value)} placeholder="sha256 hex of the primary artifact"
        className="font-mono-sm max-w-xl" pattern="[0-9a-f]{64}" aria-label="Artifact digest" />
      <Button size="sm" disabled={busy} className="btn-press" onClick={async () => {
        setBusy(true)
        try {
          await api.patch(`/api/releases/${releaseId}`, { action: 'submit-evidence', artifactDigest: digest })
          toast('success', 'Digest attached')
          await onSet()
        } catch (e) {
          toast('error', e instanceof ClientError ? e.apiError.message : 'Failed')
        } finally { setBusy(false) }
      }}>Attach</Button>
    </div>
  )
}

// ─── Evidence ────────────────────────────────────────────────────────────────

interface EvidenceRow {
  id: string; kind: string; title: string; contentHash: string; sizeBytes: number; createdAt: string; integrityOk?: boolean
}

function EvidenceList({ releaseId }: { releaseId: string }) {
  const [items, setItems] = useState<EvidenceRow[] | null>(null)

  const load = useCallback(async () => {
    try {
      const rows = await api.get<EvidenceRow[]>(`/api/releases/${releaseId}/evidence`)
      setItems(rows)
    } catch {
      setItems([])
    }
  }, [releaseId])
  useEffect(() => { void load() }, [load])

  if (items === null) return <PanelSkeleton rows={2} />
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No evidence attached yet. Build logs, test reports, SBOMs and scan results anchor the release to verifiable bytes.</p>
  }
  return (
    <div className="space-y-2">
      {items.map(ev => (
        <EvidenceThread key={ev.id} title={ev.title} kind={ev.kind} digest={ev.contentHash}
          createdAt={ev.createdAt} sizeBytes={ev.sizeBytes} integrityOk={ev.integrityOk} />
      ))}
    </div>
  )
}

function AddEvidenceDialog({ releaseId, canAdd, onAdded }: { releaseId: string; canAdd: boolean; onAdded: () => Promise<void> }) {
  const { toast } = useApp()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('test_report')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)

  if (!canAdd) return null
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="btn-press"><Plus size={14} className="mr-1.5" /> Add evidence</Button></DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Attach evidence</DialogTitle>
          <DialogDescription>
            Content is hashed with sha256 on upload. The digest becomes the content-address you can verify anywhere.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            const created = await api.post<{ contentHash: string }>(`/api/releases/${releaseId}/evidence`, { kind, title, content })
            toast('success', 'Evidence attached', `sha256 ${created.contentHash.slice(0, 16)}…`)
            setOpen(false)
            setTitle(''); setContent('')
            await onAdded()
          } catch (e2) {
            toast('error', e2 instanceof ClientError ? e2.apiError.message : 'Failed')
          } finally { setBusy(false) }
        }} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ev-kind">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="ev-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['build_log', 'test_report', 'security_scan', 'sbom', 'approval', 'agent_report', 'deployment', 'other'].map(k =>
                    <SelectItem key={k} value={k}>{k.replaceAll('_', ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ev-title">Title</Label>
              <Input id="ev-title" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} placeholder="go test ./... output" />
            </div>
          </div>
          <div>
            <Label htmlFor="ev-content">Content (≤ 512 KiB inline)</Label>
            <Textarea id="ev-content" value={content} onChange={e => setContent(e.target.value)} rows={8}
              className="font-mono-sm" placeholder="Paste build output, test results, SBOM JSON, scan summaries…" required />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy} className="btn-press">
              <Upload size={14} className="mr-1.5" /> {busy ? 'Hashing…' : 'Hash & attach'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Attestation issuance ────────────────────────────────────────────────────

function AddAttestationDialog({ release, onIssued }: {
  release: { id: string; status: string; artifactDigest?: string | null; protocolId: string }
  onIssued: () => Promise<void>
}) {
  const { toast, session } = useApp()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState('BUILD_PROVENANCE')
  const [digest, setDigest] = useState(release.artifactDigest ?? '')
  const [onChain, setOnChain] = useState(false)
  const [busy, setBusy] = useState(false)

  const issuerReady = !!session?.user?.gnoAddress

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="btn-press"><Plus size={14} className="mr-1.5" /> Attest</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue attestation</DialogTitle>
          <DialogDescription>
            Deterministic protocol id: <span className="font-mono-sm">{release.protocolId}-&lt;category&gt;-&lt;issuer&gt;</span>. One active attestation per issuer per category.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            const created = await api.post<{ protocolId: string; digest: string }>(`/api/releases/${release.id}/attest`, {
              category, digest, onChain,
            })
            toast('success', 'Attestation issued', created.protocolId)
            setOpen(false)
            await onIssued()
          } catch (e2) {
            toast('error', e2 instanceof ClientError ? e2.apiError.message : 'Failed', e2 instanceof ClientError ? e2.apiError.recovery : undefined)
          } finally { setBusy(false) }
        }} className="space-y-4">
          <div>
            <Label htmlFor="at-cat">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="at-cat"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['BUILD_PROVENANCE', 'SOURCE_PROVENANCE', 'TEST_EXECUTION', 'SECURITY_ASSESSMENT', 'CODE_REVIEW', 'RELEASE_APPROVAL', 'BENCHMARK_RESULT', 'DEPENDENCY_VERIFICATION', 'COMPLIANCE_EVIDENCE'].map(c =>
                  <SelectItem key={c} value={c}>{c.replaceAll('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="at-digest">Evidence digest (sha256)</Label>
            <Input id="at-digest" value={digest} onChange={e => setDigest(e.target.value)} required pattern="[0-9a-f]{64}" className="font-mono-sm" placeholder="64 hex chars" />
            <p className="text-xs text-muted-foreground mt-1">Defaults to the release artifact digest; point it at any evidence digest you are attesting.</p>
          </div>
          <div className="flex items-start gap-2">
            <input id="at-chain" type="checkbox" checked={onChain} onChange={e => setOnChain(e.target.checked)} className="mt-1" />
            <Label htmlFor="at-chain" className="font-normal text-sm cursor-pointer">
              Commit this attestation on-chain immediately
              <span className="block text-xs text-muted-foreground">Uses the platform operator flow on the testnet; user-owned signing via Adena signs locally when the wallet is present.</span>
            </Label>
          </div>
          {!issuerReady && (
            <p className="text-xs text-[var(--warning)]">
              No Gno address linked to your account. Link a wallet in Account security, or the platform operator address signs on the testnet (clearly labeled in the record).
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy} className="btn-press">{busy ? 'Issuing…' : 'Issue attestation'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
