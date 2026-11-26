import { db } from '@/lib/db'

// Append-only audit trail. Every privileged action must produce one.
// Audit rows are never updated or deleted by application code.

export interface AuditInput {
  organizationId?: string | null
  projectId?: string | null
  actorUserId?: string | null
  actorAddress?: string | null
  action: string
  targetType: string
  targetId: string
  metadata?: Record<string, unknown>
  ip?: string | null
  traceId?: string | null
}

export async function audit(input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      organizationId: input.organizationId ?? null,
      projectId: input.projectId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorAddress: input.actorAddress ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: JSON.stringify(input.metadata ?? {}),
      ip: input.ip ?? null,
      traceId: input.traceId ?? null,
    },
  })
}

export function traceId(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16)
}
