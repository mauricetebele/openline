/**
 * Ask AI — the in-app Claude assistant engine.
 *
 * Runs an Anthropic tool-use loop with three tools:
 *   - describe_schema  : list tables / columns (read-only introspection)
 *   - query_database   : run a READ-ONLY SELECT and return rows
 *   - send_email       : deliver results via the company email service (Resend).
 *                        This is an ACTION and requires explicit user confirmation.
 *
 * The loop is stateless per HTTP call: the full message list travels with each
 * request. When the model wants to send an email, the loop PAUSES and returns a
 * `confirm` result; the client re-calls with the tool_use id in `approved` (or
 * appends a decline tool_result) to continue.
 */
import { prisma } from '@/lib/prisma'
import { resend } from '@/lib/resend'

/* eslint-disable @typescript-eslint/no-explicit-any */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
export const DEFAULT_MODEL = 'claude-sonnet-5'
const EMAIL_FROM = 'Open Line Mobility <maurice@openline.us>'
const MAX_STEPS = 12
const ROW_CAP = 1000
const JSON_CAP = 120_000

const TOOLS = [
  {
    name: 'describe_schema',
    description: 'Introspect the Postgres database. Call with no arguments to list all tables; call with a table name to list that table\'s columns and types. ALWAYS use this before writing SQL so you use correct table/column names.',
    input_schema: { type: 'object', properties: { table: { type: 'string', description: 'Optional table name to describe.' } } },
  },
  {
    name: 'query_database',
    description: 'Run a single READ-ONLY SQL query (SELECT or WITH) against Postgres and get rows back as JSON. Writes/DDL are rejected. Results are capped at 1000 rows. Prisma identifiers are camelCase and must be double-quoted, e.g. SELECT "orderNumber" FROM sales_orders.',
    input_schema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
  },
  {
    name: 'send_email',
    description: 'Send an email from Open Line Mobility via the company email service. This is an ACTION that the user must confirm — call it in a turn by itself once the data is ready. Use attachments to deliver spreadsheets (content is the raw file text, e.g. CSV).',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string' },
        html: { type: 'string', description: 'HTML email body' },
        attachments: {
          type: 'array',
          items: { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string', description: 'Raw file contents, e.g. CSV text' } }, required: ['filename', 'content'] },
        },
      },
      required: ['to', 'subject', 'html'],
    },
  },
]

function systemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10)
  return [
    'You are "Ask AI", an assistant embedded in the Open Line Mobility operations app',
    '(inventory, wholesale sales orders, Amazon + BackMarket marketplace ops, FBA, returns).',
    'You help staff look up data and, when asked, deliver it (e.g. email a spreadsheet).',
    '',
    'Tools:',
    '- describe_schema: learn the schema. List tables first, then describe the ones you need BEFORE writing SQL.',
    '- query_database: read-only SELECT/WITH only. Postgres identifiers from Prisma are camelCase and must be double-quoted (e.g. "orderNumber", "customerPoNumber", "shippedAt").',
    '- send_email: sends from Open Line Mobility. Requires user confirmation; call it alone once data is ready. Attach spreadsheets as CSV via attachments.',
    '',
    'Useful anchors: wholesale orders = sales_orders (customer PO = "customerPoNumber", invoice = "invoiceNumber"); serials/IMEIs = inventory_serials ("serialNumber", "productId"); products = products (sku); a wholesale order\'s serials link via sales_order_serial_assignments ("salesOrderId","serialId").',
    '',
    'Be concise and accurate. Explore the schema rather than guessing. Never attempt writes or DDL. When you finish, briefly state what you found or did.',
    `Today is ${today}.`,
  ].join('\n')
}

async function callAnthropic(key: string, model: string, messages: any[]): Promise<any> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4096, system: systemPrompt(), tools: TOOLS, messages }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Anthropic API ${res.status}: ${t.slice(0, 400)}`)
  }
  return res.json()
}

const jsonReplacer = (_k: string, v: any) =>
  typeof v === 'bigint' ? v.toString()
    : (v && typeof v === 'object' && v.constructor?.name === 'Decimal') ? v.toString() : v

async function describeSchema(table?: string): Promise<string> {
  if (table && typeof table === 'string') {
    const cols = await prisma.$queryRaw<any[]>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`
    if (cols.length === 0) return `No table named "${table}" in the public schema. Call describe_schema with no arguments to list tables.`
    return `Columns of ${table}:\n` + cols.map(c => `  ${c.column_name} (${c.data_type})`).join('\n')
  }
  const tables = await prisma.$queryRaw<any[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
  return `Tables (${tables.length}):\n` + tables.map(t => t.table_name).join(', ')
}

