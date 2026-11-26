import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// GET/POST /api/projects/[projectId]/components
export async function GET(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const { projectId } = await ctx.params
    await requireProjectAccess(user.id, projectId, 'project.read')
    return db.component.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } })
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { projectId } = await ctx.params
    const project = await requireProjectAccess(user.id, projectId, 'project.write')
    if (project.status === 'ARCHIVED') throw err('ARCHIVED')
    const body = await readJson<{ name?: string; artifactType?: string; license?: string; namespace?: string; version?: string }>(req)
    if (!body.name) throw err('VALIDATION_FAILED', { missing: ['name'] })
    const validTypes = ['source', 'container', 'binary', 'sbom', 'docs', 'library']
    if (!validTypes.includes(body.artifactType ?? '')) throw err('VALIDATION_FAILED', { field: 'artifactType', allowed: validTypes })
    const component = await db.component.create({
      data: {
        projectId,
        name: body.name.slice(0, 120),
        namespace: (body.namespace ?? '').slice(0, 80),
        artifactType: body.artifactType!,
        license: (body.license ?? '').slice(0, 60),
        version: (body.version ?? '').slice(0, 40),
      },
    })
    await audit({ organizationId: project.organizationId, projectId, actorUserId: user.id, action: 'component.create', targetType: 'COMPONENT', targetId: component.id, ip: clientIp(req), traceId })
    return component
  })
}

// PATCH/DELETE via body action on the same route for simplicity
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { projectId } = await ctx.params
    const project = await requireProjectAccess(user.id, projectId, 'project.write')
    const body = await readJson<{ componentId?: string; deprecate?: boolean }>(req)
    if (!body.componentId) throw err('VALIDATION_FAILED', { missing: ['componentId'] })
    const component = await db.component.findUnique({ where: { id: body.componentId } })
    if (!component || component.projectId !== projectId) throw err('NOT_FOUND')
    const updated = await db.component.update({ where: { id: component.id }, data: { deprecated: !!body.deprecate } })
    await audit({ organizationId: project.organizationId, projectId, actorUserId: user.id, action: body.deprecate ? 'component.deprecate' : 'component.restore', targetType: 'COMPONENT', targetId: component.id, ip: clientIp(req), traceId })
    return updated
  })
}
