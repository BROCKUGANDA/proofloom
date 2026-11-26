import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { sha256Hex, isValidDigest } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

const MAX_INLINE_BYTES = 512 * 1024
const KINDS = ['build_log', 'test_report', 'security_scan', 'sbom', 'approval', 'agent_report', 'deployment', 'other']

// GET /api/releases/[releaseId]/evidence
export async function GET(req: NextRequest, ctx: { params: Promise<{ releaseId: string }> }) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const { releaseId } = await ctx.params
    const release = await db.release.findUnique({ where: { id: releaseId }, select: { projectId: true } })
    if (!release) throw err('NOT_FOUND')
    await requireProjectAccess(user.id, release.projectId, 'project.read')
    const evidence = await db.evidence.findMany({
      where: { releaseId },
      select: { id: true, kind: true, title: true, contentHash: true, mimeType: true, sizeBytes: true, storage: true, uploadedBy: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return evidence
  })
}

// POST /api/releases/[releaseId]/evidence — ingest evidence with content addressing
export async function POST(req: NextRequest, ctx: { params: Promise<{ releaseId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { releaseId } = await ctx.params
    const release = await db.release.findUnique({ where: { id: releaseId }, include: { project: true } })
    if (!release) throw err('NOT_FOUND')
    await requireProjectAccess(user.id, release.projectId, 'evidence.write')
    if (['REVOKED', 'SUPERSEDED'].includes(release.status)) throw err('INVALID_TRANSITION', { from: release.status })

    const body = await readJson<{
      kind?: string; title?: string; content?: string
      digest?: string; mimeType?: string
    }>(req)
    if (!body.kind || !KINDS.includes(body.kind)) throw err('VALIDATION_FAILED', { field: 'kind', allowed: KINDS })
    if (!body.title) throw err('VALIDATION_FAILED', { missing: ['title'] })
    if (body.content == null) throw err('VALIDATION_FAILED', { missing: ['content'] })

    const bytes = Buffer.byteLength(body.content, 'utf8')
    if (bytes > MAX_INLINE_BYTES) throw err('VALIDATION_FAILED', { reason: `inline evidence limited to ${MAX_INLINE_BYTES} bytes; use the object-storage adapter for larger artifacts` })

    const computed = sha256Hex(body.content)
    if (body.digest && body.digest !== computed) {
      throw err('INVALID_DIGEST', { reason: 'provided digest does not match computed content digest', computed })
    }

    const evidence = await db.evidence.create({
      data: {
        releaseId,
        projectId: release.projectId,
        kind: body.kind,
        title: body.title.slice(0, 200),
        contentHash: computed,
        mimeType: (body.mimeType ?? 'text/plain').slice(0, 80),
        sizeBytes: bytes,
        storage: 'inline',
        content: body.content,
        uploadedBy: user.id,
      },
    })

    // Draft releases automatically advance to EVIDENCE_PENDING when the
    // first artifact-backed evidence lands and a digest is available.
    let newStatus = release.status
    if (release.status === 'DRAFT' && release.artifactDigest) {
      await db.release.update({ where: { id: releaseId }, data: { status: 'EVIDENCE_PENDING' } })
      newStatus = 'EVIDENCE_PENDING'
    }

    await audit({
      organizationId: release.project.organizationId, projectId: release.projectId,
      actorUserId: user.id, action: 'evidence.create', targetType: 'EVIDENCE',
      targetId: evidence.id, metadata: { kind: evidence.kind, digest: computed, sizeBytes: bytes, releaseStatus: newStatus },
      ip: clientIp(req), traceId,
    })
    return { id: evidence.id, contentHash: computed, sizeBytes: bytes, releaseStatus: newStatus }
  })
}

// GET a single evidence body: /api/releases/[releaseId]/evidence?evidenceId=
export async function PUT(req: NextRequest, ctx: { params: Promise<{ releaseId: string }> }) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const { releaseId } = await ctx.params
    const release = await db.release.findUnique({ where: { id: releaseId }, select: { projectId: true } })
    if (!release) throw err('NOT_FOUND')
    await requireProjectAccess(user.id, release.projectId, 'project.read')
    const body = await readJson<{ evidenceId?: string }>(req)
    if (!body.evidenceId) throw err('VALIDATION_FAILED', { missing: ['evidenceId'] })
    const ev = await db.evidence.findUnique({ where: { id: body.evidenceId } })
    if (!ev || ev.releaseId !== releaseId) throw err('NOT_FOUND')
    const integrityOk = ev.content != null ? sha256Hex(ev.content) === ev.contentHash : undefined
    return { ...ev, integrityOk }
  })
}
