import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { Pool } from 'pg'
import { z } from 'zod'

const scrypt = promisify(scryptCallback)
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
})
const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid API environment configuration:', parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`).join('; '))
  process.exit(1)
}
const env = parsed.data
if (env.NODE_ENV === 'production' && (!env.DATABASE_URL || !env.SESSION_SECRET || !env.BOOTSTRAP_ADMIN_EMAIL)) {
  console.error('Production requires DATABASE_URL, SESSION_SECRET (32+ characters), and BOOTSTRAP_ADMIN_EMAIL.')
  process.exit(1)
}
const pool = env.DATABASE_URL ? new Pool({ connectionString: env.DATABASE_URL, max: 5, ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined }) : undefined
const app = express()
const cookieName = 'kashflow_session'
const sessionTtlSeconds = 60 * 60 * 12
const passwordSchema = z.string().min(12).max(200)
const emailSchema = z.string().email().max(254).transform((value) => value.toLowerCase())
const phoneSchema = z.string().trim().min(7).max(30).transform((value) => value.replace(/[\s().-]/g, ''))

type Session = { userId: string; workspaceId: string; expiresAt: number }
type AuthedRequest = express.Request & { session?: Session }

function normalizeIdentifier(value: string): { email: string | null; phone: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { email: null, phone: null }
  if (trimmed.includes('@')) {
    return { email: trimmed.toLowerCase(), phone: null }
  }
  const phone = trimmed.replace(/[^\d+]/g, '')
  return { email: null, phone: phone || null }
}

function signSession(session: Session) {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  const signature = createHmac('sha256', env.SESSION_SECRET ?? 'local-only-change-this-secret-at-least-32-chars').update(payload).digest('base64url')
  return `${payload}.${signature}`
}
function readSession(token: string | undefined): Session | null {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = createHmac('sha256', env.SESSION_SECRET ?? 'local-only-change-this-secret-at-least-32-chars').update(payload).digest()
  let received: Buffer
  try { received = Buffer.from(signature, 'base64url') } catch { return null }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session
    if (!value.userId || !value.workspaceId || value.expiresAt <= Date.now()) return null
    return value
  } catch { return null }
}
function cookies(header: string | undefined) {
  const entries: Array<[string, string]> = []
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    try { entries.push([key, decodeURIComponent(value)]) } catch { continue }
  }
  return Object.fromEntries(entries)
}
function setSessionCookie(response: express.Response, session: Session) {
  response.cookie(cookieName, signSession(session), { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax', maxAge: sessionTtlSeconds * 1000, path: '/' })
}
function isAllowedOrigin(origin: string | undefined) {
  if (origin === env.FRONTEND_ORIGIN) return true
  return env.NODE_ENV !== 'production' && (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173')
}
async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64) as Buffer
  return `${salt.toString('hex')}:${derived.toString('hex')}`
}
async function verifyPassword(password: string, encoded: string) {
  const [saltHex, hashHex] = encoded.split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length) as Buffer
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
function requirePool(_request: express.Request, response: express.Response, next: express.NextFunction) {
  if (!pool) { response.status(503).json({ error: 'Database is not configured. Set DATABASE_URL.' }); return }
  next()
}
function requireSession(request: AuthedRequest, response: express.Response, next: express.NextFunction) {
  request.session = readSession(cookies(request.headers.cookie)[cookieName]) ?? undefined
  if (!request.session) { response.status(401).json({ error: 'Sign in to access this workspace.' }); return }
  next()
}
function verifyOrigin(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (!isAllowedOrigin(request.get('origin'))) { response.status(403).json({ error: 'Request origin is not allowed.' }); return }
  next()
}
app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin) ? origin : false), credentials: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }))
app.use(express.json({ limit: '32kb', type: 'application/json' }))
app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }))

app.get('/healthz', async (_request, response) => {
  if (!pool) { response.status(503).json({ status: 'degraded', database: 'not_configured' }); return }
  try { await pool.query('SELECT 1'); response.json({ status: 'ok', database: 'available' }) }
  catch { response.status(503).json({ status: 'degraded', database: 'unavailable' }) }
})

