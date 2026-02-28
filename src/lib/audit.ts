import { prisma } from './prisma'

interface AuditParams {
  entityType: string
  entityId: string
  action: string
  before?: unknown
  after?: unknown
  actorId?: string | null
  actorLabel: string
  refundId?: string | null
}

export async function logAuditEvent(params: AuditParams): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      before: params.before as object ?? undefined,
      after: params.after as object ?? undefined,
      actorId: params.actorId ?? undefined,
      actorLabel: params.actorLabel,
      refundId: params.refundId ?? undefined,
    },
  })
}
