import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
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
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().trim().optional(),
  MPESA_CONSUMER_SECRET: z.string().trim().optional(),
  MPESA_SHORTCODE: z.string().trim().optional(),
  MPESA_PASSKEY: z.string().trim().optional(),
  MPESA_CALLBACK_URL: z.string().url().optional(),
  MPESA_TRANSACTION_TYPE: z.enum(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']).default('CustomerPayBillOnline'),
})
const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid API environment configuration:', parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`).join('; '))
  process.exit(1)
}
const env = parsed.data
const mpesaConfig = {
  environment: env.MPESA_ENV,
  consumerKey: env.MPESA_CONSUMER_KEY,
  consumerSecret: env.MPESA_CONSUMER_SECRET,
  shortcode: env.MPESA_SHORTCODE,
  passkey: env.MPESA_PASSKEY,
  callbackUrl: env.MPESA_CALLBACK_URL,
  transactionType: env.MPESA_TRANSACTION_TYPE,
}
const mpesaConfigured = Object.values(mpesaConfig).every((value) => Boolean(value))
const mpesaApiBase = env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
let cachedDarajaToken: { value: string; expiresAt: number } | undefined
if (env.NODE_ENV === 'production' && (!env.DATABASE_URL || !env.SESSION_SECRET)) {
  console.error('Production requires DATABASE_URL and SESSION_SECRET (32+ characters).')
  process.exit(1)
}
async function createPool() {
  if (env.DATABASE_URL) return new Pool({ connectionString: env.DATABASE_URL, max: 5, ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })
  if (env.NODE_ENV === 'production') return undefined

  try {
    const { randomUUID } = await import('node:crypto')
    const { DataType, newDb } = await import('pg-mem')
    const db = newDb()
    db.public.registerFunction({
      name: 'gen_random_uuid',
      args: [],
      returns: DataType.uuid,
      implementation: () => randomUUID(),
    })
    db.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (value: string | null | undefined) => String(value ?? '').length,
    })
    db.public.registerFunction({
      name: 'pg_advisory_xact_lock',
      args: [DataType.bigint],
      returns: DataType.integer,
      implementation: () => 1,
    })
    const { Pool: PgMemPool } = db.adapters.createPg()
    return new PgMemPool()
  } catch {
    console.warn('No DATABASE_URL configured; pg-mem fallback unavailable. Set DATABASE_URL for this environment.')
    return undefined
  }
}
const pool = await createPool()
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
  if (env.NODE_ENV === 'production') return false
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  } catch {
    return false
  }
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
function darajaTimestamp() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`
}
function normalizeKenyanPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  const normalized = digits.startsWith('254') ? digits : digits.startsWith('0') ? `254${digits.slice(1)}` : `254${digits}`
  return /^254[17]\d{8}$/.test(normalized) ? normalized : null
}
async function darajaToken() {
  if (!mpesaConfigured) throw new Error('Daraja is not configured. Add all required MPESA_* environment variables.')
  if (cachedDarajaToken && cachedDarajaToken.expiresAt > Date.now() + 30_000) return cachedDarajaToken.value

  const credentials = Buffer.from(`${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`).toString('base64')
  const response = await fetch(`${mpesaApiBase}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
    signal: AbortSignal.timeout(15_000),
  })
  const result = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: string | number; errorMessage?: string }
  if (!response.ok || !result.access_token) throw new Error(result.errorMessage ?? `Daraja authentication failed (${response.status}).`)
  const expiresIn = Number(result.expires_in ?? 3600)
  cachedDarajaToken = { value: result.access_token, expiresAt: Date.now() + expiresIn * 1000 }
  return result.access_token
}
async function darajaPost(path: string, payload: Record<string, unknown>) {
  const token = await darajaToken()
  const response = await fetch(`${mpesaApiBase}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  })
  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(String(result.errorMessage ?? result.ResponseDescription ?? `Daraja request failed (${response.status}).`))
  return result
}
function mpesaPassword(timestamp: string) {
  return Buffer.from(`${mpesaConfig.shortcode}${mpesaConfig.passkey}${timestamp}`).toString('base64')
}
async function queryDarajaPayment(checkoutRequestId: string) {
  const timestamp = darajaTimestamp()
  return darajaPost('/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: mpesaConfig.shortcode,
    Password: mpesaPassword(timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  })
}
app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin) ? origin : false), credentials: true, methods: ['GET', 'POST', 'PATCH'], allowedHeaders: ['Content-Type'] }))
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
    response.json({ bootstrapAvailable: result.rows[0].count === 0 })
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
    await client.query('INSERT INTO workspace_members (user_id, workspace_id, role) VALUES ($1, $2, $3)', [user.rows[0].id, workspace.rows[0].id, 'admin'])
    await client.query('COMMIT')
    const row = user.rows[0]
    setSessionCookie(response, { userId: row.id, workspaceId: row.workspace_id, expiresAt: Date.now() + sessionTtlSeconds * 1000 })
    response.status(201).json({ user: { email: row.email ?? row.phone }, workspace: { id: row.workspace_id, name: input.data.businessName }, workspaces: [{ id: row.workspace_id, name: input.data.businessName, role: 'admin' }] })
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

    const membershipsResult = await pool!.query('SELECT wm.workspace_id, wm.role, w.name FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = $1', [user.id])
    const memberships: Array<{ workspace_id: string; role: string; name: string }> = membershipsResult.rows as Array<{ workspace_id: string; role: string; name: string }>
    const workspaces = memberships.length ? memberships.map((row) => ({ id: row.workspace_id, name: row.name, role: row.role })) : [{ id: user.workspace_id, name: user.workspace_name, role: 'admin' }]
    setSessionCookie(response, { userId: user.id, workspaceId: user.workspace_id, expiresAt: Date.now() + sessionTtlSeconds * 1000 })
    response.json({ user: { email: user.email ?? user.phone }, workspace: { id: user.workspace_id, name: user.workspace_name }, workspaces })
  } catch (error) { next(error) }
})

app.post('/v1/auth/logout', verifyOrigin, (_request, response) => { response.clearCookie(cookieName, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax', path: '/' }); response.status(204).end() })
app.get('/v1/auth/me', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT u.email, u.phone, wm.workspace_id, w.name AS workspace_name FROM users u JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = $2 JOIN workspaces w ON w.id = wm.workspace_id WHERE u.id = $1', [request.session!.userId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(401).json({ error: 'Session is no longer valid.' }); return }
    const membershipsResult = await pool!.query('SELECT wm.workspace_id, wm.role, w.name FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = $1 ORDER BY w.name ASC', [request.session!.userId])
    const memberships: Array<{ workspace_id: string; role: string; name: string }> = membershipsResult.rows as Array<{ workspace_id: string; role: string; name: string }>
    const workspaces = memberships.length ? memberships.map((row) => ({ id: row.workspace_id, name: row.name, role: row.role })) : [{ id: result.rows[0].workspace_id, name: result.rows[0].workspace_name, role: 'admin' }]
    response.json({ user: { email: result.rows[0].email ?? result.rows[0].phone }, workspace: { id: result.rows[0].workspace_id, name: result.rows[0].workspace_name }, workspaces })
  } catch (error) { next(error) }
})

app.get('/v1/dashboard', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const workspaceId = request.session!.workspaceId
    const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
    const dateValues = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]))
    const monthStart = `${dateValues.year}-${dateValues.month}-01`
    const [workspace, totals, transactions, cashflow, invoices] = await Promise.all([
      pool!.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]),
      pool!.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'income' AND transaction_date >= $2), 0)::text AS month_income, COALESCE(SUM(amount) FILTER (WHERE direction = 'expense' AND transaction_date >= $2), 0)::text AS month_expenses, COALESCE(SUM(amount) FILTER (WHERE direction = 'income'), 0)::text AS all_income, COALESCE(SUM(amount) FILTER (WHERE direction = 'expense'), 0)::text AS all_expenses FROM ledger_transactions WHERE workspace_id = $1`, [workspaceId, monthStart]),
      pool!.query('SELECT id, description, amount::text, direction, account, transaction_date, created_at FROM ledger_transactions WHERE workspace_id = $1 ORDER BY transaction_date DESC, created_at DESC LIMIT 20', [workspaceId]),
      pool!.query(`SELECT transaction_date AS date, COALESCE(SUM(amount) FILTER (WHERE direction = 'income'), 0)::text AS income, COALESCE(SUM(amount) FILTER (WHERE direction = 'expense'), 0)::text AS expense FROM ledger_transactions WHERE workspace_id = $1 AND transaction_date >= $2 GROUP BY transaction_date ORDER BY transaction_date`, [workspaceId, monthStart]),
      pool!.query("SELECT count(*)::int AS count, COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid'), 0)::text AS unpaid_amount FROM invoices WHERE workspace_id = $1", [workspaceId]),
    ])
    const asDateString = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
    response.json({ workspaceName: workspace.rows[0]?.name ?? '', totals: { monthIncome: totals.rows[0].month_income, monthExpenses: totals.rows[0].month_expenses, monthNet: (Number(totals.rows[0].month_income) - Number(totals.rows[0].month_expenses)).toFixed(2) }, transactions: transactions.rows.map((row: Record<string, unknown>) => ({ ...row, transaction_date: asDateString(row.transaction_date) })), cashflow: cashflow.rows.map((row: Record<string, unknown>) => ({ ...row, date: asDateString(row.date) })), invoices: invoices.rows[0] })
  } catch (error) { next(error) }
})