app.get('/v1/auth/status', requirePool, async (_request, response, next) => {
  try {
    const result = await pool!.query('SELECT count(*)::int AS count FROM users')
    response.json({ bootstrapAvailable: result.rows[0].count === 0, configured: Boolean(env.BOOTSTRAP_ADMIN_EMAIL) })
  } catch (error) { next(error) }
})

app.post('/v1/auth/bootstrap', requirePool, verifyOrigin, rateLimit({ windowMs: 15 * 60_000, limit: 5 }), async (request, response, next) => {
  const input = z.object({
    identifier: z.string().trim().min(1).max(254),
    password: passwordSchema,
    businessName: z.string().trim().min(1).max(120),
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a business name, a valid email or phone number, and a password of at least 12 characters.' }); return }

  const normalized = normalizeIdentifier(input.data.identifier)
  if (!normalized.email && !normalized.phone) { response.status(400).json({ error: 'Enter a valid email or phone number.' }); return }
  const email = normalized.email ?? null
  const phone = normalized.phone ?? null

  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(748201)')
    const existing = await client.query('SELECT id FROM users WHERE ($1::text IS NOT NULL AND email = $1) OR ($2::text IS NOT NULL AND phone = $2) LIMIT 1', [email, phone])
    if (existing.rowCount) { await client.query('ROLLBACK'); response.status(409).json({ error: 'That email or phone number is already in use.' }); return }
    const workspace = await client.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING id', [input.data.businessName])
    const user = await client.query('INSERT INTO users (workspace_id, email, phone, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, workspace_id, email, phone', [workspace.rows[0].id, email, phone, await hashPassword(input.data.password)])
    await client.query('COMMIT')
    const row = user.rows[0]
    setSessionCookie(response, { userId: row.id, workspaceId: row.workspace_id, expiresAt: Date.now() + sessionTtlSeconds * 1000 })
    response.status(201).json({ user: { email: row.email ?? row.phone }, workspace: { id: row.workspace_id, name: input.data.businessName } })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})

app.post('/v1/auth/login', requirePool, verifyOrigin, rateLimit({ windowMs: 15 * 60_000, limit: 10 }), async (request, response, next) => {
  const input = z.object({
    identifier: z.string().trim().min(1).max(254).optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: z.string().min(1).max(200),
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a valid email or phone number and password.' }); return }

  const rawIdentifier = input.data.identifier ?? input.data.email ?? input.data.phone
  const normalized = rawIdentifier ? normalizeIdentifier(String(rawIdentifier)) : { email: null, phone: null }
  if (!normalized.email && !normalized.phone) { response.status(400).json({ error: 'Enter a valid email or phone number and password.' }); return }

  try {
    const result = await pool!.query('SELECT u.id, u.workspace_id, u.email, u.phone, u.password_hash, w.name AS workspace_name FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE (u.email = $1 OR u.phone = $2) LIMIT 1', [normalized.email, normalized.phone])
    const user = result.rows[0]
    if (!user || !(await verifyPassword(input.data.password, user.password_hash))) { response.status(401).json({ error: 'Email/phone or password is incorrect.' }); return }
    setSessionCookie(response, { userId: user.id, workspaceId: user.workspace_id, expiresAt: Date.now() + sessionTtlSeconds * 1000 })
    response.json({ user: { email: user.email ?? user.phone }, workspace: { id: user.workspace_id, name: user.workspace_name } })
  } catch (error) { next(error) }
})

app.post('/v1/auth/logout', verifyOrigin, (_request, response) => { response.clearCookie(cookieName, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax', path: '/' }); response.status(204).end() })
app.get('/v1/auth/me', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT u.email, w.id AS workspace_id, w.name FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE u.id = $1 AND w.id = $2', [request.session!.userId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(401).json({ error: 'Session is no longer valid.' }); return }
    response.json({ user: { email: result.rows[0].email }, workspace: { id: result.rows[0].workspace_id, name: result.rows[0].name } })
  } catch (error) { next(error) }
})

app.get('/v1/dashboard', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const workspaceId = request.session!.workspaceId
    const [workspace, totals, transactions, cashflow, invoices] = await Promise.all([
      pool!.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]),
         pool!.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'income' AND transaction_date >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Nairobi')::date), 0)::text AS month_income, COALESCE(SUM(amount) FILTER (WHERE direction = 'expense' AND transaction_date >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Nairobi')::date), 0)::text AS month_expenses, COALESCE(SUM(amount) FILTER (WHERE direction = 'income'), 0)::text AS all_income, COALESCE(SUM(amount) FILTER (WHERE direction = 'expense'), 0)::text AS all_expenses FROM ledger_transactions WHERE workspace_id = $1`, [workspaceId]),
      pool!.query('SELECT id, description, amount::text, direction, account, transaction_date::text, created_at FROM ledger_transactions WHERE workspace_id = $1 ORDER BY transaction_date DESC, created_at DESC LIMIT 20', [workspaceId]),
      pool!.query(`SELECT transaction_date::text AS date, COALESCE(SUM(amount) FILTER (WHERE direction = 'income'), 0)::text AS income, COALESCE(SUM(amount) FILTER (WHERE direction = 'expense'), 0)::text AS expense FROM ledger_transactions WHERE workspace_id = $1 AND transaction_date >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Nairobi')::date GROUP BY transaction_date ORDER BY transaction_date`, [workspaceId]),
      pool!.query("SELECT count(*)::int AS count, COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid'), 0)::text AS unpaid_amount FROM invoices WHERE workspace_id = $1", [workspaceId]),
    ])
    response.json({ workspaceName: workspace.rows[0]?.name ?? '', totals: { monthIncome: totals.rows[0].month_income, monthExpenses: totals.rows[0].month_expenses, monthNet: (Number(totals.rows[0].month_income) - Number(totals.rows[0].month_expenses)).toFixed(2) }, transactions: transactions.rows, cashflow: cashflow.rows, invoices: invoices.rows[0] })
  } catch (error) { next(error) }
})

