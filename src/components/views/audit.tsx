'use client'

// Audit explorer — the append-only trail, filterable.

import { useCallback, useEffect, useState } from 'react'
import { api, ClientError } from '@/lib/client'
import { useApp, type Route } from '@/components/proofloom-app'
import { PanelSkeleton, HashChip, EmptyState } from '@/components/atelier/kit'
import { Input } from '@/components/ui/input'

interface AuditEvent {
  id: string; action: string; targetType: string; targetId: string
  actorUserId?: string | null; actorAddress?: string | null
  metadata: string; ip?: string | null; traceId?: string | null; createdAt: string
}

export function AuditView(_props: unknown) {
  const { orgId, toast } = useApp()
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [summary, setSummary] = useState<{ action: string; _count: { action: number } }[]>([])
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      const res = await api.get<{ events: AuditEvent[]; actionSummary: { action: string; _count: { action: number } }[] }>(`/api/audit?orgId=${orgId}`)
      setEvents(res.events)
      setSummary(res.actionSummary)
    } catch (e) {
      if (e instanceof ClientError) toast('error', e.apiError.message, e.apiError.recovery)
      setEvents([])
    }
  }, [orgId, toast])

  useEffect(() => { void load() }, [load])

  if (!events) return <div className="space-y-3"><PanelSkeleton rows={6} /></div>

  const filtered = events.filter(e => !filter || e.action.includes(filter) || e.targetType.includes(filter.toLowerCase()))

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="atelier-display" style={{ fontSize: 'var(--text-2xl)' }}>Audit explorer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Append-only. Every privileged action produces a record with actor, target and trace id. No API deletes audit rows.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {summary.slice(0, 10).map(s => (
          <button key={s.action} onClick={() => setFilter(s.action)} className="proof-seal seal-info btn-press">
            {s.action} · {s._count.action}
          </button>
        ))}
        {filter && <button onClick={() => setFilter('')} className="proof-seal seal-unknown btn-press">clear filter</button>}
      </div>

      <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by action (e.g. release.publish, attestation)" className="max-w-sm font-mono-sm" aria-label="Filter audit events" />

      {filtered.length === 0 ? (
        <EmptyState title="No audit events match" hint="Privileged actions across this organization appear here automatically." />
      ) : (
        <div className="loom-panel divide-y divide-[var(--border)] max-h-[65vh] overflow-y-auto scroll-slim">
          {filtered.map(ev => {
            let meta: Record<string, unknown> = {}
            try { meta = JSON.parse(ev.metadata) } catch { /* ignore */ }
            return (
              <div key={ev.id} className="p-4 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono-sm font-semibold">{ev.action}</span>
                  <span className="eyebrow">{ev.targetType.toLowerCase()}</span>
                  <span className="flex-1" />
                  <span className="text-xs text-muted-foreground">{new Date(ev.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <HashChip value={ev.targetId} display={`target ${ev.targetId.slice(0, 14)}…`} />
                  {ev.actorAddress && <HashChip value={ev.actorAddress} display={`actor ${ev.actorAddress.slice(0, 10)}…`} />}
                  {ev.traceId && <span className="font-mono-sm text-muted-foreground">trace {ev.traceId.slice(0, 10)}</span>}
                </div>
                {Object.keys(meta).length > 0 && (
                  <p className="font-mono-sm text-muted-foreground break-all">{JSON.stringify(meta).slice(0, 220)}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
