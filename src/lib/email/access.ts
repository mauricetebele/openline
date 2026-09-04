import { prisma } from '@/lib/prisma'
import type { AuthUser } from '@/lib/get-auth-user'

/** A mailbox is usable by its assigned owner, or by any admin. */
export async function canUseMailAccount(accountId: string, user: AuthUser): Promise<boolean> {
  if (user.role === 'ADMIN') return true
  const acct = await prisma.emailAccount.findUnique({ where: { id: accountId }, select: { assignedUserId: true } })
  return !!acct && acct.assignedUserId === user.dbId
}