app.post('/v1/workspaces', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({ name: z.string().trim().min(1).max(120) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a business name.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const workspaceId = randomUUID()
    const workspace = await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2) RETURNING id, name', [workspaceId, input.data.name])
    const membership = await client.query('INSERT INTO workspace_members (id, user_id, workspace_id, role) VALUES ($1, $2, $3, $4) RETURNING role', [randomUUID(), request.session!.userId, workspaceId, 'admin'])
    await client.query('COMMIT')
    setSessionCookie(response, { ...request.session!, workspaceId })
    response.status(201).json({ workspace: { id: workspace.rows[0].id, name: workspace.rows[0].name, role: membership.rows[0].role } })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})

app.post('/v1/workspaces/:workspaceId/invitations', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    role: z.string().trim().min(1).max(50).regex(/^[\p{L}\p{N} _-]+$/u),
    scope: z.enum(['single', 'all_owned']).default('single'),
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide a valid email address and a role name (up to 50 letters, numbers, spaces, hyphens, or underscores).' }); return }
  if (request.params.workspaceId !== request.session!.workspaceId) { response.status(403).json({ error: 'Invitations can only be created for the active business.' }); return }

  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const currentAdmin = await client.query('SELECT 1 FROM workspace_members WHERE user_id = $1 AND workspace_id = $2 AND role = $3', [request.session!.userId, request.session!.workspaceId, 'admin'])
    if (!currentAdmin.rowCount) { await client.query('ROLLBACK'); response.status(403).json({ error: 'Only a business admin can invite team members.' }); return }

    let targets: Array<{ workspace_id: string; name: string }> = []
    if (input.data.scope === 'all_owned') {
      const result = await client.query('SELECT wm.workspace_id, w.name FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = $1 AND wm.role = $2 ORDER BY w.name', [request.session!.userId, 'admin'])
      targets = result.rows as Array<{ workspace_id: string; name: string }>
    } else {
      const result = await client.query('SELECT id AS workspace_id, name FROM workspaces WHERE id = $1', [request.session!.workspaceId])
      targets = result.rows as Array<{ workspace_id: string; name: string }>
    }
    if (!targets.length) { await client.query('ROLLBACK'); response.status(403).json({ error: 'No businesses are available for this invitation.' }); return }

    const invite = await client.query('INSERT INTO workspace_invitations (workspace_id, email, role, scope, invited_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role, scope, status', [request.session!.workspaceId, input.data.email, input.data.role, input.data.scope, request.session!.userId])
    for (const target of targets) {
      await client.query('INSERT INTO invitation_workspaces (id, invitation_id, workspace_id) VALUES ($1, $2, $3)', [randomUUID(), invite.rows[0].id, target.workspace_id])
    }
    await client.query('COMMIT')
    response.status(201).json({ invitation: { ...invite.rows[0], businesses: targets.map((target) => target.name) }, delivery: 'not_configured' })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})