const WRITE_RE = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge|call|copy|do|comment|vacuum|reindex|set|begin|commit|rollback)\b/i

async function queryDatabase(sql: unknown): Promise<{ content: string; isError?: boolean }> {
  if (typeof sql !== 'string' || !sql.trim()) return { content: 'No SQL provided.', isError: true }
  const s = sql.trim().replace(/;\s*$/, '')
  if (s.includes(';')) return { content: 'Only a single statement is allowed (no semicolons).', isError: true }
  if (!/^(select|with)\b/i.test(s)) return { content: 'Only read-only SELECT/WITH queries are allowed.', isError: true }
  if (WRITE_RE.test(s)) return { content: 'Rejected: the query contains a write/DDL keyword. Only read-only SELECT is allowed.', isError: true }
  let rows: any
  try { rows = await prisma.$queryRawUnsafe(s) } catch (e) { return { content: `SQL error: ${e instanceof Error ? e.message : String(e)}`, isError: true } }
  const arr = Array.isArray(rows) ? rows : [rows]
  const capped = arr.slice(0, ROW_CAP)
  let json = JSON.stringify(capped, jsonReplacer)
  if (json.length > JSON_CAP) json = json.slice(0, JSON_CAP) + '…(truncated)'
  const note = arr.length > ROW_CAP ? `\n(Showing first ${ROW_CAP} of ${arr.length} rows.)` : ''
  return { content: `${arr.length} row(s):\n${json}${note}` }
}

async function sendEmailTool(input: any): Promise<{ content: string; isError?: boolean }> {
  const to = String(input?.to || '').trim()
  const subject = String(input?.subject || '').trim()
  const html = String(input?.html || '')
  if (!to || !subject) return { content: 'to and subject are required.', isError: true }
  const attachments = Array.isArray(input?.attachments)
    ? input.attachments.filter((a: any) => a?.filename && a?.content).map((a: any) => ({ filename: String(a.filename), content: Buffer.from(String(a.content), 'utf8') }))
    : []
  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM, to, subject, html, ...(attachments.length ? { attachments } : {}),
  })
  if (error) return { content: `Email failed: ${typeof error === 'string' ? error : JSON.stringify(error)}`, isError: true }
  return { content: `Email sent to ${to}${attachments.length ? ` with ${attachments.length} attachment(s)` : ''} (id ${data?.id}).` }
}

async function executeTool(name: string, input: any): Promise<{ content: string; isError?: boolean }> {
  try {
    if (name === 'describe_schema') return { content: await describeSchema(input?.table) }
    if (name === 'query_database') return await queryDatabase(input?.sql)
    if (name === 'send_email') return await sendEmailTool(input)
    return { content: `Unknown tool: ${name}`, isError: true }
  } catch (e) {
    return { content: `Tool error: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
}

export type AgentResult =
  | { type: 'message'; text: string; messages: any[] }
  | { type: 'confirm'; pending: { toolUseId: string; input: any }; messages: any[] }

export async function runAskAi(
  opts: { key: string; model: string; messages: any[]; approved?: string[] },
): Promise<AgentResult> {
  const { key, model, approved = [] } = opts
  let messages = [...opts.messages]

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await callAnthropic(key, model, messages)
    const content: any[] = Array.isArray(resp.content) ? resp.content : []

    if (resp.stop_reason !== 'tool_use') {
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      return { type: 'message', text: text || '(no response)', messages: [...messages, { role: 'assistant', content }] }
    }

    const assistantTurn = { role: 'assistant', content }
    const toolUses = content.filter(b => b.type === 'tool_use')

    // Pause for any send_email that hasn't been approved yet.
    const pendingEmail = toolUses.find(b => b.name === 'send_email' && !approved.includes(b.id))
    if (pendingEmail) {
      return { type: 'confirm', pending: { toolUseId: pendingEmail.id, input: pendingEmail.input }, messages: [...messages, assistantTurn] }
    }

    const toolResults: any[] = []
    for (const tu of toolUses) {
      const out = await executeTool(tu.name, tu.input)
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: out.content, ...(out.isError ? { is_error: true } : {}) })
    }
    messages = [...messages, assistantTurn, { role: 'user', content: toolResults }]
  }

  return { type: 'message', text: 'Reached the maximum number of steps. Please narrow the request.', messages }
}
