'use client'

// Proof Atlas — the data-driven evidence graph.
// Canvas 2D rendering (usable on any device, graceful without WebGL),
// real protocol data, selectable nodes, filtering, and an accessible
// list alternative. Respects reduced-motion (no idle animation).

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/client'
import { navigate, type Route } from '@/components/proofloom-app'
import { ProofSeal, HashChip, Spinner, EmptyState } from '@/components/atelier/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApp } from '@/components/proofloom-app'
import { RefreshCw } from 'lucide-react'

interface AtlasNode {
  id: string
  kind: 'project' | 'release' | 'attestation' | 'agent' | 'execution'
  label: string
  status?: string
  meta?: string
}
interface AtlasEdge {
  from: string
  to: string
  kind: string
}

const KIND_COLOR: Record<AtlasNode['kind'], string> = {
  project: 'var(--accent)',
  release: 'var(--accent-info)',
  attestation: 'var(--copper)',
  agent: 'var(--verified)',
  execution: 'var(--mist)',
}

export function AtlasView(_props: unknown) {
  const { reduceMotion, toast } = useApp()
  const [nodes, setNodes] = useState<AtlasNode[] | null>(null)
  const [edges, setEdges] = useState<AtlasEdge[]>([])
  const [selected, setSelected] = useState<AtlasNode | null>(null)
  const [filter, setFilter] = useState('')
  const [accessMode, setAccessMode] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layoutRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map())
  const rafRef = useRef<number>(0)

  const load = useCallback(async () => {
    try {
      const s = await api.get<import('@/components/views/explorer').Summary>('/api/public/explore?kind=summary')
      const ns: AtlasNode[] = []
      const es: AtlasEdge[] = []
      const projectIds = new Set<string>()

      for (const p of s.projects.slice(0, 12)) {
        ns.push({ id: `p:${p.slug}`, kind: 'project', label: p.name, status: 'ACTIVE', meta: p.slug })
        projectIds.add(p.slug)
      }
      for (const r of s.releases.slice(0, 40)) {
        ns.push({ id: `r:${r.protocolId}`, kind: 'release', label: r.protocolId, status: r.status, meta: `${r.project} v${r.version}` })
        es.push({ from: `p:${r.project}`, to: `r:${r.protocolId}`, kind: 'publishes' })
        projectIds.add(r.project)
      }
      for (const a of s.attestations.slice(0, 60)) {
        const subject = a.subjectVersion && a.protocolId.includes(a.subjectVersion)
          ? `r:${a.protocolId.split(`-${a.subjectVersion.toLowerCase()}`)[0]}-${a.subjectVersion.toLowerCase()}`
          : null
        ns.push({ id: `a:${a.protocolId}`, kind: 'attestation', label: a.category.replaceAll('_', ' ').toLowerCase(), status: 'ACTIVE', meta: a.issuerAddress.slice(0, 12) })
        if (subject && projectIds.has(subject.slice(2).split('-').slice(0, -1).join('-'))) {
          es.push({ from: subject, to: `a:${a.protocolId}`, kind: 'attests' })
        }
      }
      setNodes(ns)
      setEdges(es)
    } catch {
      setNodes([])
      toast('error', 'Atlas data unavailable')
    }
  }, [toast])

  useEffect(() => { void load() }, [load])

  // physics + render
  useEffect(() => {
    if (!nodes || accessMode) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.clientWidth, H = canvas.clientHeight
    canvas.width = W * 2
    canvas.height = H * 2
    ctx.scale(2, 2)

    // deterministic circular layout with drift
    const layout = layoutRef.current
    nodes.forEach((n, i) => {
      if (!layout.has(n.id)) {
        const ring = n.kind === 'project' ? 0.18 : n.kind === 'release' ? 0.42 : 0.72
        const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 + (n.kind === 'release' ? 0.4 : n.kind === 'attestation' ? 0.8 : 0)
        layout.set(n.id, {
          x: W / 2 + Math.cos(angle) * W * ring,
          y: H / 2 + Math.sin(angle) * H * ring,
          vx: 0, vy: 0,
        })
      }
    })

    let t = 0
    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      const l = layoutRef.current
      const filteredNodes = nodes.filter(n => !filter || n.label.toLowerCase().includes(filter.toLowerCase()) || (n.meta ?? '').includes(filter))
      const visibleIds = new Set(filteredNodes.map(n => n.id))

      // edges
      for (const e of edges) {
        if (!visibleIds.has(e.from) && !visibleIds.has(e.to)) continue
        const a = l.get(e.from), b = l.get(e.to)
        if (!a || !b) continue
        ctx.strokeStyle = 'var(--border-strong)'
        ctx.globalAlpha = 0.5
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // nodes
      for (const n of filteredNodes) {
        const p = l.get(n.id)
        if (!p) continue
        const r = n.kind === 'project' ? 9 : n.kind === 'release' ? 7 : 5
        const isSel = selected?.id === n.id
        ctx.beginPath()
        ctx.arc(p.x, p.y, r + (isSel ? 3 : 0), 0, Math.PI * 2)
        ctx.fillStyle = KIND_COLOR[n.kind]
        ctx.globalAlpha = n.status && ['REVOKED', 'REJECTED'].includes(n.status) ? 0.35 : 1
        ctx.fill()
        ctx.globalAlpha = 1
        if (isSel) {
          ctx.strokeStyle = 'var(--text-primary)'
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
        if (n.kind === 'project' || n.kind === 'release') {
          ctx.fillStyle = 'var(--text-secondary)'
          ctx.font = '10px monospace'
          ctx.fillText(n.label.slice(0, 26), p.x + r + 3, p.y + 3)
        }
      }

      if (!reduceMotion) {
        t += 0.004
        // gentle drift, deterministic per node
        for (const n of filteredNodes) {
          const p = l.get(n.id)
          if (!p) continue
          const h = [...n.id].reduce((s, c) => s + c.charCodeAt(0), 0)
          p.x += Math.sin(t + h) * 0.15
          p.y += Math.cos(t * 0.8 + h * 0.7) * 0.12
        }
        rafRef.current = requestAnimationFrame(draw)
      }
    }
    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [nodes, edges, filter, selected, reduceMotion, accessMode])

  if (nodes === null) return <div className="flex justify-center py-20"><Spinner label="weaving the atlas" /></div>

  return (
    <div className="mx-auto max-w-[1200px] px-4 lg:px-6 py-10 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-2">Proof Atlas</p>
          <h1 className="atelier-display" style={{ fontSize: 'var(--text-2xl)' }}>The evidence network</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {nodes.length} nodes · {edges.length} relationships — projects, releases, attestations from live registry data.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="btn-press" onClick={() => void load()} aria-label="Reload atlas"><RefreshCw size={14} /></Button>
          <Button variant="ghost" size="sm" className="btn-press" onClick={() => setAccessMode(!accessMode)}>
            {accessMode ? 'Graph view' : 'List view (accessible)'}
          </Button>
        </div>
      </div>

      <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter nodes (project, release, category…)" className="max-w-md" aria-label="Filter atlas nodes" />

      {nodes.length === 0 ? (
        <EmptyState title="Nothing to weave yet" hint="Register projects and publish releases — the atlas grows with real protocol records." />
      ) : accessMode ? (
        <div className="loom-panel divide-y divide-[var(--border)] max-h-[60vh] overflow-y-auto scroll-slim" role="table" aria-label="Atlas node list">
          {nodes.map(n => (
            <div key={n.id} className="flex items-center gap-3 p-3 flex-wrap">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: KIND_COLOR[n.kind] }} aria-hidden="true" />
              <span className="font-mono-sm">{n.label}</span>
              <span className="eyebrow">{n.kind}</span>
              {n.status && <ProofSeal status={n.status} />}
              {n.meta && <span className="text-xs text-muted-foreground">{n.meta}</span>}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="loom-panel overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full h-[520px] cursor-pointer"
              role="img"
              aria-label="Interactive evidence graph: projects, releases and attestations. Use list view for accessibility."
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const mx = e.clientX - rect.left, my = e.clientY - rect.top
                let best: AtlasNode | null = null
                let bestD = 18
                for (const n of nodes) {
                  const p = layoutRef.current.get(n.id)
                  if (!p) continue
                  const d = Math.hypot(p.x - mx, p.y - my)
                  if (d < bestD) { bestD = d; best = n }
                }
                setSelected(best)
              }}
            />
          </div>
          {selected && (
            <div className="loom-panel-raised p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="w-3 h-3 rounded-full" style={{ background: KIND_COLOR[selected.kind] }} />
                <p className="text-sm font-semibold">{selected.label}</p>
                <span className="eyebrow">{selected.kind}</span>
                {selected.status && <ProofSeal status={selected.status} />}
              </div>
              {selected.meta && <p className="font-mono-sm text-muted-foreground mt-2">{selected.meta}</p>}
              <div className="mt-2 text-xs text-muted-foreground">
                {selected.kind === 'release' && (
                  <button className="text-[var(--accent)] hover:underline" onClick={() => navigate({ view: 'verify', query: selected.label })}>
                    open verification →
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {Object.entries(KIND_COLOR).map(([k, c]) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} /> {k}
              </span>
            ))}
            <span>drag not required — click nodes to inspect; idle drift pauses under reduced-motion</span>
          </div>
        </>
      )}
    </div>
  )
}