app.patch('/v1/invoices/:invoiceId/status', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({ status: z.enum(['unpaid', 'paid', 'void']) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Status must be unpaid, paid, or void.' }); return }
  try {
    const result = await pool!.query('UPDATE invoices SET status = $1 WHERE id = $2 AND workspace_id = $3 RETURNING id, status', [input.data.status, request.params.invoiceId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(404).json({ error: 'Invoice not found in this workspace.' }); return }
    response.json({ invoice: result.rows[0] })
  } catch (error) { next(error) }
})

app.post('/v1/transactions', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({ description: z.string().trim().min(1).max(240), amount: z.coerce.number().finite().positive().max(999999999999), direction: z.enum(['income', 'expense']), account: z.string().trim().min(1).max(80), date: z.string().date() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a description, positive amount, transaction type, account, and valid date.' }); return }
  try {
    const result = await pool!.query('INSERT INTO ledger_transactions (workspace_id, description, amount, direction, account, transaction_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, description, amount::text, direction, account, transaction_date, created_at', [request.session!.workspaceId, input.data.description, input.data.amount.toFixed(2), input.data.direction, input.data.account, input.data.date])
    response.status(201).json({ transaction: result.rows[0] })
  } catch (error) { next(error) }
})

app.post('/v1/invoices', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({ customer: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(240), amount: z.coerce.number().finite().positive().max(999999999999), dueDate: z.string().date() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a customer, description, positive amount, and valid due date.' }); return }
  try {
    const result = await pool!.query('INSERT INTO invoices (workspace_id, customer, description, amount, due_date) VALUES ($1, $2, $3, $4, $5) RETURNING id, customer, description, amount::text, due_date, status, created_at', [request.session!.workspaceId, input.data.customer, input.data.description, input.data.amount.toFixed(2), input.data.dueDate])
    response.status(201).json({ invoice: result.rows[0] })
  } catch (error) { next(error) }
})

app.post('/v1/invoices/:invoiceId/payments/mpesa', requirePool, verifyOrigin, requireSession, rateLimit({ windowMs: 15 * 60_000, limit: 5 }), async (request: AuthedRequest, response, next) => {
  if (!mpesaConfigured) { response.status(503).json({ error: 'M-Pesa is not configured. Set all required MPESA_* API environment variables and a public callback URL.' }); return }
  if (env.MPESA_ENV === 'production' && !env.MPESA_CALLBACK_URL!.startsWith('https://')) { response.status(503).json({ error: 'Production Daraja requires a public HTTPS MPESA_CALLBACK_URL.' }); return }

  const input = z.object({ phone: z.string().trim().min(7).max(24) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter the customer’s Safaricom-compatible Kenyan phone number.' }); return }
  const phone = normalizeKenyanPhone(input.data.phone)
  if (!phone) { response.status(400).json({ error: 'Use a valid Kenyan mobile number, such as 0712345678 or 254712345678.' }); return }

  try {
    const invoiceResult = await pool!.query('SELECT id, amount, status FROM invoices WHERE id = $1 AND workspace_id = $2', [request.params.invoiceId, request.session!.workspaceId])
    if (!invoiceResult.rowCount) { response.status(404).json({ error: 'Invoice not found in this business.' }); return }
    const invoiceAmount = Number(invoiceResult.rows[0].amount)
    if (invoiceResult.rows[0].status !== 'unpaid') { response.status(409).json({ error: 'Only unpaid invoices can be sent for M-Pesa payment.' }); return }
    if (!Number.isSafeInteger(invoiceAmount) || invoiceAmount < 1) { response.status(400).json({ error: 'M-Pesa STK Push requires a whole-number KSh invoice amount.' }); return }

    const paymentId = randomUUID()
    await pool!.query('INSERT INTO mpesa_payment_requests (id, workspace_id, invoice_id, customer_phone, amount, status) VALUES ($1, $2, $3, $4, $5, $6)', [paymentId, request.session!.workspaceId, request.params.invoiceId, phone, invoiceAmount.toFixed(2), 'initiating'])
    const timestamp = darajaTimestamp()
    try {
      const result = await darajaPost('/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: mpesaConfig.shortcode,
        Password: mpesaPassword(timestamp),
        Timestamp: timestamp,
        TransactionType: mpesaConfig.transactionType,
        Amount: invoiceAmount,
        PartyA: phone,
        PartyB: mpesaConfig.shortcode,
        PhoneNumber: phone,
        CallBackURL: mpesaConfig.callbackUrl,
        AccountReference: `KF-${String(request.params.invoiceId).replace(/-/g, '').slice(0, 10)}`,
        TransactionDesc: 'Invoice payment',
      })
      const checkoutRequestId = String(result.CheckoutRequestID ?? '')
      if (String(result.ResponseCode ?? '') !== '0' || !checkoutRequestId) throw new Error(String(result.ResponseDescription ?? 'Daraja did not accept the STK Push request.'))
      await pool!.query('UPDATE mpesa_payment_requests SET status = $1, merchant_request_id = $2, checkout_request_id = $3 WHERE id = $4', ['pending', String(result.MerchantRequestID ?? ''), checkoutRequestId, paymentId])
      response.status(202).json({ payment: { id: paymentId, status: 'pending' }, customerMessage: String(result.CustomerMessage ?? 'Check the customer’s phone and complete the M-Pesa prompt.') })
    } catch (error) {
      await pool!.query('UPDATE mpesa_payment_requests SET status = $1, result_description = $2 WHERE id = $3', ['failed', error instanceof Error ? error.message.slice(0, 500) : 'Daraja request failed.', paymentId])
      response.status(502).json({ error: error instanceof Error ? error.message : 'Daraja could not start the payment request.' })
    }
  } catch (error) { next(error) }
})

app.get('/v1/invoices/:invoiceId/payments/mpesa', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, status, amount::text, result_description, mpesa_receipt_number, created_at FROM mpesa_payment_requests WHERE invoice_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT 10', [request.params.invoiceId, request.session!.workspaceId])
    response.json({ payments: result.rows })
  } catch (error) { next(error) }
})

app.post('/v1/integrations/mpesa/callback', requirePool, rateLimit({ windowMs: 60_000, limit: 60 }), async (request, response, next) => {
  const input = z.object({ Body: z.object({ stkCallback: z.object({ CheckoutRequestID: z.string().min(1), ResultCode: z.union([z.number(), z.string()]), ResultDesc: z.string().optional(), CallbackMetadata: z.object({ Item: z.array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() })) }).optional() }).passthrough() }).passthrough() }).passthrough().safeParse(request.body)
  if (!input.success) { response.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback payload.' }); return }
  const callback = input.data.Body.stkCallback
  try {
    const paymentResult = await pool!.query('SELECT id, invoice_id, workspace_id, amount::text, status FROM mpesa_payment_requests WHERE checkout_request_id = $1', [callback.CheckoutRequestID])
    const payment = paymentResult.rows[0]
    if (!payment) { response.status(200).json({ ResultCode: 0, ResultDesc: 'Callback received.' }); return }
    if (payment.status === 'paid' || payment.status === 'failed') { response.status(200).json({ ResultCode: 0, ResultDesc: 'Callback already processed.' }); return }

    const resultCode = String(callback.ResultCode)
    const resultDescription = (callback.ResultDesc ?? '').slice(0, 500)
    if (resultCode !== '0') {
      await pool!.query('UPDATE mpesa_payment_requests SET status = $1, result_code = $2, result_description = $3, callback_received_at = now() WHERE id = $4', ['failed', resultCode, resultDescription, payment.id])
      response.status(200).json({ ResultCode: 0, ResultDesc: 'Callback received.' })
      return
    }

    const metadata = Object.fromEntries((callback.CallbackMetadata?.Item ?? []).map(({ Name, Value }) => [Name, Value]))
    if (Number(metadata.Amount) !== Number(payment.amount) || !metadata.MpesaReceiptNumber) {
      await pool!.query('UPDATE mpesa_payment_requests SET result_code = $1, result_description = $2, callback_received_at = now() WHERE id = $3', ['verification_required', 'Successful callback did not contain the expected amount and receipt number.', payment.id])
      response.status(503).json({ ResultCode: 1, ResultDesc: 'Payment is awaiting verification.' })
      return
    }

    const verification = await queryDarajaPayment(callback.CheckoutRequestID)
    if (String(verification.ResultCode ?? '') !== '0') {
      await pool!.query('UPDATE mpesa_payment_requests SET result_code = $1, result_description = $2, callback_received_at = now() WHERE id = $3', [String(verification.ResultCode ?? 'verification_pending'), String(verification.ResultDesc ?? 'Awaiting Daraja payment verification.').slice(0, 500), payment.id])
      response.status(503).json({ ResultCode: 1, ResultDesc: 'Payment is awaiting verification.' })
      return
    }

    const client = await pool!.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE mpesa_payment_requests SET status = $1, result_code = $2, result_description = $3, mpesa_receipt_number = $4, callback_received_at = now() WHERE id = $5', ['paid', '0', resultDescription, String(metadata.MpesaReceiptNumber), payment.id])
      await client.query('UPDATE invoices SET status = $1 WHERE id = $2 AND workspace_id = $3 AND status = $4', ['paid', payment.invoice_id, payment.workspace_id, 'unpaid'])
      await client.query('COMMIT')
      response.status(200).json({ ResultCode: 0, ResultDesc: 'Payment verified.' })
    } catch (error) { await client.query('ROLLBACK'); next(error) }
    finally { client.release() }
  } catch (error) { next(error) }
})

