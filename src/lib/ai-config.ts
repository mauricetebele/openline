import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'

/** Anthropic API key — from the Settings-stored config, falling back to env. */
export async function getAnthropicKey(): Promise<string | null> {
  const cfg = await prisma.aiConfig.findUnique({ where: { id: 'singleton' }, select: { anthropicKeyEnc: true } }).catch(() => null)
  if (cfg?.anthropicKeyEnc) { try { return decrypt(cfg.anthropicKeyEnc) } catch { /* fall through */ } }
  return process.env.ANTHROPIC_API_KEY || null
}

export async function aiConfigured(): Promise<boolean> {
  return !!(await getAnthropicKey())
}