app.post('/v1/transactions', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({ description: z.string().trim().min(1).max(240), amount: z.coerce.number().finite().positive().max(999999999999), direction: z.enum(['income', 'expense']), account: z.string().trim().min(1).max(80), date: z.string().date() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a description, positive amount, transaction type, account, and valid date.' }); return }
  try {
    const result = await pool!.query('INSERT INTO ledger_transactions (workspace_id, description, amount, direction, account, transaction_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, description, amount::text, direction, account, transaction_date::text, created_at', [request.session!.workspaceId, input.data.description, input.data.amount.toFixed(2), input.data.direction, input.data.account, input.data.date])
    response.status(201).json({ transaction: result.rows[0] })
  } catch (error) { next(error) }
})

app.post('/v1/invoices', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({ customer: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(240), amount: z.coerce.number().finite().positive().max(999999999999), dueDate: z.string().date() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a customer, description, positive amount, and valid due date.' }); return }
  try {
    const result = await pool!.query('INSERT INTO invoices (workspace_id, customer, description, amount, due_date) VALUES ($1, $2, $3, $4, $5) RETURNING id, customer, description, amount::text, due_date::text, status, created_at', [request.session!.workspaceId, input.data.customer, input.data.description, input.data.amount.toFixed(2), input.data.dueDate])
    response.status(201).json({ invoice: result.rows[0] })
  } catch (error) { next(error) }
})

app.get('/v1/integrations/readiness', (_request, response) => response.json({ mode: 'setup_required', integrations: [{ id: 'kra_etims', status: 'provider_required' }, { id: 'mpesa', status: 'daraja_credentials_required' }, { id: 'bank_feeds', status: 'provider_required' }, { id: 'paye_shif_nssf_ahl', status: 'filing_route_required' }], note: 'No external provider is connected.' }))
app.use((_request, response) => response.status(404).json({ error: 'Not found' }))
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof SyntaxError) { response.status(400).json({ error: 'Invalid JSON request body' }); return }
  console.error('Unhandled API error:', error)
  response.status(500).json({ error: 'Internal server error' })
})

async function start() {
  if (pool) {
    const { readdir, readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const migrationDir = fileURLToPath(new URL('../migrations', import.meta.url))
    const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort()
    for (const file of files) {
      const migration = await readFile(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), 'utf8')
      await pool.query(migration)
    }
  }
  return app.listen(env.PORT, () => console.info(`KashFlow API listening on port ${env.PORT}`))
}
const server = await start()
async function shutdown() { server.close(); await pool?.end() }
process.on('SIGTERM', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })
