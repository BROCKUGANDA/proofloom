import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApi, readJson, clientIp } from '@/lib/api'
import { requireAuth, requireProjectAccess } from '@/lib/auth'
import { err } from '@/lib/errors'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// GET/POST /api/projects/[projectId]/dependencies
export async function GET(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  return withApi(async () => {
    const { user } = await requireAuth()
    const { projectId } = await ctx.params
    await requireProjectAccess(user.id, projectId, 'project.read')
    const deps = await db.dependency.findMany({ where: { projectId }, orderBy: [{ isDirect: 'desc' }, { name: 'asc' }] })
    // dependency graph shape for the visualization
    return {
      dependencies: deps,
      graph: {
        nodes: deps.map(d => ({ id: d.id, label: `${d.name}@${d.version}`, ecosystem: d.ecosystem, risk: d.risk, isDirect: d.isDirect })),
        summary: {
          total: deps.length,
          direct: deps.filter(d => d.isDirect).length,
          transitive: deps.filter(d => !d.isDirect).length,
          byEcosystem: Object.entries(deps.reduce((acc, d) => { acc[d.ecosystem] = (acc[d.ecosystem] ?? 0) + 1; return acc }, {} as Record<string, number>)),
          byRisk: Object.entries(deps.reduce((acc, d) => { acc[d.risk] = (acc[d.risk] ?? 0) + 1; return acc }, {} as Record<string, number>)),
        },
      },
    }
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  return withApi(async (traceId) => {
    const { user } = await requireAuth()
    const { projectId } = await ctx.params
    const project = await requireProjectAccess(user.id, projectId, 'project.write')
    if (project.status === 'ARCHIVED') throw err('ARCHIVED')
    const body = await readJson<{ name?: string; ecosystem?: string; version?: string; license?: string; risk?: string; isDirect?: boolean }>(req)
    if (!body.name) throw err('VALIDATION_FAILED', { missing: ['name'] })
    const ecosystems = ['npm', 'pypi', 'maven', 'go', 'cargo', 'oci', 'other']
    if (!ecosystems.includes(body.ecosystem ?? '')) throw err('VALIDATION_FAILED', { field: 'ecosystem', allowed: ecosystems })
    const risks = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH']
    if (body.risk && !risks.includes(body.risk)) throw err('VALIDATION_FAILED', { field: 'risk', allowed: risks })
    const dep = await db.dependency.create({
      data: {
        projectId,
        name: body.name.slice(0, 160),
        ecosystem: body.ecosystem!,
        version: (body.version ?? '').slice(0, 60),
        license: (body.license ?? '').slice(0, 60),
        risk: body.risk ?? 'UNKNOWN',
        isDirect: body.isDirect ?? true,
      },
    })
    await audit({ organizationId: project.organizationId, projectId, actorUserId: user.id, action: 'dependency.create', targetType: 'DEPENDENCY', targetId: dep.id, ip: clientIp(req), traceId })
    return dep
  })
}