app.get('/v1/integrations/readiness', (_request, response) => {
  const callbackIsSecure = env.MPESA_ENV !== 'production' || env.MPESA_CALLBACK_URL?.startsWith('https://') === true
  const mpesaReady = mpesaConfigured && callbackIsSecure
  response.json({ mode: mpesaReady ? 'mpesa_configured' : 'setup_required', integrations: [
    { id: 'kra_etims', status: 'provider_and_kra_approval_required' },
    { id: 'mpesa', status: mpesaReady ? `configured_${env.MPESA_ENV}` : 'daraja_credentials_and_callback_required' },
    { id: 'bank_feeds', status: 'open_banking_provider_required' },
    { id: 'paye_shif_nssf_ahl', status: 'verified_payroll_and_filing_provider_required' },
  ], note: 'M-Pesa STK Push is enabled only when server-side Daraja credentials and a callback URL are configured; other listed integrations are not implemented.' })
})
app.use((_request, response) => response.status(404).json({ error: 'Not found' }))
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof SyntaxError) { response.status(400).json({ error: 'Invalid JSON request body' }); return }
  console.error('Unhandled API error:', error)
  response.status(500).json({ error: 'Internal server error', ...(env.NODE_ENV === 'production' ? {} : { detail: error instanceof Error ? error.message : String(error) }) })
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
