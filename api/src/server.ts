import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { promisify } from 'node:util'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { Pool, type PoolClient } from 'pg'
import { z } from 'zod'
import { estimateKenyaPayroll, type KenyaPayrollEstimate } from './domain/kenyaPayroll.js'
import { createDatabaseBackup, isBackupInProgress, listDatabaseBackups, restoreDatabaseBackup, type BackupSettings } from './operations/databaseBackups.js'

const scrypt = promisify(scryptCallback)
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_SSL_MODE: z.enum(['verify-full', 'require']).default('verify-full'),
  SESSION_SECRET: z.string().min(32).optional(),
  PAYROLL_DATA_ENCRYPTION_KEY: z.string().min(32).optional(),
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().trim().optional(),
  MPESA_CONSUMER_SECRET: z.string().trim().optional(),
  MPESA_SHORTCODE: z.string().trim().optional(),
  MPESA_PASSKEY: z.string().trim().optional(),
  MPESA_CALLBACK_URL: z.string().url().optional(),
  MPESA_TRANSACTION_TYPE: z.enum(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']).default('CustomerPayBillOnline'),
  RESEND_API_KEY: z.string().trim().optional(),
  EMAIL_FROM: z.string().trim().max(200).optional(),
  MONO_PUBLIC_KEY: z.string().trim().optional(),
  MONO_SECRET_KEY: z.string().trim().optional(),
  MONO_WEBHOOK_SECRET: z.string().trim().optional(),
  MONO_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(15).max(1440).default(60),
  KRA_ETIMS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  KRA_ETIMS_LIVE_ENABLED: z.enum(['true', 'false']).default('false'),
  KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY: z.string().min(32).optional(),
  ONLINE_COMMERCE_ENCRYPTION_KEY: z.string().min(32).optional(),
  BACKUP_OPERATOR_TOKEN: z.string().min(32).optional(),
  BACKUP_RESTORE_MAINTENANCE_MODE: z.enum(['true', 'false']).default('false'),
  BACKUP_S3_ENDPOINT: z.string().url().optional(),
  BACKUP_S3_REGION: z.string().trim().min(1).optional(),
  BACKUP_S3_BUCKET: z.string().trim().min(3).optional(),
  BACKUP_S3_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
})
const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid API environment configuration:', parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`).join('; '))
  process.exit(1)
}
const env = parsed.data
const backupSettings: BackupSettings | null = env.DATABASE_URL && env.BACKUP_S3_ENDPOINT && env.BACKUP_S3_REGION && env.BACKUP_S3_BUCKET && env.BACKUP_S3_ACCESS_KEY_ID && env.BACKUP_S3_SECRET_ACCESS_KEY
  ? { databaseUrl: env.DATABASE_URL, endpoint: env.BACKUP_S3_ENDPOINT, region: env.BACKUP_S3_REGION, bucket: env.BACKUP_S3_BUCKET, accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY }
  : null
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
const emailConfigured = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM)
const monoConfigured = Boolean(env.MONO_PUBLIC_KEY && env.MONO_SECRET_KEY)
const kraEtimsLiveEnabled = env.KRA_ETIMS_ENV === 'production' && env.KRA_ETIMS_LIVE_ENABLED === 'true'
const kraEtimsApiBase = env.KRA_ETIMS_ENV === 'production'
  ? 'https://etims-api.kra.go.ke/etims-api'
  : 'https://etims-api-sbx.kra.go.ke/etims-api'
const mpesaApiBase = env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
let cachedDarajaToken: { value: string; expiresAt: number } | undefined
if (env.NODE_ENV === 'production' && (!env.DATABASE_URL || !env.SESSION_SECRET || !env.PAYROLL_DATA_ENCRYPTION_KEY)) {
  console.error('Production requires DATABASE_URL, SESSION_SECRET, and PAYROLL_DATA_ENCRYPTION_KEY (each secret 32+ characters).')
  process.exit(1)
}
async function createPool() {
  if (env.DATABASE_URL) {
    const ssl = env.NODE_ENV !== 'production'
      ? undefined
      : { rejectUnauthorized: env.DATABASE_SSL_MODE === 'verify-full' }
    return new Pool({ connectionString: env.DATABASE_URL, max: 5, ssl })
  }
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
const defaultWorkspaceSettings = {
  businessName: '',
  currency: 'KES',
  timezone: 'Africa/Nairobi',
  invoiceTerms: 'Net 14',
  emailAlerts: true,
  auditTrail: true,
  twoFactor: false,
  backupSchedule: 'Daily automatic',
  monoEnabled: false,
  darajaEnabled: false,
  kraEtimsLiveEnabled: false,
  statutoryFilingsEnabled: false,
  shifEnabled: false,
  nssfEnabled: false,
  ahlEnabled: false,
} as const
function nairobiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}
const passwordSchema = z.string().min(12).max(200)
const emailSchema = z.string().email().max(254).transform((value) => value.toLowerCase())
const phoneSchema = z.string().trim().min(7).max(30).transform((value) => value.replace(/[\s().-]/g, ''))

type Session = { userId: string; workspaceId: string; expiresAt: number }
type WorkspacePermission = 'operations.write' | 'sales.write' | 'inventory.write' | 'accounting.write' | 'banking.write' | 'payroll.manage' | 'integrations.manage' | 'workspace.manage' | 'team.manage' | 'store.manage'
type AuthedRequest = express.Request & { session?: Session; workspaceRole?: string; workspacePermissions?: WorkspacePermission[] }
const workspacePermissionNames: WorkspacePermission[] = ['operations.write', 'sales.write', 'inventory.write', 'accounting.write', 'banking.write', 'payroll.manage', 'integrations.manage', 'workspace.manage', 'team.manage', 'store.manage']
const rolePermissionDefaults: Record<string, WorkspacePermission[]> = {
  admin: workspacePermissionNames,
  accountant: ['operations.write', 'sales.write', 'inventory.write', 'accounting.write', 'banking.write'],
  staff: ['operations.write', 'sales.write', 'inventory.write'],
  viewer: [],
}

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
function payrollEncryptionKey() {
  if (!env.PAYROLL_DATA_ENCRYPTION_KEY) throw new Error('Set PAYROLL_DATA_ENCRYPTION_KEY before storing employee or payslip records.')
  return createHash('sha256').update(env.PAYROLL_DATA_ENCRYPTION_KEY).digest()
}
function encryptPayrollData(value: unknown) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', payrollEncryptionKey(), nonce)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return `${nonce.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`
}
function decryptPayrollData<T>(encoded: string): T {
  const [nonceText, tagText, dataText] = encoded.split(':')
  if (!nonceText || !tagText || !dataText) throw new Error('Encrypted payroll record has an invalid format.')
  const decipher = createDecipheriv('aes-256-gcm', payrollEncryptionKey(), Buffer.from(nonceText, 'base64'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataText, 'base64')), decipher.final()]).toString('utf8')
  return JSON.parse(plaintext) as T
}
function commerceEncryptionKey() {
  if (!env.ONLINE_COMMERCE_ENCRYPTION_KEY) throw new Error('Set ONLINE_COMMERCE_ENCRYPTION_KEY on the API service before storing WooCommerce credentials.')
  return createHash('sha256').update(env.ONLINE_COMMERCE_ENCRYPTION_KEY).digest()
}
function encryptCommerceSecret(value: string) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', commerceEncryptionKey(), nonce)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${nonce.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`
}
function decryptCommerceSecret(encoded: string) {
  const [nonceText, tagText, dataText] = encoded.split(':')
  if (!nonceText || !tagText || !dataText) throw new Error('Encrypted WooCommerce credential has an invalid format.')
  const decipher = createDecipheriv('aes-256-gcm', commerceEncryptionKey(), Buffer.from(nonceText, 'base64'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64')), decipher.final()]).toString('utf8')
}
async function validatedWooStoreUrl(value: string) {
  const parsedUrl = new URL(value)
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || isIP(parsedUrl.hostname) || parsedUrl.hostname === 'localhost' || !parsedUrl.hostname.includes('.')) {
    throw new Error('WooCommerce store address must be a public HTTPS hostname, without embedded credentials.')
  }
  const addresses = await lookup(parsedUrl.hostname, { all: true, verbatim: true })
  const privateAddress = addresses.find(({ address }) => {
    if (isIP(address) === 4) {
      const [first = -1, second = -1] = address.split('.').map(Number)
      return first === 0 || first === 10 || first === 127 || first >= 224
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
    }
    return address === '::' || address === '::1' || address.toLowerCase().startsWith('fc') || address.toLowerCase().startsWith('fd') || address.toLowerCase().startsWith('fe80:')
  })
  if (!addresses.length || privateAddress) throw new Error('WooCommerce hostname must resolve only to publicly routable addresses.')
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '')
  return parsedUrl.toString().replace(/\/$/, '')
}
function kraCredentialKey() {
  if (!env.KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY) throw new Error('Set KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY on the API service before storing KRA OSCU credentials.')
  return createHash('sha256').update(env.KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY).digest()
}
function encryptKraCredentials(value: unknown) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', kraCredentialKey(), nonce)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return `${nonce.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`
}
function decryptKraCredentials<T>(encoded: string): T {
  const [nonceText, tagText, dataText] = encoded.split(':')
  if (!nonceText || !tagText || !dataText) throw new Error('Encrypted KRA credential record has an invalid format.')
  const decipher = createDecipheriv('aes-256-gcm', kraCredentialKey(), Buffer.from(nonceText, 'base64'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataText, 'base64')), decipher.final()]).toString('utf8')
  return JSON.parse(plaintext) as T
}
const defaultChartOfAccounts = [
  { code: '1000', name: 'Cash and bank', type: 'asset' },
  { code: '1100', name: 'Accounts receivable', type: 'asset' },
  { code: '1200', name: 'Inventory on hand', type: 'asset' },
  { code: '1300', name: 'Recoverable purchase tax', type: 'asset' },
  { code: '2000', name: 'Net salaries payable', type: 'liability' },
  { code: '2100', name: 'PAYE payable', type: 'liability' },
  { code: '2110', name: 'SHIF payable', type: 'liability' },
  { code: '2120', name: 'NSSF payable', type: 'liability' },
  { code: '2130', name: 'Affordable Housing Levy payable', type: 'liability' },
  { code: '2140', name: 'Other employee deductions payable', type: 'liability' },
  { code: '2150', name: 'Sales tax payable', type: 'liability' },
  { code: '2200', name: 'Accounts payable', type: 'liability' },
  { code: '3000', name: 'Retained earnings', type: 'equity' },
  { code: '4000', name: 'Sales income', type: 'income' },
  { code: '5000', name: 'Salaries expense', type: 'expense' },
  { code: '5100', name: 'Cost of goods sold', type: 'expense' },
  { code: '5010', name: 'Employer NSSF expense', type: 'expense' },
  { code: '5020', name: 'Employer Housing Levy expense', type: 'expense' },
  { code: '6000', name: 'Operating expenses', type: 'expense' },
] as const
async function ensureDefaultAccounts(workspaceId: string) {
  for (const account of defaultChartOfAccounts) {
    await pool!.query('INSERT INTO workspace_accounts (id, workspace_id, code, name, account_type) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, code) DO NOTHING', [randomUUID(), workspaceId, account.code, account.name, account.type])
  }
}
type JournalLineInput = { accountCode: string; description?: string; debit: number; credit: number }
async function recordAudit(client: PoolClient, input: { workspaceId: string; actorUserId: string | null; eventType: string; entityType: string; entityId?: string; eventData?: Record<string, unknown> }) {
  await client.query('INSERT INTO audit_events (id, workspace_id, actor_user_id, event_type, entity_type, entity_id, event_data) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)', [randomUUID(), input.workspaceId, input.actorUserId, input.eventType, input.entityType, input.entityId ?? null, JSON.stringify(input.eventData ?? {})])
}
async function insertJournal(client: PoolClient, input: { workspaceId: string; userId: string | null; date: string; description: string; sourceType: string; sourceId?: string; reversalOf?: string; correctionReason?: string; lines: JournalLineInput[] }) {
  const debitCents = input.lines.reduce((sum, line) => sum + Math.round(line.debit * 100), 0)
  const creditCents = input.lines.reduce((sum, line) => sum + Math.round(line.credit * 100), 0)
  if (input.lines.length < 2 || debitCents <= 0 || debitCents !== creditCents) throw new Error('Journal entry must contain at least two lines with equal positive debits and credits.')
  const period = input.date.slice(0, 7)
  await client.query('INSERT INTO accounting_periods (id, workspace_id, period) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, period) DO NOTHING', [randomUUID(), input.workspaceId, period])
  const accountingPeriod = await client.query('SELECT status FROM accounting_periods WHERE workspace_id = $1 AND period = $2 FOR UPDATE', [input.workspaceId, period])
  if (accountingPeriod.rows[0]?.status === 'closed') throw new Error(`Accounting period ${period} is closed.`)
  const accounts = await client.query('SELECT id, code FROM workspace_accounts WHERE workspace_id = $1 AND active = true', [input.workspaceId])
  const ids = new Map(accounts.rows.map((account) => [String(account.code), String(account.id)]))
  const entryId = randomUUID()
  await client.query('INSERT INTO journal_entries (id, workspace_id, entry_date, description, source_type, source_id, posted_by, reversal_of, correction_reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [entryId, input.workspaceId, input.date, input.description, input.sourceType, input.sourceId ?? null, input.userId, input.reversalOf ?? null, input.correctionReason ?? null])
  for (const line of input.lines) {
    const accountId = ids.get(line.accountCode)
    if (!accountId) throw new Error(`Account ${line.accountCode} is not in this business chart of accounts.`)
    await client.query('INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), entryId, accountId, line.description ?? null, line.debit.toFixed(2), line.credit.toFixed(2)])
  }
  await recordAudit(client, { workspaceId: input.workspaceId, actorUserId: input.userId, eventType: 'journal.posted', entityType: 'journal_entry', entityId: entryId, eventData: { sourceType: input.sourceType, sourceId: input.sourceId ?? null, date: input.date, lineCount: input.lines.length, totalDebit: (debitCents / 100).toFixed(2) } })
  return entryId
}
function requirePool(_request: express.Request, response: express.Response, next: express.NextFunction) {
  if (!pool) { response.status(503).json({ error: 'Database is not configured. Set DATABASE_URL.' }); return }
  next()
}
async function requireSession(request: AuthedRequest, response: express.Response, next: express.NextFunction) {
  request.session = readSession(cookies(request.headers.cookie)[cookieName]) ?? undefined
  if (!request.session) { response.status(401).json({ error: 'Authentication is required to access this workspace.' }); return }
  try {
    const membership = await pool!.query('SELECT role, permissions FROM workspace_members WHERE user_id = $1 AND workspace_id = $2', [request.session.userId, request.session.workspaceId])
    if (!membership.rowCount) { response.status(401).json({ error: 'Workspace membership has been revoked or is no longer valid.' }); return }
    request.workspaceRole = String(membership.rows[0].role)
    const overrides = membership.rows[0].permissions
    request.workspacePermissions = request.workspaceRole === 'admin'
      ? rolePermissionDefaults.admin
      : Array.isArray(overrides)
        ? overrides.filter((permission: unknown): permission is WorkspacePermission => workspacePermissionNames.includes(permission as WorkspacePermission))
        : rolePermissionDefaults[request.workspaceRole] ?? (await pool!.query('SELECT permissions FROM custom_workspace_roles WHERE workspace_id = $1 AND role_key = $2', [request.session!.workspaceId, request.workspaceRole])).rows[0]?.permissions ?? []
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const permission = permissionForRequest(request) ?? 'operations.write'
      if (permission && !(request.workspacePermissions ?? []).includes(permission)) {
        response.status(403).json({ error: `Your workspace role does not have the ${permission} permission.` })
        return
      }
    }
    next()
  } catch (error) { next(error) }
}
function permissionForRequest(request: AuthedRequest): WorkspacePermission | null {
  const routePath = String(request.route?.path ?? '')
  if (routePath === '/v1/workspaces/:workspaceId/activate') return null
  if (routePath.includes('/invitations') || routePath.includes('/members') || routePath.includes('/roles')) return 'team.manage'
  if (routePath.startsWith('/v1/payroll') || routePath.startsWith('/v1/integrations/statutory')) return 'payroll.manage'
  if (routePath.startsWith('/v1/integrations')) return 'integrations.manage'
  if (routePath.startsWith('/v1/settings')) return 'workspace.manage'
  if (routePath.startsWith('/v1/banking')) return 'banking.write'
  if (routePath.startsWith('/v1/purchase-orders')) return 'inventory.write'
  if (routePath.startsWith('/v1/accounting') || routePath.startsWith('/v1/bills')) return 'accounting.write'
  if (routePath.startsWith('/v1/inventory')) return 'inventory.write'
  if (routePath.startsWith('/v1/invoices')) {
    if (routePath.includes('/payments/mpesa')) return 'integrations.manage'
    return routePath.endsWith('/payments') || routePath.endsWith('/returns') ? 'accounting.write' : 'sales.write'
  }
  if (routePath.startsWith('/v1/estimates') || routePath.startsWith('/v1/sales-orders')) return 'sales.write'
  if (routePath.startsWith('/v1/records')) return request.params.type === 'inventory' ? 'inventory.write' : 'operations.write'
  if (routePath.startsWith('/v1/documents')) return 'operations.write'
  if (routePath.startsWith('/v1/store')) return routePath.includes('settings') ? 'store.manage' : 'sales.write'
  if (routePath.startsWith('/v1/workspaces')) return 'workspace.manage'
  return null
}
async function requireWorkspaceAdmin(request: AuthedRequest, response: express.Response, next: express.NextFunction) {
  const permission = permissionForRequest(request)
  if (request.workspaceRole !== 'admin' && (!permission || !(request.workspacePermissions ?? []).includes(permission))) {
    response.status(403).json({ error: permission ? `Your workspace role does not have the ${permission} permission.` : 'Workspace administrator access is required for this operation.' })
    return
  }
  next()
}
function requireWorkspaceRole(allowedRoles: Array<'admin' | 'accountant' | 'staff'>) {
  return async (request: AuthedRequest, response: express.Response, next: express.NextFunction) => {
    const role = request.workspaceRole ?? ''
    const required = allowedRoles.includes('accountant') && !allowedRoles.includes('staff') ? 'accounting.write' : 'operations.write'
    if (role !== 'admin' && !request.workspacePermissions?.includes(required)) {
      response.status(403).json({ error: `Your workspace role does not have the ${required} permission.` })
      return
    }
    next()
  }
}
const requireWorkspaceWriter = requireWorkspaceRole(['admin', 'accountant', 'staff'])
const requireAccountingRole = requireWorkspaceRole(['admin', 'accountant'])
function requireWorkspaceProviderPreference(preference: 'monoEnabled' | 'darajaEnabled' | 'kraEtimsLiveEnabled', productionOnly = false) {
  return async (request: AuthedRequest, response: express.Response, next: express.NextFunction) => {
    if (productionOnly && env.KRA_ETIMS_ENV !== 'production') { next(); return }
    try {
      const result = await pool!.query('SELECT preferences FROM workspace_settings WHERE workspace_id = $1', [request.session!.workspaceId])
      const preferences = result.rows[0]?.preferences ?? {}
      if (preferences[preference] !== true) {
        response.status(403).json({ error: `This business has not enabled ${preference === 'monoEnabled' ? 'Mono bank feeds' : preference === 'darajaEnabled' ? 'Daraja / M-Pesa' : 'live KRA eTIMS'} in its workspace settings.` })
        return
      }
      next()
    } catch (error) { next(error) }
  }
}
function requirePayrollEncryption(_request: express.Request, response: express.Response, next: express.NextFunction) {
  if (!env.PAYROLL_DATA_ENCRYPTION_KEY) { response.status(503).json({ error: 'Encrypted payroll storage is unavailable until PAYROLL_DATA_ENCRYPTION_KEY is configured.' }); return }
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
app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin) ? origin : false), credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }))
app.use(express.json({ limit: '8mb', type: 'application/json' }))
app.use(rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (request) => request.path.startsWith('/v1/auth/') || request.path === '/v1/integrations/mpesa/callback',
  handler: (_request, response) => response.status(429).json({ error: 'This service received too many requests from this network. Please wait a minute and try again.' }),
}))
app.use((request, response, next) => {
  if (env.BACKUP_RESTORE_MAINTENANCE_MODE !== 'true') { next(); return }
  if (request.path.startsWith('/v1/platform/backups') || request.path === '/health' || request.path === '/ready') { next(); return }
  response.status(503).json({ error: 'This API instance is in database restore maintenance mode.' })
})

app.get('/healthz', async (_request, response) => {
  if (!pool) { response.status(503).json({ status: 'degraded', database: 'not_configured' }); return }
  try { await pool.query('SELECT 1'); response.json({ status: 'ok', database: 'available' }) }
  catch { response.status(503).json({ status: 'degraded', database: 'unavailable' }) }
})

function requireBackupOperator(request: express.Request, response: express.Response, next: express.NextFunction) {
  const provided = request.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const expected = env.BACKUP_OPERATOR_TOKEN ?? ''
  const matches = provided.length === expected.length && expected.length > 0 && timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  if (!matches) { response.status(403).json({ error: 'Valid platform backup operator authorization is required.' }); return }
  if (!backupSettings) { response.status(503).json({ error: 'S3 backup storage and DATABASE_URL must be configured on the API service.' }); return }
  next()
}
async function withBackupLock<T>(operation: () => Promise<T>) {
  if (!pool) throw new Error('Database is not configured.')
  const client = await pool.connect()
  try {
    const result = await client.query('SELECT pg_try_advisory_lock(74010062026) AS acquired')
    if (!result.rows[0]?.acquired) throw new Error('Another API instance is currently backing up or restoring the database.')
    try { return await operation() }
    finally { await client.query('SELECT pg_advisory_unlock(74010062026)') }
  } finally { client.release() }
}

const backupOperatorLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false })
app.get('/v1/platform/backups', backupOperatorLimit, requireBackupOperator, async (_request, response, next) => {
  try {
    const backups = await listDatabaseBackups(backupSettings!)
    response.json({ enabled: true, cadence: 'hourly', retainedSlots: 24, backups, backupInProgress: isBackupInProgress(), restoreScope: 'entire PostgreSQL database; coordinate downtime with the platform operator' })
  } catch (error) { next(error) }
})
app.post('/v1/platform/backups', backupOperatorLimit, requireBackupOperator, async (_request, response, next) => {
  try {
    const backup = await withBackupLock(() => createDatabaseBackup(backupSettings!))
    response.status(201).json({ backup, note: 'Full PostgreSQL custom-format backup uploaded to S3-compatible storage with server-side AES256 encryption.' })
  } catch (error) { next(error) }
})
app.post('/v1/platform/backups/restore', backupOperatorLimit, requireBackupOperator, async (request, response, next) => {
  if (env.BACKUP_RESTORE_MAINTENANCE_MODE !== 'true') {
    response.status(503).json({ error: 'Restore is disabled. Start a single API instance in BACKUP_RESTORE_MAINTENANCE_MODE=true after stopping all other API instances and workers.' })
    return
  }
  const input = z.object({ key: z.string().min(1).max(240), confirmation: z.literal('RESTORE THE ENTIRE DATABASE') }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Supply a retained backup key and the exact confirmation RESTORE THE ENTIRE DATABASE.' }); return }
  if (!/^database-backups\/hourly-(?:0[0-9]|1[0-9]|2[0-3])\.dump$/.test(input.data.key)) { response.status(400).json({ error: 'Choose a valid hourly backup object.' }); return }
  try {
    const result = await withBackupLock(async () => {
      const safetyKey = 'database-safety/pre-restore.dump'
      const safetyBackup = await createDatabaseBackup(backupSettings!, new Date(), safetyKey)
      await restoreDatabaseBackup(backupSettings!, input.data.key)
      return { restoredKey: input.data.key, safetyBackupKey: safetyBackup.key }
    })
    response.json({ ...result, note: 'The selected full logical dump was restored for objects in the archive. Restart the normal deployment, apply migrations, and verify all business data before resuming traffic.' })
  } catch (error) { next(error) }
})

app.get('/v1/auth/status', requirePool, async (_request, response, next) => {
  try {
    const result = await pool!.query('SELECT count(*)::int AS count FROM users')
    response.json({ bootstrapAvailable: result.rows[0].count === 0 })
  } catch (error) { next(error) }
})

app.post('/v1/auth/bootstrap', requirePool, verifyOrigin, rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many account-creation attempts from this network. Please wait 15 minutes and try again.' } }), async (request, response, next) => {
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
    if (existing.rowCount) { await client.query('ROLLBACK'); response.status(409).json({ error: 'An account already uses that email or phone. Sign in instead, or use a different identifier to register another business.' }); return }

    const workspaceId = randomUUID()
    const userId = randomUUID()
    const workspace = await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2) RETURNING id', [workspaceId, input.data.businessName])
    const user = await client.query('INSERT INTO users (id, workspace_id, email, phone, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id, workspace_id, email, phone', [userId, workspace.rows[0].id, email, phone, await hashPassword(input.data.password)])
    await client.query('INSERT INTO workspace_members (user_id, workspace_id, role) VALUES ($1, $2, $3)', [user.rows[0].id, workspace.rows[0].id, 'admin'])
    for (const account of defaultChartOfAccounts) {
      await client.query('INSERT INTO workspace_accounts (id, workspace_id, code, name, account_type) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), workspace.rows[0].id, account.code, account.name, account.type])
    }
    await client.query('COMMIT')
    const row = user.rows[0]
    setSessionCookie(response, { userId: row.id, workspaceId: row.workspace_id, expiresAt: Date.now() + sessionTtlSeconds * 1000 })
    response.status(201).json({ user: { email: row.email ?? row.phone }, workspace: { id: row.workspace_id, name: input.data.businessName }, workspaces: [{ id: row.workspace_id, name: input.data.businessName, role: 'admin' }] })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})

app.post('/v1/auth/login', requirePool, verifyOrigin, rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts from this network. Please wait 15 minutes and try again.' } }), async (request, response, next) => {
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
  const today = nairobiToday()
  const defaultFrom = `${today.slice(0, 7)}-01`
  const query = z.object({ from: z.string().date().default(defaultFrom), to: z.string().date().default(today) }).safeParse(request.query)
  if (!query.success || query.data.from > query.data.to) { response.status(400).json({ error: 'Choose a valid date range with a start date on or before the end date.' }); return }
  try {
    const workspaceId = request.session!.workspaceId
    const monthStart = `${today.slice(0, 7)}-01`
    const [workspace, totals, transactions, cashflow, invoices] = await Promise.all([
      pool!.query('SELECT name FROM workspaces WHERE id = $1', [workspaceId]),
      pool!.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'income' AND transaction_date >= $2 AND transaction_date <= $3), 0)::text AS income,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'expense' AND transaction_date >= $2 AND transaction_date <= $3), 0)::text AS expenses,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'income' AND transaction_date >= $4 AND transaction_date <= $5), 0)::text AS month_income,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'expense' AND transaction_date >= $4 AND transaction_date <= $5), 0)::text AS month_expenses
        FROM ledger_transactions WHERE workspace_id = $1`,
      [workspaceId, query.data.from, query.data.to, monthStart, today]),
      pool!.query('SELECT id, description, amount::text, direction, account, transaction_date, created_at FROM ledger_transactions WHERE workspace_id = $1 ORDER BY transaction_date DESC, created_at DESC LIMIT 20', [workspaceId]),
      pool!.query(`SELECT transaction_date AS date, COALESCE(SUM(amount) FILTER (WHERE direction = 'income'), 0)::text AS income,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'expense'), 0)::text AS expense
        FROM ledger_transactions WHERE workspace_id = $1 AND transaction_date >= $2 GROUP BY transaction_date ORDER BY transaction_date`,
      [workspaceId, monthStart]),
      pool!.query("SELECT count(*)::int AS count, COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid'), 0)::text AS unpaid_amount FROM invoices WHERE workspace_id = $1", [workspaceId]),
    ])
    const asDateString = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
    response.json({ workspaceName: workspace.rows[0]?.name ?? '', period: query.data, totals: { income: totals.rows[0].income, expenses: totals.rows[0].expenses, net: (Number(totals.rows[0].income) - Number(totals.rows[0].expenses)).toFixed(2), monthIncome: totals.rows[0].month_income, monthExpenses: totals.rows[0].month_expenses }, transactions: transactions.rows.map((row: Record<string, unknown>) => ({ ...row, transaction_date: asDateString(row.transaction_date) })), cashflow: cashflow.rows.map((row: Record<string, unknown>) => ({ ...row, date: asDateString(row.date) })), invoices: invoices.rows[0] })
  } catch (error) { next(error) }
})

const workspaceRecordTypes = ['customers', 'suppliers', 'inventory', 'projects'] as const
const workspaceRecordSchemas = {
  customers: z.object({ name: z.string().trim().min(1).max(160), email: z.string().trim().email().max(254).or(z.literal('')).default(''), phone: z.string().trim().max(30).default(''), address: z.string().trim().max(500).default(''), taxPin: z.string().trim().max(30).default(''), notes: z.string().trim().max(2000).default('') }),
  suppliers: z.object({ name: z.string().trim().min(1).max(160), email: z.string().trim().email().max(254).or(z.literal('')).default(''), phone: z.string().trim().max(30).default(''), address: z.string().trim().max(500).default(''), taxPin: z.string().trim().max(30).default(''), notes: z.string().trim().max(2000).default(''), supplyItemIds: z.array(z.string().uuid()).max(100).default([]) }),
  inventory: z.object({ name: z.string().trim().min(1).max(160), sku: z.string().trim().max(80).default(''), barcode: z.string().trim().max(80).default(''), reorderPoint: z.coerce.number().finite().min(0).default(0), quantity: z.coerce.number().finite().min(0).default(0), unit: z.string().trim().max(30).default('unit'), cost: z.coerce.number().finite().min(0).default(0), price: z.coerce.number().finite().min(0).default(0), notes: z.string().trim().max(2000).default('') }),
  projects: z.object({ name: z.string().trim().min(1).max(160), customer: z.string().trim().max(160).default(''), status: z.enum(['planned', 'active', 'on_hold', 'completed']).default('planned'), startDate: z.string().date().or(z.literal('')).default(''), endDate: z.string().date().or(z.literal('')).default(''), budget: z.coerce.number().finite().min(0).default(0), notes: z.string().trim().max(2000).default('') }),
}
type WorkspaceRecordType = typeof workspaceRecordTypes[number]
const workspaceRecordDatabaseTypes: Record<WorkspaceRecordType, string> = {
  customers: 'customer',
  suppliers: 'supplier',
  inventory: 'inventory',
  projects: 'project',
}
function parseRecordType(value: string): WorkspaceRecordType | null {
  return workspaceRecordTypes.find((type) => type === value) ?? null
}
async function validateSupplierItemLinks(client: PoolClient, workspaceId: string, itemIds: string[]) {
  const uniqueIds = new Set(itemIds)
  if (uniqueIds.size !== itemIds.length) return 'Choose each inventory item only once.'
  for (const itemId of uniqueIds) {
    const item = await client.query("SELECT 1 FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'inventory'", [itemId, workspaceId])
    if (!item.rowCount) return 'Every supplier item must be an inventory record in this business.'
  }
  return null
}
async function ensureDefaultInventoryLocation(client: PoolClient, workspaceId: string) {
  const existing = await client.query('SELECT id FROM inventory_locations WHERE workspace_id = $1 AND is_default = true', [workspaceId])
  let locationId = existing.rows[0]?.id as string | undefined
  if (!locationId) {
    locationId = randomUUID()
    await client.query(`INSERT INTO inventory_locations (id, workspace_id, name, code, is_default)
      VALUES ($1, $2, 'Main location', 'MAIN', true) ON CONFLICT (workspace_id, code) DO UPDATE SET is_default = true RETURNING id`, [locationId, workspaceId])
    const ensured = await client.query('SELECT id FROM inventory_locations WHERE workspace_id = $1 AND code = $2', [workspaceId, 'MAIN'])
    locationId = String(ensured.rows[0].id)
  }
  const items = await client.query("SELECT id, data FROM workspace_records WHERE workspace_id = $1 AND record_type = 'inventory'", [workspaceId])
  for (const item of items.rows) {
    const data = item.data as Record<string, unknown>
    await client.query(`INSERT INTO inventory_location_stock (workspace_id, location_id, item_id, quantity)
      VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, location_id, item_id) DO NOTHING`,
    [workspaceId, locationId, item.id, Number(data.quantity ?? 0).toFixed(3)])
  }
  return locationId
}
async function ensureInventoryLocation(client: PoolClient, workspaceId: string, locationId: string | undefined) {
  const defaultLocationId = await ensureDefaultInventoryLocation(client, workspaceId)
  if (!locationId) return defaultLocationId
  const location = await client.query('SELECT id, workspace_id, active FROM inventory_locations WHERE id = $1', [locationId])
  const row = location.rows[0]
  return row && String(row.workspace_id) === workspaceId && row.active === true ? String(row.id) : null
}
app.get('/v1/records/:type', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  const type = parseRecordType(String(request.params.type ?? ''))
  if (!type) { response.status(404).json({ error: 'Unknown record type.' }); return }
  try {
    const result = await pool!.query('SELECT id, data, created_at, updated_at FROM workspace_records WHERE workspace_id = $1 AND record_type = $2 ORDER BY updated_at DESC', [request.session!.workspaceId, workspaceRecordDatabaseTypes[type]])
    response.json({ records: result.rows })
  } catch (error) { next(error) }
})
app.get('/v1/inventory/locations', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  const client = await pool!.connect()
  try {
    const defaultLocationId = await ensureDefaultInventoryLocation(client, request.session!.workspaceId)
    const [defaultLocation, additionalLocations] = await Promise.all([
      client.query('SELECT id, name, code, is_default, active FROM inventory_locations WHERE id = $1', [defaultLocationId]),
      client.query('SELECT id, name, code, is_default, active FROM inventory_locations WHERE workspace_id = $1 AND is_default = false', [request.session!.workspaceId]),
    ])
    const locations = [...defaultLocation.rows, ...additionalLocations.rows]
    locations.sort((left: Record<string, unknown>, right: Record<string, unknown>) => Number(right.is_default === true) - Number(left.is_default === true) || String(left.name).localeCompare(String(right.name)))
    response.json({ locations, defaultLocationId })
  } catch (error) { next(error) }
  finally { client.release() }
})
app.post('/v1/inventory/locations', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ name: z.string().trim().min(1).max(120), code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a location name and a short code using letters, numbers, dashes, or underscores.' }); return }
  try {
    const result = await pool!.query('INSERT INTO inventory_locations (id, workspace_id, name, code) VALUES ($1, $2, $3, $4) RETURNING id, name, code, is_default, active', [randomUUID(), request.session!.workspaceId, input.data.name, input.data.code.toUpperCase()])
    response.status(201).json({ location: result.rows[0] })
  } catch (error) { next(error) }
})
app.get('/v1/inventory/location-stock', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  const client = await pool!.connect()
  try {
    await ensureDefaultInventoryLocation(client, request.session!.workspaceId)
    const result = await client.query(`SELECT s.location_id, s.item_id, s.quantity::text, l.name AS location_name
      FROM inventory_location_stock s JOIN inventory_locations l ON l.id = s.location_id
      WHERE s.workspace_id = $1 AND l.active = true ORDER BY l.name, s.item_id`, [request.session!.workspaceId])
    response.json({ stock: result.rows })
  } catch (error) { next(error) }
  finally { client.release() }
})
app.post('/v1/inventory/transfers', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const input = z.object({ itemId: z.string().uuid(), fromLocationId: z.string().uuid(), toLocationId: z.string().uuid(), quantity: z.coerce.number().finite().positive().max(1_000_000), date: z.string().date(), reference: z.string().trim().max(200).default('') }).safeParse(request.body)
  if (!input.success || input.data.fromLocationId === input.data.toLocationId) { response.status(400).json({ error: 'Choose an item, two different active locations, a positive quantity, and a valid date.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const item = await client.query("SELECT data FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'inventory' FOR UPDATE", [input.data.itemId, request.session!.workspaceId])
    if (!item.rowCount) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Inventory item not found.' }); return }
    const sourceLocation = await client.query('SELECT id FROM inventory_locations WHERE workspace_id = $1 AND active = true AND id = $2 FOR UPDATE', [request.session!.workspaceId, input.data.fromLocationId])
    const destinationLocation = await client.query('SELECT id FROM inventory_locations WHERE workspace_id = $1 AND active = true AND id = $2 FOR UPDATE', [request.session!.workspaceId, input.data.toLocationId])
    if (!sourceLocation.rowCount || !destinationLocation.rowCount) { await client.query('ROLLBACK'); response.status(400).json({ error: 'Both locations must be active in this business.' }); return }
    const source = await client.query('SELECT quantity::text FROM inventory_location_stock WHERE workspace_id = $1 AND location_id = $2 AND item_id = $3 FOR UPDATE', [request.session!.workspaceId, input.data.fromLocationId, input.data.itemId])
    const available = Number(source.rows[0]?.quantity ?? 0)
    if (input.data.quantity > available) { await client.query('ROLLBACK'); response.status(409).json({ error: `Only ${available} units are available at the source location.` }); return }
    const itemData = item.rows[0].data as Record<string, unknown>
    await client.query('UPDATE inventory_location_stock SET quantity = quantity - $1, updated_at = now() WHERE workspace_id = $2 AND location_id = $3 AND item_id = $4', [input.data.quantity.toFixed(3), request.session!.workspaceId, input.data.fromLocationId, input.data.itemId])
    await client.query(`INSERT INTO inventory_location_stock (workspace_id, location_id, item_id, quantity)
      VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, location_id, item_id)
      DO UPDATE SET quantity = inventory_location_stock.quantity + EXCLUDED.quantity, updated_at = now()`,
    [request.session!.workspaceId, input.data.toLocationId, input.data.itemId, input.data.quantity.toFixed(3)])
    const movementLabel = input.data.reference || 'Location transfer'
    for (const [locationId, direction, delta] of [[input.data.fromLocationId, 'outbound', -input.data.quantity], [input.data.toLocationId, 'inbound', input.data.quantity]] as const) {
      await client.query(`INSERT INTO inventory_movements (id, workspace_id, item_id, location_id, movement_type, quantity_delta, unit_cost, reference, moved_at, created_by)
        VALUES ($1, $2, $3, $4, 'adjustment', $5, $6, $7, $8, $9)`,
      [randomUUID(), request.session!.workspaceId, input.data.itemId, locationId, delta.toFixed(3), Number(itemData.cost ?? 0).toFixed(2), `${movementLabel} (${direction})`, input.data.date, request.session!.userId])
    }
    await client.query('COMMIT')
    response.status(201).json({ transferred: input.data.quantity })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})
app.post('/v1/inventory/counts', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const input = z.object({ itemId: z.string().uuid(), locationId: z.string().uuid(), countedQuantity: z.coerce.number().finite().min(0).max(1_000_000), date: z.string().date(), reference: z.string().trim().max(200).default('') }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter an item, location, non-negative count, and valid date.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const item = await client.query("SELECT data FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'inventory' FOR UPDATE", [input.data.itemId, request.session!.workspaceId])
    if (!item.rowCount) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Inventory item not found.' }); return }
    const locationId = await ensureInventoryLocation(client, request.session!.workspaceId, input.data.locationId)
    if (!locationId) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Active stock location not found.' }); return }
    const row = await client.query('SELECT quantity::text FROM inventory_location_stock WHERE workspace_id = $1 AND location_id = $2 AND item_id = $3 FOR UPDATE', [request.session!.workspaceId, locationId, input.data.itemId])
    const previous = Number(row.rows[0]?.quantity ?? 0)
    const delta = Number((input.data.countedQuantity - previous).toFixed(3))
    if (delta === 0) { await client.query('ROLLBACK'); response.status(409).json({ error: 'The counted quantity matches the saved quantity; no adjustment was posted.' }); return }
    const itemData = item.rows[0].data as Record<string, unknown>
    const aggregateQuantity = Number((Number(itemData.quantity ?? 0) + delta).toFixed(3))
    if (aggregateQuantity < 0) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Count adjustment cannot reduce total business stock below zero.' }); return }
    await client.query(`INSERT INTO inventory_location_stock (workspace_id, location_id, item_id, quantity)
      VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, location_id, item_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
    [request.session!.workspaceId, locationId, input.data.itemId, input.data.countedQuantity.toFixed(3)])
    await client.query('UPDATE workspace_records SET data = $1::jsonb, updated_at = now() WHERE id = $2 AND workspace_id = $3', [JSON.stringify({ ...itemData, quantity: aggregateQuantity }), input.data.itemId, request.session!.workspaceId])
    const unitCost = Number(itemData.cost ?? 0)
    const movementId = randomUUID()
    await client.query(`INSERT INTO inventory_movements (id, workspace_id, item_id, location_id, movement_type, quantity_delta, unit_cost, reference, moved_at, created_by)
      VALUES ($1, $2, $3, $4, 'adjustment', $5, $6, $7, $8, $9)`,
    [movementId, request.session!.workspaceId, input.data.itemId, locationId, delta.toFixed(3), unitCost.toFixed(2), input.data.reference || 'Stock count adjustment', input.data.date, request.session!.userId])
    const value = Number((Math.abs(delta) * unitCost).toFixed(2))
    if (value > 0) await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: input.data.date, description: `Stock count: ${String(itemData.name ?? 'item')}`, sourceType: 'inventory_count', sourceId: movementId, lines: delta > 0 ? [{ accountCode: '1200', debit: value, credit: 0 }, { accountCode: '5100', debit: 0, credit: value }] : [{ accountCode: '5100', debit: value, credit: 0 }, { accountCode: '1200', debit: 0, credit: value }] })
    await client.query('COMMIT')
    response.status(201).json({ delta, quantity: input.data.countedQuantity })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})
app.post('/v1/imports/records/:type', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const type = parseRecordType(String(request.params.type ?? ''))
  if (!type) { response.status(404).json({ error: 'Choose customers, suppliers, inventory, or projects.' }); return }
  const input = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500), commit: z.boolean().default(false) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide between 1 and 500 CSV rows.' }); return }
  const parsedRows: Array<{ index: number; data: Record<string, unknown> }> = []
  for (const [index, row] of input.data.rows.entries()) {
    const parsed = workspaceRecordSchemas[type].safeParse(row)
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message ?? 'Invalid values.'
      response.status(400).json({ error: `CSV row ${index + 2}: ${detail}` })
      return
    }
    parsedRows.push({ index: index + 2, data: parsed.data as Record<string, unknown> })
  }
  const workspaceId = request.session!.workspaceId
  const recordType = workspaceRecordDatabaseTypes[type]
  const client = await pool!.connect()
  try {
    if (input.data.commit) await client.query('BEGIN')
    const lockValue = createHash('sha256').update(`${workspaceId}:${recordType}:import`).digest().readBigInt64BE(0).toString()
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockValue])
    const existing = await client.query('SELECT data FROM workspace_records WHERE workspace_id = $1 AND record_type = $2', [workspaceId, recordType])
    const names = new Set(existing.rows.map((row: { data: Record<string, unknown> }) => String(row.data.name ?? '').trim().toLocaleLowerCase()))
    const duplicateRows: number[] = []
    const eligible: Array<{ index: number; data: Record<string, unknown> }> = []
    for (const row of parsedRows) {
      const key = String(row.data.name ?? '').trim().toLocaleLowerCase()
      if (names.has(key)) duplicateRows.push(row.index)
      else { names.add(key); eligible.push(row) }
    }
    if (!input.data.commit) {
      response.json({ preview: { type, totalRows: parsedRows.length, wouldImport: eligible.length, duplicateRows } })
      return
    }
    let imported = 0
    for (const row of eligible) {
      if (type === 'suppliers') {
        const invalidLinks = await validateSupplierItemLinks(client, workspaceId, row.data.supplyItemIds as string[])
        if (invalidLinks) { await client.query('ROLLBACK'); response.status(400).json({ error: `CSV row ${row.index}: ${invalidLinks}` }); return }
      }
      const id = randomUUID()
      await client.query('INSERT INTO workspace_records (id, workspace_id, record_type, data) VALUES ($1, $2, $3, $4::jsonb)', [id, workspaceId, recordType, JSON.stringify(row.data)])
      if (type === 'inventory') {
        const quantity = Number(row.data.quantity ?? 0)
        const cost = Number(row.data.cost ?? 0)
        if (quantity > 0) {
          const locationId = await ensureDefaultInventoryLocation(client, workspaceId)
          const movementId = randomUUID()
          const value = Number((quantity * cost).toFixed(2))
          await client.query("INSERT INTO inventory_movements (id, workspace_id, item_id, location_id, movement_type, quantity_delta, unit_cost, reference, moved_at, created_by) VALUES ($1, $2, $3, $4, 'opening', $5, $6, 'Opening stock import', $7, $8)", [movementId, workspaceId, id, locationId, quantity.toFixed(3), cost.toFixed(2), nairobiToday(), request.session!.userId])
          if (value > 0) {
            await ensureDefaultAccounts(workspaceId)
            await insertJournal(client, { workspaceId, userId: request.session!.userId, date: nairobiToday(), description: `Opening inventory import: ${String(row.data.name)}`, sourceType: 'inventory_opening_import', sourceId: movementId, lines: [{ accountCode: '1200', debit: value, credit: 0 }, { accountCode: '3000', debit: 0, credit: value }] })
          }
        }
      }
      imported += 1
    }
    await recordAudit(client, { workspaceId, actorUserId: request.session!.userId, eventType: 'records.csv_imported', entityType: recordType, eventData: { imported, duplicatesSkipped: duplicateRows.length } })
    if (input.data.commit) await client.query('COMMIT')
    response.status(201).json({ imported, duplicateRows, message: `${imported} record${imported === 1 ? '' : 's'} imported; ${duplicateRows.length} duplicate row${duplicateRows.length === 1 ? '' : 's'} skipped.` })
  } catch (error) {
    if (input.data.commit) await client.query('ROLLBACK')
    next(error)
  } finally { client.release() }
})
app.post('/v1/records/:type', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const type = parseRecordType(String(request.params.type ?? ''))
  if (!type) { response.status(404).json({ error: 'Unknown record type.' }); return }
  const input = workspaceRecordSchemas[type].safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Check the required name and field values.' }); return }
  const inventoryInput = type === 'inventory' ? workspaceRecordSchemas.inventory.parse(request.body) : null
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    if (type === 'suppliers') {
      const invalidLinks = await validateSupplierItemLinks(client, request.session!.workspaceId, (input.data as z.infer<typeof workspaceRecordSchemas.suppliers>).supplyItemIds)
      if (invalidLinks) { await client.query('ROLLBACK'); response.status(400).json({ error: invalidLinks }); return }
    }
    const result = await client.query('INSERT INTO workspace_records (id, workspace_id, record_type, data) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, data, created_at, updated_at', [randomUUID(), request.session!.workspaceId, workspaceRecordDatabaseTypes[type], JSON.stringify(input.data)])
    if (inventoryInput && inventoryInput.quantity > 0 && inventoryInput.cost > 0) {
      const movementId = randomUUID()
      const value = Number((inventoryInput.quantity * inventoryInput.cost).toFixed(2))
      const locationId = await ensureDefaultInventoryLocation(client, request.session!.workspaceId)
      await client.query('INSERT INTO inventory_location_stock (workspace_id, location_id, item_id, quantity) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, location_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()', [request.session!.workspaceId, locationId, result.rows[0].id, inventoryInput.quantity.toFixed(3)])
      await client.query("INSERT INTO inventory_movements (id, workspace_id, item_id, location_id, movement_type, quantity_delta, unit_cost, reference, moved_at, created_by) VALUES ($1, $2, $3, $4, 'opening', $5, $6, 'Opening stock', $7, $8)", [movementId, request.session!.workspaceId, result.rows[0].id, locationId, inventoryInput.quantity.toFixed(3), inventoryInput.cost.toFixed(2), nairobiToday(), request.session!.userId])
      await ensureDefaultAccounts(request.session!.workspaceId)
      await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: nairobiToday(), description: `Opening inventory: ${input.data.name}`, sourceType: 'inventory_opening', sourceId: movementId, lines: [{ accountCode: '1200', debit: value, credit: 0 }, { accountCode: '3000', debit: 0, credit: value }] })
    }
    await client.query('COMMIT')
    response.status(201).json({ record: result.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})
app.get('/v1/public/stores/:slug', requirePool, rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }), async (request, response, next) => {
  try {
    const result = await pool!.query(`SELECT s.workspace_id, s.slug, s.title, s.description, w.name AS business_name
      FROM online_stores s JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.slug = $1 AND s.enabled = true`, [request.params.slug])
    const store = result.rows[0]
    if (!store) { response.status(404).json({ error: 'This online store is not available.' }); return }
    const records = await pool!.query("SELECT id, data FROM workspace_records WHERE workspace_id = $1 AND record_type = 'inventory'", [store.workspace_id])
    const products = records.rows.map((row: { id: unknown; data: Record<string, unknown> }) => ({
      id: String(row.id),
      name: String(row.data.name ?? 'Product'),
      sku: String(row.data.sku ?? ''),
      price: Number(row.data.price ?? 0),
      inStock: Number(row.data.quantity ?? 0) > 0,
    })).filter((item: { price: number }) => Number.isFinite(item.price) && item.price > 0)
    response.json({ store: { slug: store.slug, title: store.title, description: store.description, businessName: store.business_name }, products })
  } catch (error) { next(error) }
})
app.post('/v1/public/stores/:slug/orders', requirePool, verifyOrigin, rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false }), async (request, response, next) => {
  const input = z.object({
    customerName: z.string().trim().min(1).max(160),
    customerEmail: z.string().trim().email().max(254),
    customerPhone: z.string().trim().max(30).default(''),
    lines: z.array(z.object({ itemId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(1000) })).min(1).max(50),
  }).safeParse(request.body)
  if (!input.success || new Set(input.data.lines.map((line) => line.itemId)).size !== input.data.lines.length) {
    response.status(400).json({ error: 'Enter your contact details and one quantity per selected product.' }); return
  }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const storeResult = await client.query('SELECT workspace_id, slug FROM online_stores WHERE slug = $1 AND enabled = true FOR SHARE', [request.params.slug])
    const store = storeResult.rows[0]
    if (!store) { await client.query('ROLLBACK'); response.status(404).json({ error: 'This online store is not available.' }); return }
    const lines: Array<{ itemId: string; name: string; sku: string; quantity: number; priceCents: number; totalCents: number }> = []
    for (const requestedLine of input.data.lines) {
      const itemResult = await client.query("SELECT data FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'inventory' FOR UPDATE", [requestedLine.itemId, store.workspace_id])
      const data = itemResult.rows[0]?.data as Record<string, unknown> | undefined
      if (!data || Number(data.quantity ?? 0) < requestedLine.quantity) {
        await client.query('ROLLBACK'); response.status(409).json({ error: `${String(data?.name ?? 'A selected product')} is no longer available in that quantity.` }); return
      }
      const priceCents = Math.round(Number(data.price ?? 0) * 100)
      if (priceCents <= 0) { await client.query('ROLLBACK'); response.status(409).json({ error: `${String(data.name ?? 'A selected product')} is not currently for sale online.` }); return }
      lines.push({ itemId: requestedLine.itemId, name: String(data.name ?? 'Product'), sku: String(data.sku ?? ''), quantity: requestedLine.quantity, priceCents, totalCents: priceCents * requestedLine.quantity })
    }
    const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0)
    const orderId = randomUUID()
    const portalToken = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(portalToken).digest('hex')
    await client.query(`INSERT INTO online_store_orders (id, workspace_id, customer_name, customer_email, customer_phone, portal_token_hash, total)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [orderId, store.workspace_id, input.data.customerName, input.data.customerEmail, input.data.customerPhone, tokenHash, (totalCents / 100).toFixed(2)])
    for (const line of lines) {
      await client.query(`INSERT INTO online_store_order_lines (id, order_id, item_id, product_name, sku, quantity, unit_price, total)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), orderId, line.itemId, line.name, line.sku, line.quantity.toFixed(3), (line.priceCents / 100).toFixed(2), (line.totalCents / 100).toFixed(2)])
    }
    await client.query('COMMIT')
    const portalUrl = new URL(`/portal/${portalToken}`, env.FRONTEND_ORIGIN).toString()
    response.status(201).json({ order: { id: orderId, status: 'pending_review', total: (totalCents / 100).toFixed(2), portalUrl }, message: 'Order request received. The store will confirm availability and payment arrangements.' })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})
app.get('/v1/public/orders/:token', requirePool, rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }), async (request, response, next) => {
  const tokenParam = request.params.token
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) { response.status(404).json({ error: 'Order tracking link is invalid.' }); return }
  try {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const result = await pool!.query(`SELECT id, status, total::text, created_at FROM online_store_orders WHERE portal_token_hash = $1`, [tokenHash])
    const order = result.rows[0]
    if (!order) { response.status(404).json({ error: 'Order tracking link is invalid.' }); return }
    const lines = await pool!.query('SELECT product_name, sku, quantity::text, unit_price::text, total::text FROM online_store_order_lines WHERE order_id = $1', [order.id])
    response.json({ order, lines: lines.rows })
  } catch (error) { next(error) }
})
app.get('/v1/store/settings', requirePool, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT slug, title, description, enabled FROM online_stores WHERE workspace_id = $1', [request.session!.workspaceId])
    response.json({ store: result.rows[0] ?? null })
  } catch (error) { next(error) }
})
app.put('/v1/store/settings', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ slug: z.string().trim().min(3).max(50).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), title: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).default(''), enabled: z.boolean() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Use a 3–50 character lowercase store address, title, description, and enabled setting.' }); return }
  try {
    const result = await pool!.query(`INSERT INTO online_stores (workspace_id, slug, title, description, enabled)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (workspace_id) DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, description = EXCLUDED.description, enabled = EXCLUDED.enabled, updated_at = now()
      RETURNING slug, title, description, enabled`,
    [request.session!.workspaceId, input.data.slug, input.data.title, input.data.description, input.data.enabled])
    response.json({ store: result.rows[0] })
  } catch (error) { next(error) }
})
app.get('/v1/store/orders', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const orders = await pool!.query(`SELECT id, status, source, external_order_id, customer_name, customer_email, customer_phone, total::text, invoice_id, created_at
      FROM online_store_orders WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 200`, [request.session!.workspaceId])
    response.json({ orders: orders.rows })
  } catch (error) { next(error) }
})
app.get('/v1/store/orders/:orderId/lines', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const order = await pool!.query('SELECT id FROM online_store_orders WHERE id = $1 AND workspace_id = $2', [request.params.orderId, request.session!.workspaceId])
    if (!order.rowCount) { response.status(404).json({ error: 'Store order not found.' }); return }
    const lines = await pool!.query('SELECT item_id, product_name, sku, quantity::text, unit_price::text, total::text FROM online_store_order_lines WHERE order_id = $1', [request.params.orderId])
    response.json({ lines: lines.rows })
  } catch (error) { next(error) }
})
app.patch('/v1/store/orders/:orderId/status', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const input = z.object({ status: z.enum(['accepted', 'rejected', 'fulfilled']) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Choose accepted, rejected, or fulfilled.' }); return }
  try {
    const result = input.data.status === 'fulfilled'
      ? await pool!.query(`UPDATE online_store_orders SET status = 'fulfilled', updated_at = now()
        WHERE id = $1 AND workspace_id = $2 AND status = 'invoiced' AND invoice_id IS NOT NULL RETURNING id, status`,
      [request.params.orderId, request.session!.workspaceId])
      : await pool!.query(`UPDATE online_store_orders SET status = $1, updated_at = now()
        WHERE id = $2 AND workspace_id = $3 AND status = 'pending_review' RETURNING id, status`,
      [input.data.status, request.params.orderId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(409).json({ error: input.data.status === 'fulfilled' ? 'Only invoiced store orders can be marked fulfilled.' : 'Only pending store orders can be accepted or rejected.' }); return }
    response.json({ order: result.rows[0] })
  } catch (error) { next(error) }
})
app.post('/v1/store/orders/:orderId/convert', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const locationInput = z.object({ locationId: z.string().uuid().optional() }).safeParse(request.body)
  if (!locationInput.success) { response.status(400).json({ error: 'Choose a valid stock location.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query(`SELECT id, customer_name, customer_email, total::text
      FROM online_store_orders WHERE id = $1 AND workspace_id = $2 AND status = 'accepted' FOR UPDATE`,
    [request.params.orderId, request.session!.workspaceId])
    const order = found.rows[0]
    if (!order) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Accept the online order before invoicing it.' }); return }
    const orderLines = await client.query(`SELECT id, item_id, product_name, quantity::text, unit_price::text, total::text
      FROM online_store_order_lines WHERE order_id = $1 ORDER BY id`, [order.id])
    const locationId = await ensureInventoryLocation(client, request.session!.workspaceId, locationInput.data.locationId)
    if (!locationId) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Active stock location not found.' }); return }
    const dueDate = new Date(`${nairobiToday()}T00:00:00.000Z`)
    dueDate.setUTCDate(dueDate.getUTCDate() + 14)
    const dueDateText = dueDate.toISOString().slice(0, 10)
    const invoiceId = randomUUID()
    const description = orderLines.rows.map((line: Record<string, unknown>) => String(line.product_name)).join('; ').slice(0, 240) || 'Online store order'
    const invoiceResult = await client.query(`INSERT INTO invoices (id, workspace_id, customer, customer_email, description, amount, due_date, location_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, customer, description, amount::text, due_date, status`,
    [invoiceId, request.session!.workspaceId, order.customer_name, order.customer_email, description, order.total, dueDateText, locationId])
    let costOfGoodsSold = 0
    let invoiceSubtotalCents = 0
    for (const [index, line] of orderLines.rows.entries()) {
      const itemId = line.item_id ? String(line.item_id) : null
      const quantity = Number(line.quantity)
      const unitPriceCents = Math.round(Number(line.unit_price) * 100)
      const lineTotalCents = Math.round(Number(line.total) * 100)
      invoiceSubtotalCents += lineTotalCents
      if (itemId) {
        const itemResult = await client.query("SELECT data FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'inventory' FOR UPDATE", [itemId, request.session!.workspaceId])
        const data = itemResult.rows[0]?.data as Record<string, unknown> | undefined
        if (!data || Number(data.quantity ?? 0) < quantity) { await client.query('ROLLBACK'); response.status(409).json({ error: `${String(line.product_name)} is no longer available in the required quantity.` }); return }
        const locationStock = await client.query('SELECT quantity::text FROM inventory_location_stock WHERE workspace_id = $1 AND location_id = $2 AND item_id = $3 FOR UPDATE', [request.session!.workspaceId, locationId, itemId])
        if (Number(locationStock.rows[0]?.quantity ?? 0) < quantity) { await client.query('ROLLBACK'); response.status(409).json({ error: `${String(line.product_name)} is not available at the selected stock location.` }); return }
        const nextQuantity = Number((Number(data.quantity) - quantity).toFixed(3))
        await client.query('UPDATE workspace_records SET data = $1::jsonb, updated_at = now() WHERE id = $2 AND workspace_id = $3', [JSON.stringify({ ...data, quantity: nextQuantity }), itemId, request.session!.workspaceId])
        await client.query('UPDATE inventory_location_stock SET quantity = quantity - $1, updated_at = now() WHERE workspace_id = $2 AND location_id = $3 AND item_id = $4', [quantity.toFixed(3), request.session!.workspaceId, locationId, itemId])
        const itemCost = Number(data.cost ?? 0)
        const movementId = randomUUID()
        await client.query(`INSERT INTO inventory_movements (id, workspace_id, item_id, location_id, movement_type, quantity_delta, unit_cost, reference, moved_at, created_by)
          VALUES ($1, $2, $3, $4, 'sale', $5, $6, $7, $8, $9)`,
        [movementId, request.session!.workspaceId, itemId, locationId, (-quantity).toFixed(3), itemCost.toFixed(2), `Store order ${String(order.id).slice(0, 8)}`, nairobiToday(), request.session!.userId])
        costOfGoodsSold += quantity * itemCost
      }
      await client.query(`INSERT INTO invoice_lines (id, invoice_id, line_number, item_id, description, quantity, unit_price, discount_amount, tax_amount, total_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, $8)`,
      [randomUUID(), invoiceId, index + 1, itemId, String(line.product_name), quantity.toFixed(3), (unitPriceCents / 100).toFixed(2), (lineTotalCents / 100).toFixed(2)])
    }
    const journalLines: JournalLineInput[] = [{ accountCode: '1100', debit: Number(order.total), credit: 0 }]
    if (invoiceSubtotalCents > 0) journalLines.push({ accountCode: '4000', debit: 0, credit: invoiceSubtotalCents / 100 })
    if (costOfGoodsSold > 0) journalLines.push({ accountCode: '5100', debit: Number(costOfGoodsSold.toFixed(2)), credit: 0 }, { accountCode: '1200', debit: 0, credit: Number(costOfGoodsSold.toFixed(2)) })
    await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: nairobiToday(), description: `Online order invoice: ${order.customer_name}`, sourceType: 'online_store_invoice', sourceId: invoiceId, lines: journalLines })
    await client.query("UPDATE online_store_orders SET status = 'invoiced', invoice_id = $1, updated_at = now() WHERE id = $2", [invoiceId, order.id])
    await client.query('COMMIT')
    response.status(201).json({ invoice: invoiceResult.rows[0] })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})
type WooConnection = { store_url: string; consumer_key_ciphertext: string; consumer_secret_ciphertext: string; last_order_id?: string | null; last_synced_at?: Date | string | null }
async function woocommerceRequest<T>(connection: WooConnection, resource: string, method = 'GET', body?: unknown): Promise<T> {
  const storeUrl = await validatedWooStoreUrl(connection.store_url)
  const credentials = Buffer.from(`${decryptCommerceSecret(connection.consumer_key_ciphertext)}:${decryptCommerceSecret(connection.consumer_secret_ciphertext)}`).toString('base64')
  const providerResponse = await fetch(`${storeUrl}/wp-json/wc/v3/${resource}`, {
    method,
    headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  })
  const payload = await providerResponse.json().catch(() => null)
  if (!providerResponse.ok) {
    const providerMessage = typeof payload?.message === 'string' ? payload.message.slice(0, 250) : `HTTP ${providerResponse.status}`
    throw new Error(`WooCommerce request failed: ${providerMessage}`)
  }
  return payload as T
}
app.get('/v1/integrations/woocommerce', requirePool, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT store_url, enabled, last_order_id, last_synced_at FROM woocommerce_connections WHERE workspace_id = $1', [request.session!.workspaceId])
    response.json({ connection: result.rows[0] ? { ...result.rows[0], credentialsConfigured: true } : null, encryptionReady: Boolean(env.ONLINE_COMMERCE_ENCRYPTION_KEY) })
  } catch (error) { next(error) }
})
app.put('/v1/integrations/woocommerce', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ storeUrl: z.string().trim().url(), consumerKey: z.string().trim().min(1).max(300), consumerSecret: z.string().trim().min(1).max(300) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter the WooCommerce HTTPS store address and REST API consumer key and secret.' }); return }
  if (!env.ONLINE_COMMERCE_ENCRYPTION_KEY) { response.status(503).json({ error: 'WooCommerce credential storage is disabled. Configure ONLINE_COMMERCE_ENCRYPTION_KEY on the API service.' }); return }
  try {
    const storeUrl = await validatedWooStoreUrl(input.data.storeUrl)
    const encrypted = {
      key: encryptCommerceSecret(input.data.consumerKey),
      secret: encryptCommerceSecret(input.data.consumerSecret),
    }
    const saved = await pool!.query(`INSERT INTO woocommerce_connections (workspace_id, store_url, consumer_key_ciphertext, consumer_secret_ciphertext)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (workspace_id) DO UPDATE SET store_url = EXCLUDED.store_url, consumer_key_ciphertext = EXCLUDED.consumer_key_ciphertext,
        consumer_secret_ciphertext = EXCLUDED.consumer_secret_ciphertext, enabled = true, updated_at = now()
      RETURNING store_url, enabled, last_order_id, last_synced_at`,
    [request.session!.workspaceId, storeUrl, encrypted.key, encrypted.secret])
    response.json({ connection: { ...saved.rows[0], credentialsConfigured: true } })
  } catch (error) {
    if (error instanceof Error && (error.message.includes('WooCommerce store address') || error.message.includes('WooCommerce hostname'))) { response.status(400).json({ error: error.message }); return }
    next(error)
  }
})
app.post('/v1/integrations/woocommerce/products/sync', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  try {
    const connectionResult = await pool!.query('SELECT store_url, consumer_key_ciphertext, consumer_secret_ciphertext FROM woocommerce_connections WHERE workspace_id = $1 AND enabled = true', [request.session!.workspaceId])
    const connection = connectionResult.rows[0] as WooConnection | undefined
    if (!connection) { response.status(409).json({ error: 'Configure a WooCommerce connection before synchronizing products.' }); return }
    const inventory = await pool!.query("SELECT id, data FROM workspace_records WHERE workspace_id = $1 AND record_type = 'inventory' ORDER BY updated_at DESC LIMIT 250", [request.session!.workspaceId])
    const mappings = await pool!.query('SELECT item_id, external_product_id FROM woocommerce_product_mappings WHERE workspace_id = $1', [request.session!.workspaceId])
    const mappingByItem = new Map<string, string>(mappings.rows.map((mapping: { item_id: unknown; external_product_id: unknown }) => [String(mapping.item_id), String(mapping.external_product_id)]))
    let synced = 0
    const failures: Array<{ item: string; reason: string }> = []
    for (const row of inventory.rows as Array<{ id: unknown; data: Record<string, unknown> }>) {
      const itemId = String(row.id)
      const name = String(row.data.name ?? 'Product')
      const price = Number(row.data.price ?? 0)
      if (!Number.isFinite(price) || price <= 0) { failures.push({ item: name, reason: 'Set a positive selling price before sync.' }); continue }
      const productBody = {
        name,
        type: 'simple',
        sku: String(row.data.sku ?? ''),
        regular_price: price.toFixed(2),
        manage_stock: true,
        stock_quantity: Math.max(0, Math.floor(Number(row.data.quantity ?? 0))),
        stock_status: Number(row.data.quantity ?? 0) > 0 ? 'instock' : 'outofstock',
        description: String(row.data.onlineDescription ?? ''),
        status: 'publish',
      }
      try {
        const externalId = mappingByItem.get(itemId)
        const product = await woocommerceRequest<{ id: number }>(connection, externalId ? `products/${encodeURIComponent(externalId)}` : 'products', externalId ? 'PUT' : 'POST', productBody)
        await pool!.query(`INSERT INTO woocommerce_product_mappings (workspace_id, item_id, external_product_id)
          VALUES ($1, $2, $3) ON CONFLICT (workspace_id, item_id) DO UPDATE SET external_product_id = EXCLUDED.external_product_id, updated_at = now()`,
        [request.session!.workspaceId, itemId, String(product.id)])
        synced += 1
      } catch (error) { failures.push({ item: name, reason: error instanceof Error ? error.message : 'Provider request failed.' }) }
    }
    response.json({ synced, failed: failures.length, failures })
  } catch (error) { next(error) }
})
app.post('/v1/integrations/woocommerce/orders/sync', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  try {
    const connectionResult = await pool!.query('SELECT store_url, consumer_key_ciphertext, consumer_secret_ciphertext, last_order_id, last_synced_at FROM woocommerce_connections WHERE workspace_id = $1 AND enabled = true', [request.session!.workspaceId])
    const connection = connectionResult.rows[0] as WooConnection | undefined
    if (!connection) { response.status(409).json({ error: 'Configure a WooCommerce connection before importing orders.' }); return }
    const updatedAfter = connection.last_synced_at ? new Date(new Date(connection.last_synced_at).getTime() - 5 * 60_000).toISOString() : undefined
    const mappingRows = await pool!.query('SELECT item_id, external_product_id FROM woocommerce_product_mappings WHERE workspace_id = $1', [request.session!.workspaceId])
    const mapping = new Map<string, string>(mappingRows.rows.map((row: { item_id: unknown; external_product_id: unknown }) => [String(row.external_product_id), String(row.item_id)]))
    const inventory = await pool!.query("SELECT id, data FROM workspace_records WHERE workspace_id = $1 AND record_type = 'inventory'", [request.session!.workspaceId])
    const itemBySku = new Map<string, string>()
    for (const row of inventory.rows as Array<{ id: unknown; data: Record<string, unknown> }>) {
      if (row.data.sku) itemBySku.set(String(row.data.sku).toLowerCase(), String(row.id))
    }
    let imported = 0
    let skipped = 0
    let lastOrderId = Number(connection.last_order_id ?? 0)
    for (let pageNumber = 1; pageNumber <= 10; pageNumber += 1) {
      const query = new URLSearchParams({ per_page: '100', page: String(pageNumber), status: 'processing,on-hold,pending' })
      if (updatedAfter) query.set('after', updatedAfter)
      const orders = await woocommerceRequest<Array<Record<string, unknown>>>(connection, `orders?${query.toString()}`)
      if (!orders.length) break
      for (const externalOrder of orders) {
        const externalId = String(externalOrder.id ?? '')
        if (!externalId) { skipped += 1; continue }
        const existing = await pool!.query('SELECT id FROM online_store_orders WHERE workspace_id = $1 AND source = $2 AND external_order_id = $3', [request.session!.workspaceId, 'woocommerce', externalId])
        if (existing.rowCount) continue
        const externalLines = Array.isArray(externalOrder.line_items) ? externalOrder.line_items as Array<Record<string, unknown>> : []
        const importedLines: Array<{ itemId: string; name: string; sku: string; quantity: number; unitPriceCents: number; totalCents: number }> = []
        let missingMapping = false
        for (const externalLine of externalLines) {
          const externalProductId = String(externalLine.product_id ?? '')
          const sku = String(externalLine.sku ?? '')
          const itemId = mapping.get(externalProductId) ?? itemBySku.get(sku.toLowerCase())
          const quantity = Math.floor(Number(externalLine.quantity))
          const totalCents = Math.round(Number(externalLine.total ?? 0) * 100)
          if (!itemId || quantity < 1 || totalCents < 0) { missingMapping = true; break }
          if (!mapping.has(externalProductId) && externalProductId) {
            await pool!.query(`INSERT INTO woocommerce_product_mappings (workspace_id, item_id, external_product_id)
              VALUES ($1, $2, $3) ON CONFLICT (workspace_id, item_id) DO NOTHING`,
            [request.session!.workspaceId, itemId, externalProductId])
            mapping.set(externalProductId, itemId)
          }
          importedLines.push({
            itemId,
            name: String(externalLine.name ?? 'Product'),
            sku,
            quantity,
            unitPriceCents: Math.round(totalCents / quantity),
            totalCents,
          })
        }
        if (missingMapping || !importedLines.length) { skipped += 1; continue }
        const totalCents = importedLines.reduce((sum, line) => sum + line.totalCents, 0)
        const customerName = [externalOrder.billing && (externalOrder.billing as Record<string, unknown>).first_name, externalOrder.billing && (externalOrder.billing as Record<string, unknown>).last_name].filter(Boolean).join(' ') || 'WooCommerce customer'
        const billing = externalOrder.billing as Record<string, unknown> | undefined
        const email = String(billing?.email ?? `order-${externalId}@woocommerce.invalid`)
        const phone = String(billing?.phone ?? '')
        const portalToken = randomBytes(32).toString('base64url')
        const orderId = randomUUID()
        await pool!.query(`INSERT INTO online_store_orders (id, workspace_id, status, source, external_order_id, customer_name, customer_email, customer_phone, portal_token_hash, total)
          VALUES ($1, $2, 'pending_review', 'woocommerce', $3, $4, $5, $6, $7, $8)`,
        [orderId, request.session!.workspaceId, externalId, customerName.slice(0, 160), email, phone.slice(0, 30), createHash('sha256').update(portalToken).digest('hex'), (totalCents / 100).toFixed(2)])
        for (const line of importedLines) {
          await pool!.query(`INSERT INTO online_store_order_lines (id, order_id, item_id, product_name, sku, quantity, unit_price, total)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), orderId, line.itemId, line.name.slice(0, 160), line.sku.slice(0, 80), line.quantity.toFixed(3), (line.unitPriceCents / 100).toFixed(2), (line.totalCents / 100).toFixed(2)])
        }
        imported += 1
        lastOrderId = Math.max(lastOrderId, Number(externalId) || 0)
      }
      if (orders.length < 100) break
    }
    await pool!.query('UPDATE woocommerce_connections SET last_order_id = $1, last_synced_at = now(), updated_at = now() WHERE workspace_id = $2', [String(lastOrderId), request.session!.workspaceId])
    response.json({ imported, skipped, note: 'Imported WooCommerce orders remain pending review. Tax, shipping, WooCommerce payment status, and actual money movement must be verified separately.' })
  } catch (error) { next(error) }
})
app.post('/v1/bank-imports', requirePool, verifyOrigin, requireSession, requireAccountingRole, async (request: AuthedRequest, response, next) => {
  const input = z.object({ rows: z.array(z.object({ date: z.string().date(), description: z.string().trim().min(1).max(240), amount: z.coerce.number().finite().positive().max(999999999999), direction: z.enum(['income', 'expense']) })).min(1).max(500) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide 1 to 500 reviewed rows with valid dates, descriptions, amounts, and directions.' }); return }
  await ensureDefaultAccounts(request.session!.workspaceId)
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    for (const row of input.data.rows) {
      const id = randomUUID()
      await client.query('INSERT INTO ledger_transactions (id, workspace_id, description, amount, direction, account, transaction_date) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, request.session!.workspaceId, row.description, row.amount.toFixed(2), row.direction, 'Imported bank statement', row.date])
      const lines: JournalLineInput[] = row.direction === 'income'
        ? [{ accountCode: '1000', debit: row.amount, credit: 0 }, { accountCode: '4000', debit: 0, credit: row.amount }]
        : [{ accountCode: '6000', debit: row.amount, credit: 0 }, { accountCode: '1000', debit: 0, credit: row.amount }]
      await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: row.date, description: row.description, sourceType: 'bank_statement_import', sourceId: id, lines })
    }
    await client.query('COMMIT')
    response.status(201).json({ importedCount: input.data.rows.length })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})

type MonoApiObject = { id?: string; data?: unknown; message?: string; status?: string; meta?: Record<string, unknown> }
async function monoRequest(path: string, init?: RequestInit): Promise<MonoApiObject> {
  if (!monoConfigured) throw new Error('Mono bank feeds are not configured. Complete Mono business onboarding and set MONO_PUBLIC_KEY and MONO_SECRET_KEY on the API service.')
  const response = await fetch(`https://api.withmono.com${path}`, { ...init, headers: { accept: 'application/json', 'content-type': 'application/json', 'mono-sec-key': env.MONO_SECRET_KEY!, ...init?.headers }, signal: AbortSignal.timeout(25_000) })
  const payload = await response.json().catch(() => ({})) as MonoApiObject
  if (!response.ok) throw new Error(`Mono API request failed (${response.status}): ${String(payload.message ?? 'provider rejected the request').slice(0, 300)}`)
  return payload
}
function monoAccountPayload(value: MonoApiObject) {
  const data = (value.data && typeof value.data === 'object' ? value.data : value) as Record<string, unknown>
  const account = (data.account && typeof data.account === 'object' ? data.account : data) as Record<string, unknown>
  const institution = (account.institution && typeof account.institution === 'object' ? account.institution : {}) as Record<string, unknown>
  const meta = (data.meta && typeof data.meta === 'object' ? data.meta : {}) as Record<string, unknown>
  const id = String(account.id ?? account._id ?? data.id ?? '')
  if (!id) throw new Error('Mono linked account response did not include an account identifier.')
  const number = String(account.account_number ?? account.accountNumber ?? '')
  return { id, name: String(account.name ?? ''), accountNumberMasked: number ? `••••${number.slice(-4)}` : '', institutionName: String(institution.name ?? ''), currency: String(account.currency ?? 'KES'), accountType: String(account.type ?? ''), dataStatus: String(meta.data_status ?? account.data_status ?? 'PROCESSING') }
}
async function syncMonoAccount(workspaceId: string, connectedAccountId: string, providerAccountId: string) {
  const accountPayload = await monoRequest(`/v2/accounts/${encodeURIComponent(providerAccountId)}`)
  const accountInfo = monoAccountPayload(accountPayload)
  const transactionPayload = await monoRequest(`/v2/accounts/${encodeURIComponent(providerAccountId)}/transactions?paginate=false`)
  const root = (transactionPayload.data && typeof transactionPayload.data === 'object' ? transactionPayload.data : transactionPayload) as Record<string, unknown>
  const rawTransactions = Array.isArray(transactionPayload.data) ? transactionPayload.data : Array.isArray(root.transactions) ? root.transactions : []
  let importedCount = 0
  for (const raw of rawTransactions) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const externalId = String(row.id ?? row._id ?? '')
    const rawDate = String(row.date ?? row.created_at ?? '')
    const parsedDate = new Date(rawDate)
    const rawAmount = Number(row.amount)
    const directionText = String(row.type ?? '').toLowerCase()
    if (!externalId || !Number.isFinite(parsedDate.getTime()) || !Number.isFinite(rawAmount) || rawAmount < 0 || !['credit', 'debit', 'income', 'expense'].includes(directionText)) continue
    const cents = Math.round(rawAmount)
    const amount = (cents / 100).toFixed(2)
    const direction = directionText === 'credit' || directionText === 'income' ? 'income' : 'expense'
    const saved = await pool!.query(`INSERT INTO bank_feed_transactions (workspace_id, connected_account_id, provider_transaction_id, transaction_date, narration, amount, direction, currency, provider_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (connected_account_id, provider_transaction_id) DO UPDATE SET narration = EXCLUDED.narration, amount = EXCLUDED.amount, direction = EXCLUDED.direction, currency = EXCLUDED.currency, provider_data = EXCLUDED.provider_data, updated_at = now()
      WHERE bank_feed_transactions.review_status = 'needs_review'`, [workspaceId, connectedAccountId, externalId, parsedDate.toISOString().slice(0, 10), String(row.narration ?? row.description ?? '').slice(0, 500), amount, direction, accountInfo.currency, JSON.stringify(row)])
    importedCount += saved.rowCount ?? 0
  }
  await pool!.query('UPDATE connected_bank_accounts SET account_name = $1, account_number_masked = $2, institution_name = $3, currency = $4, account_type = $5, data_status = $6, last_synced_at = now(), updated_at = now() WHERE id = $7 AND workspace_id = $8', [accountInfo.name, accountInfo.accountNumberMasked, accountInfo.institutionName, accountInfo.currency, accountInfo.accountType, accountInfo.dataStatus, connectedAccountId, workspaceId])
  return { importedCount, dataStatus: accountInfo.dataStatus }
}
app.get('/v1/banking/mono/config', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const settings = await pool!.query('SELECT preferences FROM workspace_settings WHERE workspace_id = $1', [request.session!.workspaceId])
    const enabled = monoConfigured && settings.rows[0]?.preferences?.monoEnabled === true
    response.json({ enabled, publicKey: enabled ? env.MONO_PUBLIC_KEY : null, provider: 'Mono', countryCoverage: 'Kenya is listed by Mono; confirm your bank is available in the Mono dashboard before activation.', setupRequired: monoConfigured ? enabled ? [] : ['Enable Mono for this business in Settings'] : ['Mono business/partner onboarding and KYB approval', 'Mono app public key', 'Mono secret key configured only on the API server', 'A public HTTPS callback URL for Mono account update webhooks'] })
  } catch (error) { next(error) }
})
app.post('/v1/banking/mono/link', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requireWorkspaceProviderPreference('monoEnabled'), async (request: AuthedRequest, response, next) => {
  if (!monoConfigured) { response.status(503).json({ error: 'Mono is not configured. Complete Mono business onboarding and configure MONO_PUBLIC_KEY and MONO_SECRET_KEY on the API service.' }); return }
  const input = z.object({ code: z.string().trim().min(1).max(500) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Mono Connect did not return a valid authorization code.' }); return }
  try {
    const exchanged = await monoRequest('/v2/accounts/auth', { method: 'POST', body: JSON.stringify({ code: input.data.code }) })
    const exchangedData = (exchanged.data && typeof exchanged.data === 'object' ? exchanged.data : exchanged) as Record<string, unknown>
    const providerAccountId = String(exchangedData.id ?? exchangedData.account_id ?? '')
    if (!providerAccountId) { response.status(502).json({ error: 'Mono did not return an account ID. Check Mono onboarding and the Connect callback code.' }); return }
    const details = await monoRequest(`/v2/accounts/${encodeURIComponent(providerAccountId)}`)
    const accountInfo = monoAccountPayload(details)
    const stored = await pool!.query(`INSERT INTO connected_bank_accounts (workspace_id, provider_account_id, account_name, account_number_masked, institution_name, currency, account_type, data_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (workspace_id, provider, provider_account_id) DO UPDATE SET account_name = EXCLUDED.account_name, account_number_masked = EXCLUDED.account_number_masked, institution_name = EXCLUDED.institution_name, currency = EXCLUDED.currency, account_type = EXCLUDED.account_type, data_status = EXCLUDED.data_status, connection_status = 'connected', updated_at = now()
      RETURNING id, account_name, account_number_masked, institution_name, currency, account_type, data_status, last_synced_at`, [request.session!.workspaceId, accountInfo.id, accountInfo.name, accountInfo.accountNumberMasked, accountInfo.institutionName, accountInfo.currency, accountInfo.accountType, accountInfo.dataStatus])
    let sync = { importedCount: 0, dataStatus: accountInfo.dataStatus }
    if (accountInfo.dataStatus === 'AVAILABLE' || accountInfo.dataStatus === 'PARTIAL') sync = await syncMonoAccount(request.session!.workspaceId, String(stored.rows[0].id), accountInfo.id)
    response.status(201).json({ account: stored.rows[0], sync, provider: 'Mono', notice: 'Account linked using Mono consent flow. Transactions have been imported for review and are not automatically posted to the ledger.' })
  } catch (error) { next(error) }
})
app.get('/v1/banking/accounts', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, provider, account_name, account_number_masked, institution_name, currency, account_type, data_status, connection_status, last_synced_at, created_at FROM connected_bank_accounts WHERE workspace_id = $1 ORDER BY created_at DESC', [request.session!.workspaceId])
    response.json({ accounts: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/banking/accounts/:accountId/sync', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requireWorkspaceProviderPreference('monoEnabled'), async (request: AuthedRequest, response, next) => {
  if (!monoConfigured) { response.status(503).json({ error: 'Mono bank-feed API credentials are not configured.' }); return }
  try {
    const account = await pool!.query("SELECT id, provider_account_id FROM connected_bank_accounts WHERE id = $1 AND workspace_id = $2 AND provider = 'mono' AND connection_status = 'connected'", [request.params.accountId, request.session!.workspaceId])
    if (!account.rowCount) { response.status(404).json({ error: 'Connected Mono bank account not found.' }); return }
    const sync = await syncMonoAccount(request.session!.workspaceId, String(account.rows[0].id), String(account.rows[0].provider_account_id))
    response.json({ sync, notice: 'Feed synchronized. Transactions remain pending your review and ledger posting.' })
  } catch (error) { next(error) }
})
app.get('/v1/banking/transactions', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  const status = z.enum(['needs_review', 'ignored', 'posted']).optional().safeParse(request.query.status)
  if (!status.success) { response.status(400).json({ error: 'Invalid review status filter.' }); return }
  try {
    const result = await pool!.query(`SELECT t.id, t.connected_account_id, t.provider_transaction_id, t.transaction_date, t.narration, t.amount::text, t.direction, t.currency, t.review_status, t.posted_transaction_id, a.institution_name, a.account_name
      FROM bank_feed_transactions t JOIN connected_bank_accounts a ON a.id = t.connected_account_id
      WHERE t.workspace_id = $1 AND ($2::text IS NULL OR t.review_status = $2) ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT 300`, [request.session!.workspaceId, status.data ?? null])
    response.json({ transactions: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/banking/transactions/:transactionId/review', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({ action: z.enum(['post', 'ignore']) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Choose post or ignore.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query("SELECT id, transaction_date, narration, amount::text, direction, currency, review_status FROM bank_feed_transactions WHERE id = $1 AND workspace_id = $2 FOR UPDATE", [request.params.transactionId, request.session!.workspaceId])
    const item = result.rows[0]
    if (!item) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Bank-feed transaction not found.' }); return }
    if (item.review_status !== 'needs_review') { await client.query('ROLLBACK'); response.status(409).json({ error: 'Only a transaction awaiting review can be changed.' }); return }
    if (input.data.action === 'ignore') {
      await client.query("UPDATE bank_feed_transactions SET review_status = 'ignored', updated_at = now() WHERE id = $1", [item.id])
      await client.query('COMMIT'); response.json({ status: 'ignored' }); return
    }
    if (String(item.currency).toUpperCase() !== 'KES') { await client.query('ROLLBACK'); response.status(409).json({ error: `This account is denominated in ${item.currency}; convert to KSh before posting to this KSh ledger.` }); return }
    await ensureDefaultAccounts(request.session!.workspaceId)
    const transactionId = randomUUID()
    const description = String(item.narration || 'Bank-feed transaction').slice(0, 240)
    await client.query('INSERT INTO ledger_transactions (id, workspace_id, description, amount, direction, account, transaction_date) VALUES ($1, $2, $3, $4, $5, $6, $7)', [transactionId, request.session!.workspaceId, description, item.amount, item.direction, 'Mono bank feed', item.transaction_date])
    const amount = Number(item.amount)
    const lines: JournalLineInput[] = item.direction === 'income' ? [{ accountCode: '1000', debit: amount, credit: 0 }, { accountCode: '4000', debit: 0, credit: amount }] : [{ accountCode: '6000', debit: amount, credit: 0 }, { accountCode: '1000', debit: 0, credit: amount }]
    await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: String(item.transaction_date).slice(0, 10), description, sourceType: 'mono_bank_feed', sourceId: String(item.id), lines })
    await client.query("UPDATE bank_feed_transactions SET review_status = 'posted', posted_transaction_id = $1, updated_at = now() WHERE id = $2", [transactionId, item.id])
    await client.query('COMMIT')
    response.status(201).json({ status: 'posted', transactionId })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})
app.post('/v1/integrations/mono/webhook', requirePool, async (request, response, next) => {
  if (!env.MONO_WEBHOOK_SECRET || request.header('mono-webhook-secret') !== env.MONO_WEBHOOK_SECRET) { response.status(401).json({ error: 'Invalid Mono webhook secret.' }); return }
  const input = z.object({ event: z.string(), event_id: z.string().optional(), data: z.record(z.string(), z.unknown()) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Invalid Mono webhook payload.' }); return }
  if (input.data.event === 'mono.events.account_updated' || input.data.event === 'mono.events.account_connected') {
    const accountData = (input.data.data.account && typeof input.data.data.account === 'object' ? input.data.data.account : input.data.data) as Record<string, unknown>
    const providerAccountId = String(accountData._id ?? accountData.id ?? '')
    if (providerAccountId) {
      try {
        const connected = await pool!.query("SELECT id, workspace_id FROM connected_bank_accounts WHERE provider_account_id = $1 AND provider = 'mono' AND connection_status = 'connected'", [providerAccountId])
        for (const account of connected.rows) {
          const settings = await pool!.query('SELECT preferences FROM workspace_settings WHERE workspace_id = $1', [account.workspace_id])
          if (settings.rows[0]?.preferences?.monoEnabled === true) await syncMonoAccount(String(account.workspace_id), String(account.id), providerAccountId)
        }
      } catch (error) { next(error); return }
    }
  }
  response.status(200).json({ received: true })
})
app.put('/v1/records/:type/:recordId', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const type = parseRecordType(String(request.params.type ?? ''))
  if (!type) { response.status(404).json({ error: 'Unknown record type.' }); return }
  const input = workspaceRecordSchemas[type].safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Check the required name and field values.' }); return }
  const inventoryInput = type === 'inventory' ? workspaceRecordSchemas.inventory.parse(request.body) : null
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    if (type === 'suppliers') {
      const invalidLinks = await validateSupplierItemLinks(client, request.session!.workspaceId, (input.data as z.infer<typeof workspaceRecordSchemas.suppliers>).supplyItemIds)
      if (invalidLinks) { await client.query('ROLLBACK'); response.status(400).json({ error: invalidLinks }); return }
    }
    if (type === 'inventory') {
      const current = await client.query("SELECT data FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'inventory' FOR UPDATE", [request.params.recordId, request.session!.workspaceId])
      if (!current.rowCount) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Record not found in this workspace.' }); return }
      const prior = current.rows[0].data as Record<string, unknown>
      const movementCount = await client.query('SELECT count(*)::int AS count FROM inventory_movements WHERE item_id = $1 AND workspace_id = $2', [request.params.recordId, request.session!.workspaceId])
      if (inventoryInput && Number(movementCount.rows[0].count) > 0 && (Number(prior.quantity) !== inventoryInput.quantity || Number(prior.cost) !== inventoryInput.cost)) {
        await client.query('ROLLBACK')
        response.status(409).json({ error: 'Stock quantity and cost are controlled by the inventory movement ledger. Record a movement instead of editing these values.' })
        return
      }
    }
    const result = await client.query('UPDATE workspace_records SET data = $1::jsonb, updated_at = now() WHERE id = $2 AND workspace_id = $3 AND record_type = $4 RETURNING id, data, created_at, updated_at', [JSON.stringify(input.data), request.params.recordId, request.session!.workspaceId, workspaceRecordDatabaseTypes[type]])
    if (!result.rowCount) { response.status(404).json({ error: 'Record not found in this workspace.' }); return }
    await client.query('COMMIT')
    response.json({ record: result.rows[0] })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})
app.delete('/v1/records/:type/:recordId', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const type = parseRecordType(String(request.params.type ?? ''))
  if (!type) { response.status(404).json({ error: 'Unknown record type.' }); return }
  try {
    const result = await pool!.query('DELETE FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = $3 RETURNING id', [request.params.recordId, request.session!.workspaceId, workspaceRecordDatabaseTypes[type]])
    if (!result.rowCount) { response.status(404).json({ error: 'Record not found in this workspace.' }); return }
    response.status(204).end()
  } catch (error) { next(error) }
})

app.get('/v1/inventory/:itemId/movements', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query(`SELECT id, movement_type, quantity_delta::text, unit_cost::text, reference, moved_at, created_at
      FROM inventory_movements WHERE workspace_id = $1 AND item_id = $2 ORDER BY moved_at DESC, created_at DESC LIMIT 200`, [request.session!.workspaceId, request.params.itemId])
    response.json({ movements: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/inventory/:itemId/movements', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({
    movementType: z.enum(['purchase', 'sale', 'adjustment']),
    quantity: z.coerce.number().finite().positive().max(1_000_000),
    adjustmentDirection: z.enum(['increase', 'decrease']).default('increase'),
    locationId: z.string().uuid().optional(),
    unitCost: z.coerce.number().finite().min(0).max(999999999999),
    reference: z.string().trim().max(200).default(''),
    date: z.string().date(),
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a valid stock movement, quantity, unit cost, reference, and date.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query("SELECT data FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'inventory' FOR UPDATE", [request.params.itemId, request.session!.workspaceId])
    const data = result.rows[0]?.data as Record<string, unknown> | undefined
    if (!data) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Inventory item not found in this business.' }); return }
    const locationId = await ensureInventoryLocation(client, request.session!.workspaceId, input.data.locationId)
    if (!locationId) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Active stock location not found.' }); return }
    const oldQuantity = Number(data.quantity ?? 0)
    const oldCost = Number(data.cost ?? 0)
    const quantityDelta = input.data.movementType === 'sale' || (input.data.movementType === 'adjustment' && input.data.adjustmentDirection === 'decrease')
      ? -input.data.quantity
      : input.data.quantity
    const newQuantity = oldQuantity + quantityDelta
    if (newQuantity < 0) { await client.query('ROLLBACK'); response.status(409).json({ error: 'This movement would make on-hand stock negative.' }); return }
    const locationStock = await client.query('SELECT quantity::text FROM inventory_location_stock WHERE workspace_id = $1 AND location_id = $2 AND item_id = $3 FOR UPDATE', [request.session!.workspaceId, locationId, request.params.itemId])
    const locationQuantity = Number(locationStock.rows[0]?.quantity ?? 0)
    if (locationQuantity + quantityDelta < 0) { await client.query('ROLLBACK'); response.status(409).json({ error: 'This movement would make stock at this location negative.' }); return }
    const movementCost = input.data.movementType === 'sale' ? oldCost : input.data.unitCost || oldCost
    const averageCost = newQuantity > 0 && quantityDelta > 0
      ? ((oldQuantity * oldCost) + (quantityDelta * movementCost)) / newQuantity
      : oldCost
    await client.query('UPDATE workspace_records SET data = $1::jsonb, updated_at = now() WHERE id = $2 AND workspace_id = $3', [JSON.stringify({ ...data, quantity: Number(newQuantity.toFixed(3)), cost: Number(averageCost.toFixed(2)) }), request.params.itemId, request.session!.workspaceId])
    await client.query(`INSERT INTO inventory_location_stock (workspace_id, location_id, item_id, quantity)
      VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, location_id, item_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
    [request.session!.workspaceId, locationId, request.params.itemId, Number((locationQuantity + quantityDelta).toFixed(3)).toFixed(3)])
    const movementId = randomUUID()
    await client.query(`INSERT INTO inventory_movements (id, workspace_id, item_id, location_id, movement_type, quantity_delta, unit_cost, reference, moved_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [movementId, request.session!.workspaceId, request.params.itemId, locationId, input.data.movementType, quantityDelta.toFixed(3), movementCost.toFixed(2), input.data.reference, input.data.date, request.session!.userId])
    await ensureDefaultAccounts(request.session!.workspaceId)
    const movementValue = Number((Math.abs(quantityDelta) * movementCost).toFixed(2))
    if (movementValue > 0) {
      const lines: JournalLineInput[] = quantityDelta > 0
        ? [{ accountCode: '1200', debit: movementValue, credit: 0 }, { accountCode: '2200', debit: 0, credit: movementValue }]
        : [{ accountCode: '5100', debit: movementValue, credit: 0 }, { accountCode: '1200', debit: 0, credit: movementValue }]
      await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: input.data.date, description: `Inventory ${input.data.movementType}: ${String(data.name ?? 'item')}`, sourceType: 'inventory_movement', sourceId: movementId, lines })
    }
    await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'inventory.movement_recorded', entityType: 'inventory_item', entityId: String(request.params.itemId), eventData: { movementId, movementType: input.data.movementType, quantityDelta, newQuantity } })
    await client.query('COMMIT')
    response.status(201).json({ movement: { id: movementId, movementType: input.data.movementType, quantityDelta, quantityOnHand: Number(newQuantity.toFixed(3)), unitCost: movementCost } })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})

app.get('/v1/purchase-orders', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, supplier, status, order_date, due_date, expected_date, notes FROM purchase_orders WHERE workspace_id = $1 ORDER BY order_date DESC LIMIT 100', [request.session!.workspaceId])
    const lineResult = await pool!.query(`SELECT l.purchase_order_id, l.id, l.item_id, r.data->>'name' AS item_name,
      l.quantity::text, l.received_quantity::text, l.unit_cost::text
      FROM purchase_order_lines l JOIN purchase_orders p ON p.id = l.purchase_order_id AND p.workspace_id = $1
      JOIN workspace_records r ON r.id = l.item_id AND r.workspace_id = $1 ORDER BY l.id`, [request.session!.workspaceId])
    const purchaseOrders = result.rows.map((order: Record<string, unknown>) => ({ ...order, lines: lineResult.rows.filter((line: Record<string, unknown>) => line.purchase_order_id === order.id) }))
    response.json({ purchaseOrders })
  } catch (error) { next(error) }
})
app.post('/v1/purchase-orders', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({
    supplier: z.string().trim().min(1).max(160),
    locationId: z.string().uuid().optional(),
    orderDate: z.string().date(),
    dueDate: z.string().date().optional(),
    expectedDate: z.string().date().optional(),
    notes: z.string().trim().max(2000).default(''),
    lines: z.array(z.object({ itemId: z.string().uuid(), quantity: z.coerce.number().finite().positive().max(1_000_000), unitCost: z.coerce.number().finite().min(0).max(999999999999) })).min(1).max(100),
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide a supplier, valid dates, and at least one inventory line.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const id = randomUUID()
    const locationId = await ensureInventoryLocation(client, request.session!.workspaceId, input.data.locationId)
    if (!locationId) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Active stock location not found.' }); return }
    await client.query('INSERT INTO purchase_orders (id, workspace_id, supplier, location_id, order_date, due_date, expected_date, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [id, request.session!.workspaceId, input.data.supplier, locationId, input.data.orderDate, input.data.dueDate ?? input.data.orderDate, input.data.expectedDate ?? null, input.data.notes, request.session!.userId])
    for (const line of input.data.lines) {
      const item = await client.query("SELECT id FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'inventory'", [line.itemId, request.session!.workspaceId])
      if (!item.rowCount) { await client.query('ROLLBACK'); response.status(400).json({ error: 'Every purchase order line must reference an inventory item in this business.' }); return }
      await client.query('INSERT INTO purchase_order_lines (id, purchase_order_id, item_id, quantity, unit_cost) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), id, line.itemId, line.quantity.toFixed(3), line.unitCost.toFixed(2)])
    }
    await client.query('COMMIT')
    response.status(201).json({ purchaseOrder: { id, status: 'open' } })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})
app.post('/v1/purchase-orders/:orderId/receive', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ lines: z.array(z.object({ lineId: z.string().uuid(), quantity: z.coerce.number().finite().positive().max(1_000_000) })).min(1).max(100), date: z.string().date() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide received quantities and a valid receiving date.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const orderResult = await client.query("SELECT id, supplier, status, due_date, location_id FROM purchase_orders WHERE id = $1 AND workspace_id = $2 AND status IN ('open', 'partially_received') FOR UPDATE", [request.params.orderId, request.session!.workspaceId])
    const order = orderResult.rows[0]
    if (!order) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Open purchase order not found.' }); return }
    let receivedValue = 0
    const receivedLines: Array<{ itemId: string; description: string; quantity: number; unitCost: number; total: number }> = []
    for (const received of input.data.lines) {
      const lineResult = await client.query(`SELECT l.id, l.item_id, l.quantity::text, l.received_quantity::text, l.unit_cost::text, r.data
        FROM purchase_order_lines l JOIN workspace_records r ON r.id = l.item_id AND r.workspace_id = $2 AND r.record_type = 'inventory'
        WHERE l.id = $1 AND l.purchase_order_id = $3 FOR UPDATE`, [received.lineId, request.session!.workspaceId, order.id])
      const line = lineResult.rows[0]
      if (!line || Number(line.received_quantity) + received.quantity > Number(line.quantity)) { await client.query('ROLLBACK'); response.status(409).json({ error: 'A received quantity exceeds its remaining purchase order quantity.' }); return }
      const data = line.data as Record<string, unknown>
      const priorQuantity = Number(data.quantity ?? 0)
      const cost = Number(line.unit_cost)
      const nextQuantity = priorQuantity + received.quantity
      const nextCost = nextQuantity > 0 ? (priorQuantity * Number(data.cost ?? cost) + received.quantity * cost) / nextQuantity : cost
      await client.query('UPDATE workspace_records SET data = $1::jsonb, updated_at = now() WHERE id = $2 AND workspace_id = $3', [JSON.stringify({ ...data, quantity: Number(nextQuantity.toFixed(3)), cost: Number(nextCost.toFixed(2)) }), line.item_id, request.session!.workspaceId])
      const locationId = await ensureInventoryLocation(client, request.session!.workspaceId, order.location_id ? String(order.location_id) : undefined)
      if (!locationId) { await client.query('ROLLBACK'); response.status(409).json({ error: 'The purchase order location is no longer active.' }); return }
      await client.query(`INSERT INTO inventory_location_stock (workspace_id, location_id, item_id, quantity)
        VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, location_id, item_id)
        DO UPDATE SET quantity = inventory_location_stock.quantity + EXCLUDED.quantity, updated_at = now()`,
      [request.session!.workspaceId, locationId, line.item_id, received.quantity.toFixed(3)])
      await client.query('UPDATE purchase_order_lines SET received_quantity = received_quantity + $1 WHERE id = $2', [received.quantity.toFixed(3), line.id])
      const movementId = randomUUID()
      await client.query("INSERT INTO inventory_movements (id, workspace_id, item_id, location_id, movement_type, quantity_delta, unit_cost, reference, moved_at, created_by) VALUES ($1, $2, $3, $4, 'purchase', $5, $6, $7, $8, $9)", [movementId, request.session!.workspaceId, line.item_id, locationId, received.quantity.toFixed(3), cost.toFixed(2), `PO ${String(order.id).slice(0, 8)}`, input.data.date, request.session!.userId])
      receivedValue += received.quantity * cost
      receivedLines.push({ itemId: String(line.item_id), description: String(data.name ?? 'Inventory item'), quantity: received.quantity, unitCost: cost, total: received.quantity * cost })
    }
    await ensureDefaultAccounts(request.session!.workspaceId)
    if (receivedValue > 0) {
      const billId = randomUUID()
      const description = `Purchase order receipt ${String(order.id).slice(0, 8)}`
      const dueDate = order.due_date ? String(order.due_date).slice(0, 10) : input.data.date
      await client.query(`INSERT INTO vendor_bills (id, workspace_id, supplier, description, amount, bill_date, due_date, approval_status, approved_by, approved_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', $8, now())`,
      [billId, request.session!.workspaceId, order.supplier, description, receivedValue.toFixed(2), input.data.date, dueDate, request.session!.userId])
      for (const [index, line] of receivedLines.entries()) {
        await client.query(`INSERT INTO vendor_bill_lines (id, bill_id, line_number, description, quantity, unit_price, total_amount)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`, [randomUUID(), billId, index + 1, line.description, line.quantity.toFixed(3), line.unitCost.toFixed(2), line.total.toFixed(2)])
      }
      await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: input.data.date, description: `Goods received from ${order.supplier}`, sourceType: 'vendor_bill', sourceId: billId, lines: [{ accountCode: '1200', debit: receivedValue, credit: 0 }, { accountCode: '2200', debit: 0, credit: receivedValue }] })
    }
    const remaining = await client.query('SELECT count(*)::int AS count FROM purchase_order_lines WHERE purchase_order_id = $1 AND received_quantity < quantity', [order.id])
    const status = Number(remaining.rows[0].count) === 0 ? 'received' : 'partially_received'
    await client.query('UPDATE purchase_orders SET status = $1 WHERE id = $2', [status, order.id])
    await client.query('COMMIT')
    response.json({ status, receivedValue: Number(receivedValue.toFixed(2)) })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})

app.get('/v1/projects/:projectId/time', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const project = await pool!.query("SELECT id FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'project'", [request.params.projectId, request.session!.workspaceId])
    if (!project.rowCount) { response.status(404).json({ error: 'Project not found in this business.' }); return }
    const result = await pool!.query('SELECT id, description, work_date, hours::text, hourly_cost::text, billable, status, created_at FROM project_time_entries WHERE workspace_id = $1 AND project_id = $2 ORDER BY work_date DESC, created_at DESC', [request.session!.workspaceId, request.params.projectId])
    response.json({ entries: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/projects/:projectId/time', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const input = z.object({ description: z.string().trim().min(1).max(240), workDate: z.string().date(), hours: z.coerce.number().finite().positive().max(24), hourlyCost: z.coerce.number().finite().min(0).max(999999999999), billable: z.boolean().default(false) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide a description, work date, hours (up to 24), and valid hourly cost.' }); return }
  try {
    const project = await pool!.query("SELECT id FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'project'", [request.params.projectId, request.session!.workspaceId])
    if (!project.rowCount) { response.status(404).json({ error: 'Project not found in this business.' }); return }
    const result = await pool!.query(`INSERT INTO project_time_entries (id, workspace_id, project_id, description, work_date, hours, hourly_cost, billable, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, description, work_date, hours::text, hourly_cost::text, billable, status`,
    [randomUUID(), request.session!.workspaceId, request.params.projectId, input.data.description, input.data.workDate, input.data.hours.toFixed(2), input.data.hourlyCost.toFixed(2), input.data.billable, request.session!.userId])
    response.status(201).json({ entry: result.rows[0] })
  } catch (error) { next(error) }
})
app.patch('/v1/projects/:projectId/time/:entryId', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ status: z.enum(['approved', 'rejected']) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Choose approved or rejected for time review.' }); return }
  try {
    const result = await pool!.query(`UPDATE project_time_entries SET status = $1, reviewed_by = $2
      WHERE id = $3 AND project_id = $4 AND workspace_id = $5 AND status = 'submitted' RETURNING id, status`,
    [input.data.status, request.session!.userId, request.params.entryId, request.params.projectId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(404).json({ error: 'Submitted time entry not found.' }); return }
    response.json({ entry: result.rows[0] })
  } catch (error) { next(error) }
})
app.get('/v1/projects/:projectId/summary', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const project = await pool!.query("SELECT data FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'project'", [request.params.projectId, request.session!.workspaceId])
    if (!project.rowCount) { response.status(404).json({ error: 'Project not found in this business.' }); return }
    const result = await pool!.query(`SELECT COALESCE(SUM(hours * hourly_cost) FILTER (WHERE status = 'approved'), 0)::text AS approved_cost,
      COALESCE(SUM(hours) FILTER (WHERE status = 'approved'), 0)::text AS approved_hours,
      COALESCE(SUM(hours * hourly_cost) FILTER (WHERE status = 'approved' AND billable), 0)::text AS billable_value,
      COALESCE(SUM(hours * hourly_cost) FILTER (WHERE status = 'submitted'), 0)::text AS pending_cost
      FROM project_time_entries WHERE workspace_id = $1 AND project_id = $2`, [request.session!.workspaceId, request.params.projectId])
    const data = project.rows[0].data as Record<string, unknown>
    const approvedCost = Number(result.rows[0].approved_cost)
    const billableValueEstimate = Number(result.rows[0].billable_value)
    const budget = Number(data.budget ?? 0)
    response.json({
      project: data,
      ...result.rows[0],
      billableValueEstimate: billableValueEstimate.toFixed(2),
      estimatedBillableMargin: (billableValueEstimate - approvedCost).toFixed(2),
      budget: budget.toFixed(2),
      remainingBudgetEstimate: (budget - approvedCost).toFixed(2),
      profitabilityNote: 'Billable value is approved billable time valued at its entered hourly cost, not invoiced revenue. This is an estimate, not realized profit.',
    })
  } catch (error) { next(error) }
})

app.get('/v1/reports/budgets', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({ from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), to: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).safeParse(request.query)
  if (!input.success || input.data.from > input.data.to) { response.status(400).json({ error: 'Choose a valid YYYY-MM budget period range.' }); return }
  try {
    const result = await pool!.query(`SELECT b.id, b.account_code, a.name AS account_name, b.period, b.amount::text AS budget,
      COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND a.account_type = 'income' THEN l.credit - l.debit
        WHEN e.id IS NOT NULL THEN l.debit - l.credit ELSE 0 END), 0)::text AS actual
      FROM workspace_budgets b JOIN workspace_accounts a ON a.workspace_id = b.workspace_id AND a.code = b.account_code
      LEFT JOIN journal_lines l ON l.account_id = a.id
      LEFT JOIN journal_entries e ON e.id = l.journal_entry_id AND e.entry_date >= (b.period || '-01')::date AND e.entry_date < ((b.period || '-01')::date + interval '1 month')
      WHERE b.workspace_id = $1 AND b.period BETWEEN $2 AND $3
      GROUP BY b.id, b.account_code, a.name, b.period ORDER BY b.period, b.account_code`, [request.session!.workspaceId, input.data.from, input.data.to])
    response.json({ budgets: result.rows.map((row: Record<string, unknown>) => ({ ...row, variance: (Number(row.actual) - Number(row.budget)).toFixed(2) })) })
  } catch (error) { next(error) }
})
app.put('/v1/reports/budgets', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ accountCode: z.string().trim().regex(/^\d{4}$/), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), amount: z.coerce.number().finite().min(0).max(999999999999) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide a valid account code, YYYY-MM period, and non-negative KSh budget.' }); return }
  try {
    const account = await pool!.query('SELECT 1 FROM workspace_accounts WHERE workspace_id = $1 AND code = $2 AND active = true', [request.session!.workspaceId, input.data.accountCode])
    if (!account.rowCount) { response.status(404).json({ error: 'Active account not found in this business chart.' }); return }
    const result = await pool!.query(`INSERT INTO workspace_budgets (id, workspace_id, account_code, period, amount, created_by)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (workspace_id, account_code, period)
      DO UPDATE SET amount = EXCLUDED.amount RETURNING id, account_code, period, amount::text`,
    [randomUUID(), request.session!.workspaceId, input.data.accountCode, input.data.period, input.data.amount.toFixed(2), request.session!.userId])
    response.status(201).json({ budget: result.rows[0] })
  } catch (error) { next(error) }
})
app.get('/v1/reports/cash-flow-forecast', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query(`SELECT to_char(date_trunc('month', e.entry_date), 'YYYY-MM') AS period,
      COALESCE(SUM(l.debit), 0)::text AS inflows,
      COALESCE(SUM(l.credit), 0)::text AS outflows
      FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
      JOIN workspace_accounts a ON a.id = l.account_id
      WHERE e.workspace_id = $1 AND a.code = '1000' AND e.entry_date >= (current_date - interval '6 months')
      GROUP BY date_trunc('month', e.entry_date) ORDER BY period`, [request.session!.workspaceId])
    const history = result.rows.map((row: Record<string, unknown>) => ({ period: String(row.period), inflows: Number(row.inflows), outflows: Number(row.outflows), source: 'actual' }))
    const monthlyIncome = history.length ? history.reduce((sum: number, row: { inflows: number }) => sum + row.inflows, 0) / history.length : 0
    const monthlyExpenses = history.length ? history.reduce((sum: number, row: { outflows: number }) => sum + row.outflows, 0) / history.length : 0
    const now = new Date()
    const forecast = Array.from({ length: 3 }, (_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index + 1, 1))
      return { period: date.toISOString().slice(0, 7), income: Number(monthlyIncome.toFixed(2)), expenses: Number(monthlyExpenses.toFixed(2)), source: 'historical-average-estimate' }
    })
    response.json({ history, forecast, assumptions: 'Forecast repeats the average monthly cash inflows and outflows from the available prior six months; it is not a guarantee or a projected cash balance.' })
  } catch (error) { next(error) }
})

app.get('/v1/recurring', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, template_type, description, counterparty, amount::text, account, frequency, next_date, active FROM recurring_templates WHERE workspace_id = $1 ORDER BY next_date', [request.session!.workspaceId])
    response.json({ templates: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/recurring', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ type: z.enum(['invoice', 'expense']), description: z.string().trim().min(1).max(240), counterparty: z.string().trim().max(160).default(''), amount: z.coerce.number().finite().positive().max(999999999999), account: z.string().trim().max(80).default('Operating expenses'), frequency: z.enum(['monthly', 'quarterly', 'annually']), nextDate: z.string().date() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide a valid recurring invoice or expense schedule.' }); return }
  try {
    const result = await pool!.query(`INSERT INTO recurring_templates (id, workspace_id, template_type, description, counterparty, amount, account, frequency, next_date, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, template_type, next_date, active`,
    [randomUUID(), request.session!.workspaceId, input.data.type, input.data.description, input.data.counterparty, input.data.amount.toFixed(2), input.data.account, input.data.frequency, input.data.nextDate, request.session!.userId])
    response.status(201).json({ template: result.rows[0] })
  } catch (error) { next(error) }
})
app.post('/v1/recurring/:templateId/run', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('SELECT * FROM recurring_templates WHERE id = $1 AND workspace_id = $2 AND active = true FOR UPDATE', [request.params.templateId, request.session!.workspaceId])
    const template = result.rows[0]
    const currentDate = nairobiToday()
    if (!template) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Active recurring schedule not found.' }); return }
    const nextDate = template.next_date instanceof Date ? template.next_date.toISOString().slice(0, 10) : String(template.next_date).slice(0, 10)
    if (nextDate > currentDate) { await client.query('ROLLBACK'); response.status(409).json({ error: `This schedule is next due on ${nextDate}.` }); return }
    const entryDate = nextDate
    const amount = Number(template.amount)
    const generatedId = randomUUID()
    if (template.template_type === 'invoice') {
      const invoice = await client.query('INSERT INTO invoices (id, workspace_id, customer, description, amount, due_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [generatedId, request.session!.workspaceId, template.counterparty || 'Recurring customer', template.description, amount.toFixed(2), entryDate])
      await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: entryDate, description: `Recurring invoice: ${template.description}`, sourceType: 'recurring_invoice', sourceId: String(invoice.rows[0].id), lines: [{ accountCode: '1100', debit: amount, credit: 0 }, { accountCode: '4000', debit: 0, credit: amount }] })
    } else {
      await client.query('INSERT INTO ledger_transactions (id, workspace_id, description, amount, direction, account, transaction_date) VALUES ($1, $2, $3, $4, $5, $6, $7)', [generatedId, request.session!.workspaceId, template.description, amount.toFixed(2), 'expense', template.account, entryDate])
      await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: entryDate, description: `Recurring expense: ${template.description}`, sourceType: 'recurring_expense', sourceId: generatedId, lines: [{ accountCode: '6000', debit: amount, credit: 0 }, { accountCode: '1000', debit: 0, credit: amount }] })
    }
    const dueDate = new Date(`${entryDate}T00:00:00Z`)
    dueDate.setUTCMonth(dueDate.getUTCMonth() + (template.frequency === 'monthly' ? 1 : template.frequency === 'quarterly' ? 3 : 12))
    await client.query('UPDATE recurring_templates SET next_date = $1 WHERE id = $2', [dueDate.toISOString().slice(0, 10), template.id])
    await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'recurring.generated', entityType: 'recurring_template', entityId: String(template.id), eventData: { generatedId, type: template.template_type, date: entryDate, amount } })
    await client.query('COMMIT')
    response.status(201).json({ generatedId, date: entryDate, nextDate: dueDate.toISOString().slice(0, 10) })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})

app.get('/v1/reports/aging', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({ asOf: z.string().date().default(nairobiToday()) }).safeParse(request.query)
  if (!input.success) { response.status(400).json({ error: 'Use a valid YYYY-MM-DD as-of date.' }); return }
  try {
    const [receivables, payables] = await Promise.all([
      pool!.query(`SELECT i.id, i.customer AS counterparty,
        GREATEST(i.amount - i.amount_paid - COALESCE(r.returned_amount, 0) + COALESCE(r.refunded_amount, 0), 0)::text AS amount_due,
        i.due_date
        FROM invoices i LEFT JOIN (
          SELECT invoice_id, SUM(amount) AS returned_amount, SUM(refund_amount) AS refunded_amount
          FROM sales_returns WHERE workspace_id = $1 GROUP BY invoice_id
        ) r ON r.invoice_id = i.id
        WHERE i.workspace_id = $1 AND i.status <> 'void'
          AND i.amount - i.amount_paid - COALESCE(r.returned_amount, 0) + COALESCE(r.refunded_amount, 0) > 0
        ORDER BY i.due_date`, [request.session!.workspaceId, input.data.asOf]),
      pool!.query(`SELECT id, supplier AS counterparty, amount::text, amount_paid::text, due_date FROM vendor_bills
        WHERE workspace_id = $1 AND status <> 'void' AND amount > amount_paid ORDER BY due_date`, [request.session!.workspaceId]),
    ])
    const addDaysOverdue = (rows: Array<Record<string, unknown>>) => rows.map((row) => {
      const dueDate = row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : String(row.due_date).slice(0, 10)
      const asOf = new Date(`${input.data.asOf}T00:00:00.000Z`).getTime()
      const due = new Date(`${dueDate}T00:00:00.000Z`).getTime()
      return { ...row, due_date: dueDate, days_overdue: Math.max(0, Math.floor((asOf - due) / 86_400_000)) }
    })
    const receivableRows = addDaysOverdue(receivables.rows)
    const payableRows = addDaysOverdue(payables.rows)
    const buckets = (rows: Array<Record<string, unknown>>) => {
      const totals = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 }
      for (const row of rows) {
        const due = Number(row.amount_due ?? (Number(row.amount) - Number(row.amount_paid)))
        const days = Number(row.days_overdue)
        if (days <= 0) totals.current += due
        else if (days <= 30) totals.days1to30 += due
        else if (days <= 60) totals.days31to60 += due
        else if (days <= 90) totals.days61to90 += due
        else totals.over90 += due
      }
      return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toFixed(2)]))
    }
    response.json({ asOf: input.data.asOf, receivables: { items: receivableRows, buckets: buckets(receivableRows) }, payables: { items: payableRows, buckets: buckets(payableRows) } })
  } catch (error) { next(error) }
})
app.get('/v1/reports/retail', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  const locationId = typeof request.query.locationId === 'string' ? request.query.locationId : undefined
  if (locationId && !z.string().uuid().safeParse(locationId).success) { response.status(400).json({ error: 'Choose a valid stock location.' }); return }
  const client = await pool!.connect()
  try {
    await ensureDefaultInventoryLocation(client, request.session!.workspaceId)
    const locations = await client.query('SELECT id, name, code, is_default FROM inventory_locations WHERE workspace_id = $1 AND active = true ORDER BY is_default DESC, name', [request.session!.workspaceId])
    const stock = await client.query(`SELECT s.location_id, s.item_id, s.quantity::text, l.name AS location_name, r.data
      FROM inventory_location_stock s
      JOIN inventory_locations l ON l.id = s.location_id
      JOIN workspace_records r ON r.id = s.item_id AND r.workspace_id = s.workspace_id AND r.record_type = 'inventory'
      WHERE s.workspace_id = $1 AND l.active = true AND ($2::uuid IS NULL OR s.location_id = $2)
      ORDER BY r.data->>'name', l.name`, [request.session!.workspaceId, locationId ?? null])
    const sales = await client.query(`SELECT il.item_id, il.quantity::text, il.returned_quantity::text, il.unit_price::text,
      il.discount_amount::text, il.description, r.data
      FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
      LEFT JOIN workspace_records r ON r.id = il.item_id AND r.workspace_id = i.workspace_id
      WHERE i.workspace_id = $1 AND i.status <> 'void' AND il.item_id IS NOT NULL`, [request.session!.workspaceId])
    const costs = await client.query(`SELECT item_id,
      SUM(CASE WHEN movement_type = 'sale' THEN -quantity_delta * unit_cost
        WHEN movement_type = 'purchase' AND reference LIKE 'Return %' THEN quantity_delta * unit_cost ELSE 0 END)::text AS net_cost
      FROM inventory_movements WHERE workspace_id = $1 GROUP BY item_id`, [request.session!.workspaceId])
    const costByItem = new Map<string, number>(costs.rows.map((row: { item_id: unknown; net_cost: unknown }) => [String(row.item_id), Number(row.net_cost ?? 0)]))
    const productMap = new Map<string, { itemId: string; name: string; quantitySold: number; revenue: number; cost: number }>()
    for (const row of sales.rows as Array<{ item_id: unknown; data: unknown; quantity: string; returned_quantity: string; discount_amount: string; unit_price: string; description: string }>) {
      const id = String(row.item_id)
      const data = row.data as Record<string, unknown> | null
      const quantity = Math.max(0, Number(row.quantity) - Number(row.returned_quantity))
      const discount = Number(row.discount_amount) * (Number(row.quantity) > 0 ? quantity / Number(row.quantity) : 0)
      const revenue = Math.max(0, quantity * Number(row.unit_price) - discount)
      const prior = productMap.get(id) ?? { itemId: id, name: String(data?.name ?? row.description), quantitySold: 0, revenue: 0, cost: costByItem.get(id) ?? 0 }
      prior.quantitySold += quantity
      prior.revenue += revenue
      productMap.set(id, prior)
    }
    const stockLevels = stock.rows.map((row: { data: unknown; quantity: string; item_id: unknown; location_id: unknown; location_name: unknown }) => {
      const data = row.data as Record<string, unknown>
      const quantity = Number(row.quantity)
      const cost = Number(data.cost ?? 0)
      const reorderPoint = Number(data.reorderPoint ?? 0)
      return { itemId: String(row.item_id), locationId: String(row.location_id), location: String(row.location_name), name: String(data.name ?? 'Inventory item'), quantity, unit: String(data.unit ?? 'unit'), unitCost: cost, valuation: Number((quantity * cost).toFixed(2)), reorderPoint, needsReorder: reorderPoint > 0 && quantity <= reorderPoint }
    })
    const bestSellers = [...productMap.values()].map((item) => ({ ...item, revenue: Number(item.revenue.toFixed(2)), cost: Number(item.cost.toFixed(2)), grossProfit: Number((item.revenue - item.cost).toFixed(2)) }))
      .sort((left, right) => right.quantitySold - left.quantitySold).slice(0, 20)
    response.json({ locations: locations.rows, stockLevels, reorderAlerts: stockLevels.filter((item: { needsReorder: boolean }) => item.needsReorder), totalValuation: Number(stockLevels.reduce((sum: number, item: { valuation: number }) => sum + item.valuation, 0).toFixed(2)), bestSellers })
  } catch (error) { next(error) }
  finally { client.release() }
})

app.get('/v1/settings', requirePool, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT preferences FROM workspace_settings WHERE workspace_id = $1', [request.session!.workspaceId])
    const workspaceResult = await pool!.query('SELECT name FROM workspaces WHERE id = $1', [request.session!.workspaceId])
    const preferences = { ...defaultWorkspaceSettings, ...(result.rows[0]?.preferences ?? {}) }
    const businessName = workspaceResult.rows[0]?.name ?? preferences.businessName ?? ''
    response.json({ settings: { ...preferences, businessName } })
  } catch (error) { next(error) }
})
app.put('/v1/settings', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({
    businessName: z.string().trim().min(1).max(120),
    currency: z.enum(['KES', 'USD', 'GBP']),
    timezone: z.enum(['Africa/Nairobi', 'UTC', 'Africa/Kampala']),
    invoiceTerms: z.enum(['Net 7', 'Net 14', 'Net 30']),
    emailAlerts: z.boolean(),
    auditTrail: z.boolean(),
    twoFactor: z.boolean(),
    backupSchedule: z.enum(['Daily automatic', 'Weekly automatic', 'Manual only']),
    monoEnabled: z.boolean().default(false),
    darajaEnabled: z.boolean().default(false),
    kraEtimsLiveEnabled: z.boolean().default(false),
    statutoryFilingsEnabled: z.boolean().default(false),
    shifEnabled: z.boolean().default(false),
    nssfEnabled: z.boolean().default(false),
    ahlEnabled: z.boolean().default(false),
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'One or more settings are invalid.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    await client.query('UPDATE workspaces SET name = $1 WHERE id = $2', [input.data.businessName, request.session!.workspaceId])
    const preferences = { ...defaultWorkspaceSettings, ...input.data, businessName: input.data.businessName }
    await client.query('INSERT INTO workspace_settings (workspace_id, preferences) VALUES ($1, $2::jsonb) ON CONFLICT (workspace_id) DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = now()', [request.session!.workspaceId, JSON.stringify(preferences)])
    await client.query('COMMIT')
    response.json({ settings: preferences })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})

app.get('/v1/documents', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, file_name, mime_type, file_size, created_at FROM workspace_documents WHERE workspace_id = $1 ORDER BY created_at DESC', [request.session!.workspaceId])
    response.json({ documents: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/documents', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({ fileName: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(150), fileData: z.string().min(1).max(7_000_000) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide a file up to 5 MB with a valid name and content.' }); return }
  const data = Buffer.from(input.data.fileData, 'base64')
  if (!data.length || data.length > 5 * 1024 * 1024 || data.toString('base64') !== input.data.fileData.replace(/\s/g, '')) { response.status(413).json({ error: 'Documents must be valid base64 files no larger than 5 MB.' }); return }
  try {
    const result = await pool!.query('INSERT INTO workspace_documents (workspace_id, file_name, mime_type, file_size, file_data) VALUES ($1, $2, $3, $4, $5) RETURNING id, file_name, mime_type, file_size, created_at', [request.session!.workspaceId, input.data.fileName.replace(/[\\/\0]/g, '_'), input.data.mimeType, data.length, data])
    response.status(201).json({ document: result.rows[0] })
  } catch (error) { next(error) }
})
app.get('/v1/documents/:documentId/content', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT file_name, mime_type, file_data FROM workspace_documents WHERE id = $1 AND workspace_id = $2', [request.params.documentId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(404).json({ error: 'Document not found in this workspace.' }); return }
    response.json({ fileName: result.rows[0].file_name, mimeType: result.rows[0].mime_type, fileData: Buffer.from(result.rows[0].file_data).toString('base64') })
  } catch (error) { next(error) }
})
app.delete('/v1/documents/:documentId', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('DELETE FROM workspace_documents WHERE id = $1 AND workspace_id = $2 RETURNING id', [request.params.documentId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(404).json({ error: 'Document not found in this workspace.' }); return }
    response.status(204).end()
  } catch (error) { next(error) }
})

function csvValue(value: unknown) {
  const text = value == null ? '' : typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const safe = /^[\t\r\n ]*[=+\-@]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}
app.get('/v1/exports/:type', requirePool, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const type = z.enum(['customers', 'suppliers', 'inventory', 'projects', 'invoices', 'bills', 'transactions', 'journals', 'audit']).safeParse(request.params.type)
  if (!type.success) { response.status(404).json({ error: 'Choose customers, suppliers, inventory, projects, invoices, bills, transactions, journals, or audit.' }); return }
  try {
    const workspaceId = request.session!.workspaceId
    let headers: string[]
    let rows: Record<string, unknown>[]
    if (['customers', 'suppliers', 'inventory', 'projects'].includes(type.data)) {
      const columnsByType: Record<string, string[]> = {
        customers: ['name', 'email', 'phone', 'address', 'taxPin', 'notes'],
        suppliers: ['name', 'email', 'phone', 'address', 'taxPin', 'notes'],
        inventory: ['name', 'sku', 'barcode', 'quantity', 'unit', 'cost', 'price', 'reorderPoint', 'notes'],
        projects: ['name', 'customer', 'status', 'startDate', 'endDate', 'budget', 'notes'],
      }
      const columns = columnsByType[type.data] ?? []
      headers = ['id', ...columns, 'createdAt', 'updatedAt']
      const result = await pool!.query(`SELECT id, data, created_at, updated_at FROM workspace_records
        WHERE workspace_id = $1 AND record_type = $2 ORDER BY created_at LIMIT 50000`,
      [workspaceId, workspaceRecordDatabaseTypes[type.data as keyof typeof workspaceRecordDatabaseTypes]])
      rows = result.rows.map((row: Record<string, unknown>) => {
        const data = row.data as Record<string, unknown>
        const output: Record<string, unknown> = { id: row.id }
        for (const key of columns) output[key] = data[key]
        output.createdAt = row.created_at
        output.updatedAt = row.updated_at
        return output
      })
    } else if (type.data === 'invoices') {
      headers = ['id', 'customer', 'customerEmail', 'description', 'amount', 'amountPaid', 'dueDate', 'status', 'createdAt']
      const result = await pool!.query('SELECT id, customer, customer_email, description, amount, amount_paid, due_date, status, created_at FROM invoices WHERE workspace_id = $1 ORDER BY created_at LIMIT 50000', [workspaceId])
      rows = result.rows.map((row: Record<string, unknown>) => ({ id: row.id, customer: row.customer, customerEmail: row.customer_email, description: row.description, amount: row.amount, amountPaid: row.amount_paid, dueDate: row.due_date, status: row.status, createdAt: row.created_at }))
    } else if (type.data === 'bills') {
      headers = ['id', 'supplier', 'description', 'amount', 'amountPaid', 'billDate', 'dueDate', 'status', 'approvalStatus', 'createdAt']
      const result = await pool!.query('SELECT id, supplier, description, amount, amount_paid, bill_date, due_date, status, approval_status, created_at FROM vendor_bills WHERE workspace_id = $1 ORDER BY created_at LIMIT 50000', [workspaceId])
      rows = result.rows.map((row: Record<string, unknown>) => ({ id: row.id, supplier: row.supplier, description: row.description, amount: row.amount, amountPaid: row.amount_paid, billDate: row.bill_date, dueDate: row.due_date, status: row.status, approvalStatus: row.approval_status, createdAt: row.created_at }))
    } else if (type.data === 'transactions') {
      headers = ['id', 'description', 'amount', 'direction', 'account', 'date', 'createdAt']
      const result = await pool!.query('SELECT id, description, amount, direction, account, transaction_date, created_at FROM ledger_transactions WHERE workspace_id = $1 ORDER BY transaction_date, created_at LIMIT 50000', [workspaceId])
      rows = result.rows.map((row: Record<string, unknown>) => ({ id: row.id, description: row.description, amount: row.amount, direction: row.direction, account: row.account, date: row.transaction_date, createdAt: row.created_at }))
    } else if (type.data === 'journals') {
      headers = ['journalId', 'date', 'description', 'sourceType', 'accountCode', 'accountName', 'lineDescription', 'debit', 'credit']
      const result = await pool!.query(`SELECT e.id, e.entry_date, e.description, e.source_type, a.code, a.name AS account_name,
          l.description AS line_description, l.debit, l.credit
        FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
        JOIN workspace_accounts a ON a.id = l.account_id
        WHERE e.workspace_id = $1 ORDER BY e.entry_date, e.id, a.code LIMIT 50000`, [workspaceId])
      rows = result.rows.map((row: Record<string, unknown>) => ({ journalId: row.id, date: row.entry_date, description: row.description, sourceType: row.source_type, accountCode: row.code, accountName: row.account_name, lineDescription: row.line_description, debit: row.debit, credit: row.credit }))
    } else {
      headers = ['id', 'actorUserId', 'eventType', 'entityType', 'entityId', 'eventData', 'createdAt']
      const result = await pool!.query('SELECT id, actor_user_id, event_type, entity_type, entity_id, event_data, created_at FROM audit_events WHERE workspace_id = $1 ORDER BY created_at LIMIT 50000', [workspaceId])
      rows = result.rows.map((row: Record<string, unknown>) => ({ id: row.id, actorUserId: row.actor_user_id, eventType: row.event_type, entityType: row.entity_type, entityId: row.entity_id, eventData: row.event_data, createdAt: row.created_at }))
    }
    const csv = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? row[header.charAt(0).toLowerCase() + header.slice(1)] ?? ''))]
      .map((line) => line.map(csvValue).join(',')).join('\r\n')
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader('Content-Disposition', `attachment; filename="kashflow-${type.data}-${new Date().toISOString().slice(0, 10)}.csv"`)
    response.send(`\uFEFF${csv}`)
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
    for (const account of defaultChartOfAccounts) {
      await client.query('INSERT INTO workspace_accounts (id, workspace_id, code, name, account_type) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), workspaceId, account.code, account.name, account.type])
    }
    await client.query('COMMIT')
    setSessionCookie(response, { ...request.session!, workspaceId })
    response.status(201).json({ workspace: { id: workspace.rows[0].id, name: workspace.rows[0].name, role: membership.rows[0].role } })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})

app.post('/v1/workspaces/:workspaceId/invitations', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    role: z.string().trim().min(1).max(60),
    scope: z.enum(['single', 'all_owned']).default('single'),
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide a valid email and workspace role.' }); return }
  if (request.params.workspaceId !== request.session!.workspaceId) { response.status(403).json({ error: 'Invitations can only be created for the active business.' }); return }

  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const currentMember = await client.query('SELECT role FROM workspace_members WHERE user_id = $1 AND workspace_id = $2', [request.session!.userId, request.session!.workspaceId])
    if (!currentMember.rowCount || (currentMember.rows[0].role !== 'admin' && !(request.workspacePermissions ?? []).includes('team.manage'))) {
      await client.query('ROLLBACK'); response.status(403).json({ error: 'Team management permission is required to invite members.' }); return
    }
    const customRole = await client.query('SELECT role_key FROM custom_workspace_roles WHERE workspace_id = $1 AND role_key = $2', [request.session!.workspaceId, input.data.role])
    if (!['accountant', 'staff', 'viewer'].includes(input.data.role) && !customRole.rowCount) {
      await client.query('ROLLBACK'); response.status(400).json({ error: 'Choose an existing built-in or custom business role.' }); return
    }
    if (customRole.rowCount && input.data.scope === 'all_owned') {
      await client.query('ROLLBACK'); response.status(400).json({ error: 'Custom roles are business-specific. Invite this role to the current business only.' }); return
    }

    let targets: Array<{ workspace_id: string; name: string }> = []
    if (input.data.scope === 'all_owned') {
      const result = await client.query('SELECT wm.workspace_id, w.name FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = $1 AND wm.role = $2 ORDER BY w.name', [request.session!.userId, 'admin'])
      targets = result.rows as Array<{ workspace_id: string; name: string }>
    } else {
      const result = await client.query('SELECT id AS workspace_id, name FROM workspaces WHERE id = $1', [request.session!.workspaceId])
      targets = result.rows as Array<{ workspace_id: string; name: string }>
    }
    if (!targets.length) { await client.query('ROLLBACK'); response.status(403).json({ error: 'No businesses are available for this invitation.' }); return }

    const inviteToken = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(inviteToken).digest('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const invite = await client.query(`INSERT INTO workspace_invitations (workspace_id, email, role, scope, invited_by, token_hash, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, role, scope, status, expires_at`,
    [request.session!.workspaceId, input.data.email, input.data.role, input.data.scope, request.session!.userId, tokenHash, expiresAt])
    for (const target of targets) {
      await client.query('INSERT INTO invitation_workspaces (id, invitation_id, workspace_id) VALUES ($1, $2, $3)', [randomUUID(), invite.rows[0].id, target.workspace_id])
    }
    await client.query('COMMIT')
    const invitationUrl = new URL('/', env.FRONTEND_ORIGIN)
    invitationUrl.searchParams.set('invite', inviteToken)
    if (!emailConfigured) {
      response.status(201).json({ invitation: { ...invite.rows[0], businesses: targets.map((target) => target.name) }, delivery: 'manual_link', invitationUrl: invitationUrl.toString() })
      return
    }
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [input.data.email],
        subject: `You are invited to ${targets.map((target) => target.name).join(', ')}`,
        html: `<main style="font-family:Arial,sans-serif;color:#242537"><h1>KashFlow workspace invitation</h1><p>You have been invited as ${escapeHtml(input.data.role)} to ${escapeHtml(targets.map((target) => target.name).join(', '))}.</p><p>This invitation expires in seven days. Sign in or create an account using this email, then accept the invitation:</p><p><a href="${escapeHtml(invitationUrl.toString())}">Review invitation</a></p></main>`,
        text: `You have been invited as ${input.data.role} to ${targets.map((target) => target.name).join(', ')}. Sign in or create an account using this email, then accept within seven days: ${invitationUrl.toString()}`,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const emailPayload = await emailResponse.json().catch(() => ({})) as { id?: string; message?: string }
    if (!emailResponse.ok || !emailPayload.id) {
      await pool!.query("UPDATE workspace_invitations SET status = 'declined' WHERE id = $1 AND status = 'pending'", [invite.rows[0].id])
      response.status(502).json({ error: `Invitation email was not accepted by the provider: ${String(emailPayload.message ?? `HTTP ${emailResponse.status}`).slice(0, 300)}` })
      return
    }
    response.status(201).json({ invitation: { ...invite.rows[0], businesses: targets.map((target) => target.name) }, delivery: 'accepted_by_provider' })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})
app.get('/v1/workspaces/:workspaceId/invitations', requirePool, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  if (request.params.workspaceId !== request.session!.workspaceId) { response.status(403).json({ error: 'Invitations can only be viewed for the active business.' }); return }
  try {
    const result = await pool!.query('SELECT id, email, role, scope, status, expires_at, accepted_at, created_at FROM workspace_invitations WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 100', [request.session!.workspaceId])
    response.json({ invitations: result.rows })
  } catch (error) { next(error) }
})
app.get('/v1/workspaces/:workspaceId/roles', requirePool, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  if (request.params.workspaceId !== request.session!.workspaceId) { response.status(403).json({ error: 'Roles can only be managed for the active business.' }); return }
  try {
    const result = await pool!.query('SELECT id, role_key, role_name, permissions FROM custom_workspace_roles WHERE workspace_id = $1 ORDER BY role_name', [request.session!.workspaceId])
    response.json({ roles: result.rows.map((role: Record<string, unknown>) => ({ id: String(role.id), roleKey: String(role.role_key), roleName: String(role.role_name), permissions: role.permissions })) })
  } catch (error) { next(error) }
})
app.post('/v1/workspaces/:workspaceId/roles', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  if (request.params.workspaceId !== request.session!.workspaceId) { response.status(403).json({ error: 'Roles can only be managed for the active business.' }); return }
  const input = z.object({
    name: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/),
    permissions: z.array(z.enum(workspacePermissionNames)).max(workspacePermissionNames.length),
  }).safeParse(request.body)
  if (!input.success || new Set(input.data.permissions).size !== input.data.permissions.length) { response.status(400).json({ error: 'Enter a role name and select unique supported permissions.' }); return }
  const roleKey = input.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!roleKey || ['admin', 'accountant', 'staff', 'viewer'].includes(roleKey)) { response.status(400).json({ error: 'Choose a name that does not conflict with a built-in role.' }); return }
  try {
    const result = await pool!.query(`INSERT INTO custom_workspace_roles (id, workspace_id, role_key, role_name, permissions)
      VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id, role_key, role_name, permissions`,
    [randomUUID(), request.session!.workspaceId, roleKey, input.data.name, JSON.stringify(input.data.permissions)])
    const role = result.rows[0]
    response.status(201).json({ role: { id: String(role.id), roleKey: String(role.role_key), roleName: String(role.role_name), permissions: role.permissions } })
  } catch (error) {
    if ((error as { code?: string }).code === '23505') { response.status(409).json({ error: 'A role with that name already exists in this business.' }); return }
    next(error)
  }
})
app.put('/v1/workspaces/:workspaceId/roles/:roleKey', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  if (request.params.workspaceId !== request.session!.workspaceId) { response.status(403).json({ error: 'Roles can only be managed for the active business.' }); return }
  const input = z.object({ permissions: z.array(z.enum(workspacePermissionNames)).max(workspacePermissionNames.length) }).safeParse(request.body)
  if (!input.success || new Set(input.data.permissions).size !== input.data.permissions.length) { response.status(400).json({ error: 'Select unique supported permissions.' }); return }
  try {
    const result = await pool!.query(`UPDATE custom_workspace_roles SET permissions = $1::jsonb, updated_at = now()
      WHERE workspace_id = $2 AND role_key = $3 RETURNING id, role_key, role_name, permissions`,
    [JSON.stringify(input.data.permissions), request.session!.workspaceId, request.params.roleKey])
    if (!result.rowCount) { response.status(404).json({ error: 'Custom role not found.' }); return }
    const role = result.rows[0]
    response.json({ role: { id: String(role.id), roleKey: String(role.role_key), roleName: String(role.role_name), permissions: role.permissions } })
  } catch (error) { next(error) }
})
app.get('/v1/workspaces/:workspaceId/members', requirePool, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  if (request.params.workspaceId !== request.session!.workspaceId) { response.status(403).json({ error: 'Members can only be managed for the active business.' }); return }
  try {
    const result = await pool!.query(`SELECT wm.user_id, wm.role, wm.permissions, u.email, u.phone
      FROM workspace_members wm JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1 ORDER BY wm.role, u.email, u.phone`, [request.session!.workspaceId])
    const customRoles = await pool!.query('SELECT role_key, permissions FROM custom_workspace_roles WHERE workspace_id = $1', [request.session!.workspaceId])
    const customPermissions = new Map(customRoles.rows.map((role: Record<string, unknown>) => [String(role.role_key), role.permissions as WorkspacePermission[]]))
    response.json({ members: result.rows.map((member: Record<string, unknown>) => ({
      userId: String(member.user_id),
      role: String(member.role),
      email: member.email ?? '',
      phone: member.phone ?? '',
      permissions: Array.isArray(member.permissions) ? member.permissions : null,
      defaultPermissions: rolePermissionDefaults[String(member.role)] ?? customPermissions.get(String(member.role)) ?? [],
    })) })
  } catch (error) { next(error) }
})
app.put('/v1/workspaces/:workspaceId/members/:userId/permissions', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  if (request.params.workspaceId !== request.session!.workspaceId) { response.status(403).json({ error: 'Members can only be managed for the active business.' }); return }
  const input = z.object({
    role: z.string().trim().min(1).max(80).optional(),
    permissions: z.array(z.enum(workspacePermissionNames)).max(workspacePermissionNames.length).nullable().optional(),
  }).refine((value) => value.role !== undefined || value.permissions !== undefined).safeParse(request.body)
  if (!input.success || (Array.isArray(input.data.permissions) && new Set(input.data.permissions).size !== input.data.permissions.length)) {
    response.status(400).json({ error: 'Choose a valid role and a unique list of supported permissions, or inherit the role permissions.' }); return
  }
  try {
    if (input.data.role) {
      if (input.data.role === 'admin') { response.status(400).json({ error: 'Administrator access is protected. Assign an administrator through the workspace owner workflow.' }); return }
      const builtInRole = ['accountant', 'staff', 'viewer'].includes(input.data.role)
      if (!builtInRole) {
        const role = await pool!.query('SELECT 1 FROM custom_workspace_roles WHERE workspace_id = $1 AND role_key = $2', [request.session!.workspaceId, input.data.role])
        if (!role.rowCount) { response.status(400).json({ error: 'Choose a built-in or custom role that exists in this business.' }); return }
      }
    }
    const permissions = input.data.permissions === undefined
      ? input.data.role ? null : undefined
      : input.data.permissions === null ? null : JSON.stringify(input.data.permissions)
    const result = await pool!.query(`UPDATE workspace_members SET
        role = COALESCE($1, role),
        permissions = CASE WHEN $2 THEN $3::jsonb ELSE permissions END
      WHERE workspace_id = $4 AND user_id = $5 AND role <> 'admin'
      RETURNING user_id, role, permissions`,
    [input.data.role ?? null, permissions !== undefined, permissions ?? null, request.session!.workspaceId, request.params.userId])
    if (!result.rowCount) { response.status(404).json({ error: 'Non-admin workspace member not found.' }); return }
    const member = result.rows[0]
    const defaults = await pool!.query('SELECT permissions FROM custom_workspace_roles WHERE workspace_id = $1 AND role_key = $2', [request.session!.workspaceId, member.role])
    response.json({ member: { userId: String(member.user_id), role: String(member.role), permissions: member.permissions, defaultPermissions: rolePermissionDefaults[String(member.role)] ?? defaults.rows[0]?.permissions ?? [] } })
  } catch (error) { next(error) }
})
app.post('/v1/invitations/accept', requirePool, verifyOrigin, async (request, response, next) => {
  const input = z.object({ token: z.string().min(32).max(200), email: emailSchema.optional(), password: passwordSchema.optional() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide a valid invitation token.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const tokenHash = createHash('sha256').update(input.data.token).digest('hex')
    const inviteResult = await client.query(`SELECT i.id, i.email, i.role FROM workspace_invitations i
      WHERE i.token_hash = $1 AND i.status = 'pending' AND i.expires_at > now() FOR UPDATE`, [tokenHash])
    const invite = inviteResult.rows[0]
    if (!invite) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Invitation is invalid, expired, or already used.' }); return }
    const targets = await client.query('SELECT workspace_id FROM invitation_workspaces WHERE invitation_id = $1 ORDER BY workspace_id', [invite.id])
    if (!targets.rowCount) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Invitation has no associated businesses.' }); return }
    const session = readSession(cookies(request.headers.cookie)[cookieName])
    let userId = session?.userId
    if (session) {
      const user = await client.query('SELECT email FROM users WHERE id = $1', [session.userId])
      if (String(user.rows[0]?.email ?? '').toLowerCase() !== String(invite.email).toLowerCase()) {
        await client.query('ROLLBACK')
        response.status(403).json({ error: 'Sign in using the email address that received this invitation.' })
        return
      }
    } else {
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [invite.email])
      if (existing.rowCount) {
        await client.query('ROLLBACK')
        response.status(401).json({ error: 'This email already has an account. Sign in with it, then accept the invitation.' })
        return
      }
      if (!input.data.password || !input.data.email || input.data.email.toLowerCase() !== String(invite.email).toLowerCase()) {
        await client.query('ROLLBACK')
        response.status(400).json({ error: 'For a new account, use the invited email address and choose a password of at least 12 characters.' })
        return
      }
      userId = randomUUID()
      await client.query('INSERT INTO users (id, workspace_id, email, password_hash) VALUES ($1, $2, $3, $4)', [userId, targets.rows[0].workspace_id, invite.email, await hashPassword(input.data.password)])
    }
    for (const target of targets.rows) {
      await client.query('INSERT INTO workspace_members (user_id, workspace_id, role) VALUES ($1, $2, $3) ON CONFLICT (user_id, workspace_id) DO NOTHING', [userId, target.workspace_id, invite.role])
    }
    await client.query("UPDATE workspace_invitations SET status = 'accepted', accepted_at = now(), token_hash = NULL WHERE id = $1", [invite.id])
    await client.query('COMMIT')
    const workspaceId = String(targets.rows[0].workspace_id)
    setSessionCookie(response, { userId: userId!, workspaceId, expiresAt: Date.now() + sessionTtlSeconds * 1000 })
    response.json({ accepted: true, workspaceId, role: invite.role })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})
app.post('/v1/workspaces/:workspaceId/activate', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query(`SELECT wm.role, w.name FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = $1 AND wm.workspace_id = $2`, [request.session!.userId, request.params.workspaceId])
    if (!result.rowCount) { response.status(404).json({ error: 'You are not a member of that business.' }); return }
    setSessionCookie(response, { ...request.session!, workspaceId: String(request.params.workspaceId) })
    response.json({ workspace: { id: String(request.params.workspaceId), name: result.rows[0].name, role: result.rows[0].role } })
  } catch (error) { next(error) }
})

const commercialLineSchema = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(240),
  quantity: z.coerce.number().finite().positive().max(1_000_000),
  unitPrice: z.coerce.number().finite().min(0).max(999999999999),
  discountAmount: z.coerce.number().finite().min(0).max(999999999999).default(0),
  taxAmount: z.coerce.number().finite().min(0).max(999999999999).default(0),
  recoverableTaxAmount: z.coerce.number().finite().min(0).max(999999999999).default(0),
})
type CommercialLine = z.infer<typeof commercialLineSchema>
function calculateCommercialLines(lines: CommercialLine[]) {
  let subtotalCents = 0
  let taxCents = 0
  let recoverableTaxCents = 0
  const normalized = lines.map((line) => {
    const baseCents = Math.round(line.quantity * Math.round(line.unitPrice * 100))
    const discountCents = Math.round(line.discountAmount * 100)
    const lineTaxCents = Math.round(line.taxAmount * 100)
    const recoverableCents = Math.round(line.recoverableTaxAmount * 100)
    if (discountCents > baseCents || recoverableCents > lineTaxCents) throw new Error('Discount cannot exceed its line subtotal and recoverable tax cannot exceed tax charged.')
    const lineSubtotal = baseCents - discountCents
    const totalCents = lineSubtotal + lineTaxCents
    subtotalCents += lineSubtotal
    taxCents += lineTaxCents
    recoverableTaxCents += recoverableCents
    return { ...line, discountAmount: (discountCents / 100).toFixed(2), taxAmount: (lineTaxCents / 100).toFixed(2), recoverableTaxAmount: (recoverableCents / 100).toFixed(2), totalAmount: (totalCents / 100).toFixed(2) }
  })
  return { lines: normalized, subtotal: subtotalCents / 100, tax: taxCents / 100, recoverableTax: recoverableTaxCents / 100, total: (subtotalCents + taxCents) / 100 }
}

app.get('/v1/invoices', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query(`SELECT i.id, i.customer, i.customer_email, i.description, i.amount::text, i.amount_paid::text,
      COALESCE(r.returned_amount, 0)::text AS returned_amount, COALESCE(r.refunded_amount, 0)::text AS refunded_amount,
      GREATEST(i.amount - i.amount_paid - COALESCE(r.returned_amount, 0) + COALESCE(r.refunded_amount, 0), 0)::text AS amount_due,
      i.due_date, i.status, i.created_at
      FROM invoices i LEFT JOIN (
        SELECT invoice_id, SUM(amount) AS returned_amount, SUM(refund_amount) AS refunded_amount
        FROM sales_returns WHERE workspace_id = $1 GROUP BY invoice_id
      ) r ON r.invoice_id = i.id
      WHERE i.workspace_id = $1 ORDER BY i.created_at DESC LIMIT 100`, [request.session!.workspaceId])
    response.json({ invoices: result.rows })
  } catch (error) { next(error) }
})
app.get('/v1/invoices/:invoiceId/lines', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query(`SELECT il.id, il.item_id, il.description, il.quantity::text, il.returned_quantity::text,
      il.unit_price::text, il.discount_amount::text, il.tax_amount::text, il.total_amount::text
      FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
      WHERE i.workspace_id = $1 AND i.id = $2 ORDER BY il.line_number`, [request.session!.workspaceId, request.params.invoiceId])
    response.json({ lines: result.rows })
  } catch (error) { next(error) }
})

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}
async function createInvoicePublicLink(workspaceId: string, invoiceId: string, userId: string) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  await pool!.query(`INSERT INTO invoice_public_links (workspace_id, invoice_id, token_hash, expires_at, created_by)
    VALUES ($1, $2, $3, $4, $5)`,
  [workspaceId, invoiceId, createHash('sha256').update(token).digest('hex'), expiresAt.toISOString(), userId])
  return { url: new URL(`/invoice/${token}`, env.FRONTEND_ORIGIN).toString(), expiresAt: expiresAt.toISOString() }
}
app.get('/v1/public/invoices/:token', requirePool, rateLimit({ windowMs: 15 * 60_000, limit: 60 }), async (request, response, next) => {
  const token = z.string().regex(/^[A-Za-z0-9_-]{40,50}$/).safeParse(request.params.token)
  if (!token.success) { response.status(404).json({ error: 'Invoice link is invalid or has expired.' }); return }
  try {
    const result = await pool!.query(`SELECT i.id, i.customer, i.description, i.amount::text, i.amount_paid::text, i.due_date, i.status,
        w.name AS business_name, l.expires_at
      FROM invoice_public_links l JOIN invoices i ON i.id = l.invoice_id AND i.workspace_id = l.workspace_id
      JOIN workspaces w ON w.id = i.workspace_id
      WHERE l.token_hash = $1 AND l.revoked_at IS NULL AND l.expires_at > now() AND i.status <> 'void'`,
    [createHash('sha256').update(token.data).digest('hex')])
    const invoice = result.rows[0]
    if (!invoice) { response.status(404).json({ error: 'Invoice link is invalid or has expired.' }); return }
    const [lines, returns] = await Promise.all([
      pool!.query('SELECT description, quantity::text, unit_price::text, total_amount::text FROM invoice_lines WHERE invoice_id = $1 ORDER BY line_number', [invoice.id]),
      pool!.query('SELECT COALESCE(SUM(amount), 0)::text AS returned, COALESCE(SUM(refund_amount), 0)::text AS refunded FROM sales_returns WHERE invoice_id = $1', [invoice.id]),
    ])
    const amountDue = Math.max(0, Number(invoice.amount) - Number(invoice.amount_paid) - Number(returns.rows[0].returned) + Number(returns.rows[0].refunded))
    response.json({ invoice: { id: invoice.id, customer: invoice.customer, description: invoice.description, amount: invoice.amount, amountPaid: invoice.amount_paid, amountDue: amountDue.toFixed(2), dueDate: invoice.due_date, status: invoice.status, businessName: invoice.business_name, expiresAt: invoice.expires_at }, lines: lines.rows })
  } catch (error) { next(error) }
})
app.post('/v1/invoices/:invoiceId/customer-link', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  try {
    const invoice = await pool!.query("SELECT id FROM invoices WHERE id = $1 AND workspace_id = $2 AND status <> 'void'", [request.params.invoiceId, request.session!.workspaceId])
    if (!invoice.rowCount) { response.status(404).json({ error: 'Open invoice not found.' }); return }
    response.status(201).json({ link: await createInvoicePublicLink(request.session!.workspaceId, String(invoice.rows[0].id), request.session!.userId) })
  } catch (error) { next(error) }
})
app.post('/v1/invoices/:invoiceId/reminders', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  if (!emailConfigured) { response.status(503).json({ error: 'Outbound email is not configured. Set RESEND_API_KEY and EMAIL_FROM on the API service.' }); return }
  try {
    const result = await pool!.query(`SELECT i.id, i.customer, i.customer_email, i.description, i.amount::text, i.amount_paid::text, i.due_date,
        COALESCE(r.returned, 0)::text AS returned, COALESCE(r.refunded, 0)::text AS refunded
      FROM invoices i LEFT JOIN (
        SELECT invoice_id, SUM(amount) AS returned, SUM(refund_amount) AS refunded FROM sales_returns WHERE workspace_id = $1 GROUP BY invoice_id
      ) r ON r.invoice_id = i.id
      WHERE i.id = $2 AND i.workspace_id = $1 AND i.status = 'unpaid'`,
    [request.session!.workspaceId, request.params.invoiceId])
    const invoice = result.rows[0]
    if (!invoice) { response.status(404).json({ error: 'Open invoice not found.' }); return }
    const recipient = String(invoice.customer_email ?? '').trim()
    if (!recipient) { response.status(409).json({ error: 'Add a customer email to this invoice before sending a reminder.' }); return }
    const amountDue = Number(invoice.amount) - Number(invoice.amount_paid) - Number(invoice.returned) + Number(invoice.refunded)
    if (amountDue <= 0) { response.status(409).json({ error: 'This invoice has no outstanding balance.' }); return }
    const publicLink = await createInvoicePublicLink(request.session!.workspaceId, String(invoice.id), request.session!.userId)
    const business = await pool!.query('SELECT name FROM workspaces WHERE id = $1', [request.session!.workspaceId])
    const businessName = String(business.rows[0]?.name ?? 'KashFlow business')
    const amount = amountDue.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const invoiceNumber = String(invoice.id).slice(0, 8).toUpperCase()
    const responseFromProvider = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [recipient],
        subject: `Payment reminder · Invoice ${invoiceNumber} · ${businessName}`,
        html: `<main style="font-family:Arial,sans-serif;color:#242537;max-width:640px;margin:auto"><h1>Payment reminder</h1><p>Hello ${escapeHtml(String(invoice.customer))},</p><p>Invoice ${invoiceNumber} from ${escapeHtml(businessName)} has an outstanding balance of <strong>KSh ${amount}</strong>.</p><p><a href="${escapeHtml(publicLink.url)}">View invoice details</a></p><p>This is an internal invoice, not a KRA/eTIMS fiscal tax invoice. This reminder does not collect payment.</p></main>`,
        text: `Hello ${String(invoice.customer)},\n\nInvoice ${invoiceNumber} from ${businessName} has an outstanding balance of KSh ${amount}.\nView invoice details: ${publicLink.url}\n\nThis is not a KRA/eTIMS fiscal tax invoice. This reminder does not collect payment.`,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const providerPayload = await responseFromProvider.json().catch(() => ({})) as { id?: string; message?: string }
    const accepted = responseFromProvider.ok && Boolean(providerPayload.id)
    await pool!.query(`INSERT INTO invoice_reminder_events (workspace_id, invoice_id, recipient, delivery_status, provider_message_id, failure_reason, sent_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [request.session!.workspaceId, invoice.id, recipient, accepted ? 'accepted' : 'failed', providerPayload.id ?? null, accepted ? null : String(providerPayload.message ?? `Provider returned HTTP ${responseFromProvider.status}`).slice(0, 500), request.session!.userId])
    if (!accepted) { response.status(502).json({ error: 'Email provider did not accept the reminder. Check the API service logs and sender-domain configuration.' }); return }
    response.status(202).json({ status: 'accepted', recipient, message: 'Reminder accepted by the email provider; recipient delivery is not guaranteed.' })
  } catch (error) { next(error) }
})
app.get('/v1/invoices/:invoiceId/reminders', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query(`SELECT id, recipient, delivery_status, provider_message_id, failure_reason, created_at
      FROM invoice_reminder_events WHERE workspace_id = $1 AND invoice_id = $2 ORDER BY created_at DESC LIMIT 30`,
    [request.session!.workspaceId, request.params.invoiceId])
    response.json({ events: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/invoices/:invoiceId/email', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  if (!emailConfigured) { response.status(503).json({ error: 'Outbound email is not configured. Set RESEND_API_KEY and EMAIL_FROM on the API service.' }); return }
  try {
    const result = await pool!.query('SELECT id, customer, customer_email, description, amount::text, due_date, status FROM invoices WHERE id = $1 AND workspace_id = $2', [request.params.invoiceId, request.session!.workspaceId])
    const invoiceRow = result.rows[0]
    if (!invoiceRow) { response.status(404).json({ error: 'Invoice not found in this business.' }); return }
    const recipient = String(invoiceRow.customer_email ?? '').trim()
    if (!recipient) { response.status(409).json({ error: 'Add a customer email to this invoice before sending.' }); return }
    if (invoiceRow.status === 'void') { response.status(409).json({ error: 'Voided invoices cannot be sent.' }); return }
    const invoiceNumber = String(invoiceRow.id).slice(0, 8).toUpperCase()
    const customer = escapeHtml(String(invoiceRow.customer))
    const description = escapeHtml(String(invoiceRow.description))
    const dueDate = escapeHtml(new Date(String(invoiceRow.due_date)).toISOString().slice(0, 10))
    const amount = Number(invoiceRow.amount).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const origin = await pool!.query('SELECT name FROM workspaces WHERE id = $1', [request.session!.workspaceId])
    const businessName = String(origin.rows[0]?.name ?? 'KashFlow business')
    const html = `<main style="font-family:Arial,sans-serif;color:#242537;max-width:640px;margin:auto"><h1>Invoice ${invoiceNumber}</h1><p>Hello ${customer},</p><p>Please find your invoice from ${escapeHtml(businessName)}.</p><table style="border-collapse:collapse;width:100%"><tr><th align="left" style="padding:12px;border-bottom:1px solid #ddd">Description</th><th align="right" style="padding:12px;border-bottom:1px solid #ddd">Amount (KSh)</th></tr><tr><td style="padding:12px;border-bottom:1px solid #ddd">${description}</td><td align="right" style="padding:12px;border-bottom:1px solid #ddd">${amount}</td></tr></table><p>Due date: ${dueDate}</p><p>This is an internal invoice, not a KRA/eTIMS fiscal tax invoice.</p></main>`
    const providerResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [recipient], subject: `Invoice ${invoiceNumber} from ${businessName}`, html, text: `Hello ${String(invoiceRow.customer)},\n\nInvoice ${invoiceNumber} from ${businessName}: ${String(invoiceRow.description)} — KSh ${amount}. Due ${dueDate}.\n\nThis is not a KRA/eTIMS fiscal tax invoice.` }),
      signal: AbortSignal.timeout(15_000),
    })
    const providerPayload = await providerResponse.json().catch(() => ({})) as { id?: string; message?: string }
    const deliveryId = randomUUID()
    if (!providerResponse.ok || !providerPayload.id) {
      await pool!.query('INSERT INTO email_delivery_events (id, workspace_id, invoice_id, recipient, provider, status, failure_reason) VALUES ($1, $2, $3, $4, $5, $6, $7)', [deliveryId, request.session!.workspaceId, invoiceRow.id, recipient, 'resend', 'failed', String(providerPayload.message ?? `Provider returned HTTP ${providerResponse.status}`).slice(0, 500)])
      response.status(502).json({ error: 'Email provider did not accept the invoice. Check the API service logs and Resend sender-domain configuration.' }); return
    }
    await pool!.query('INSERT INTO email_delivery_events (id, workspace_id, invoice_id, recipient, provider, status, provider_message_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', [deliveryId, request.session!.workspaceId, invoiceRow.id, recipient, 'resend', 'accepted', providerPayload.id])
    response.status(202).json({ delivery: { id: deliveryId, status: 'accepted', providerMessageId: providerPayload.id, recipient }, message: 'Email accepted by Resend; recipient delivery is not guaranteed.' })
  } catch (error) { next(error) }
})
app.get('/v1/invoices/:invoiceId/email-history', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const invoice = await pool!.query('SELECT id FROM invoices WHERE id = $1 AND workspace_id = $2', [request.params.invoiceId, request.session!.workspaceId])
    if (!invoice.rowCount) { response.status(404).json({ error: 'Invoice not found in this business.' }); return }
    const result = await pool!.query('SELECT id, recipient, provider, status, provider_message_id, failure_reason, created_at FROM email_delivery_events WHERE invoice_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT 20', [request.params.invoiceId, request.session!.workspaceId])
    response.json({ events: result.rows })
  } catch (error) { next(error) }
})

app.patch('/v1/invoices/:invoiceId/status', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const input = z.object({ status: z.enum(['unpaid', 'paid', 'void']) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Status must be unpaid, paid, or void.' }); return }
  if (input.data.status === 'paid') { response.status(409).json({ error: 'Invoices can only be marked paid after a recorded payment or verified M-Pesa callback.' }); return }
  try {
    const result = await pool!.query('UPDATE invoices SET status = $1 WHERE id = $2 AND workspace_id = $3 RETURNING id, status', [input.data.status, request.params.invoiceId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(404).json({ error: 'Invoice not found in this workspace.' }); return }
    response.json({ invoice: result.rows[0] })
  } catch (error) { next(error) }
})

app.post('/v1/invoices/:invoiceId/payments', requirePool, verifyOrigin, requireSession, requireAccountingRole, async (request: AuthedRequest, response, next) => {
  const input = z.object({ amount: z.coerce.number().finite().positive().max(999999999999), paymentDate: z.string().date() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a positive payment amount and valid payment date.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query(`SELECT id, customer, description, amount::text, amount_paid::text
      FROM invoices WHERE id = $1 AND workspace_id = $2 AND status = 'unpaid' FOR UPDATE`, [request.params.invoiceId, request.session!.workspaceId])
    const invoice = found.rows[0]
    if (!invoice) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Open invoice not found.' }); return }
    const returns = await client.query('SELECT COALESCE(SUM(amount), 0)::text AS returned, COALESCE(SUM(refund_amount), 0)::text AS refunded FROM sales_returns WHERE invoice_id = $1', [invoice.id])
    const due = Number(invoice.amount) - Number(invoice.amount_paid) - Number(returns.rows[0].returned) + Number(returns.rows[0].refunded)
    if (Math.round(input.data.amount * 100) > Math.round(due * 100)) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Payment cannot exceed the outstanding invoice balance.' }); return }
    const paymentId = randomUUID()
    await client.query('INSERT INTO invoice_payments (id, workspace_id, invoice_id, amount, payment_date, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [paymentId, request.session!.workspaceId, invoice.id, input.data.amount.toFixed(2), input.data.paymentDate, request.session!.userId])
    const updated = await client.query(`UPDATE invoices SET amount_paid = amount_paid + $1,
      status = CASE WHEN amount_paid + $1 >= amount
        - COALESCE((SELECT SUM(amount) FROM sales_returns WHERE invoice_id = $2), 0)
        + COALESCE((SELECT SUM(refund_amount) FROM sales_returns WHERE invoice_id = $2), 0)
        THEN 'paid' ELSE 'unpaid' END
      WHERE id = $2 AND workspace_id = $3 RETURNING amount::text, amount_paid::text, status`, [input.data.amount.toFixed(2), invoice.id, request.session!.workspaceId])
    await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: input.data.paymentDate, description: `Invoice payment: ${invoice.customer} — ${invoice.description}`, sourceType: 'invoice_payment', sourceId: paymentId, lines: [{ accountCode: '1000', debit: input.data.amount, credit: 0 }, { accountCode: '1100', debit: 0, credit: input.data.amount }] })
    await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'invoice.payment_recorded', entityType: 'invoice', entityId: String(invoice.id), eventData: { paymentId, amount: input.data.amount, paymentDate: input.data.paymentDate } })
    await client.query('COMMIT')
    response.status(201).json({ payment: { id: paymentId, amount: input.data.amount.toFixed(2), ...updated.rows[0] } })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})
app.get('/v1/invoices/:invoiceId/returns', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query(`SELECT id, amount::text, refund_amount::text, reason, return_date, created_at
      FROM sales_returns WHERE workspace_id = $1 AND invoice_id = $2 ORDER BY created_at DESC`, [request.session!.workspaceId, request.params.invoiceId])
    response.json({ returns: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/invoices/:invoiceId/returns', requirePool, verifyOrigin, requireSession, requireAccountingRole, async (request: AuthedRequest, response, next) => {
  const input = z.object({
    reason: z.string().trim().min(2).max(500),
    returnDate: z.string().date(),
    refundAmount: z.coerce.number().finite().min(0).max(999999999999).default(0),
    restock: z.boolean().default(true),
    lines: z.array(z.object({ invoiceLineId: z.string().uuid(), quantity: z.coerce.number().finite().positive().max(1_000_000) })).min(1).max(100),
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a reason, date, and one or more returned invoice lines.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query(`SELECT id, customer, description, amount::text, amount_paid::text, location_id
      FROM invoices WHERE id = $1 AND workspace_id = $2 AND status <> 'void' FOR UPDATE`, [request.params.invoiceId, request.session!.workspaceId])
    const invoice = found.rows[0]
    if (!invoice) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Invoice not found or voided.' }); return }
    const prior = await client.query('SELECT COALESCE(SUM(amount), 0)::text AS returned, COALESCE(SUM(refund_amount), 0)::text AS refunded FROM sales_returns WHERE invoice_id = $1', [invoice.id])
    const availableRefund = Math.max(0, Number(invoice.amount_paid) - Number(prior.rows[0].refunded))
    if (input.data.refundAmount > availableRefund) { await client.query('ROLLBACK'); response.status(409).json({ error: `Refund cannot exceed collected cash still available to refund (${availableRefund.toFixed(2)}).` }); return }
    const processedLineIds = new Set<string>()
    let returnedCents = 0
    let returnedSubtotalCents = 0
    let returnedTaxCents = 0
    let costOfGoodsReturned = 0
    const details: Array<{ lineId: string; itemId: string | null; quantity: number; amountCents: number }> = []
    for (const returned of input.data.lines) {
      if (processedLineIds.has(returned.invoiceLineId)) { await client.query('ROLLBACK'); response.status(400).json({ error: 'Each invoice line may appear only once in a return.' }); return }
      processedLineIds.add(returned.invoiceLineId)
      const lineResult = await client.query(`SELECT id, item_id, description, quantity::text, returned_quantity::text, unit_price::text,
        discount_amount::text, tax_amount::text, total_amount::text
        FROM invoice_lines WHERE id = $1 AND invoice_id = $2 FOR UPDATE`, [returned.invoiceLineId, invoice.id])
      const line = lineResult.rows[0]
      if (!line || returned.quantity > Number(line.quantity) - Number(line.returned_quantity)) { await client.query('ROLLBACK'); response.status(409).json({ error: 'A returned quantity exceeds the unreturned quantity on this invoice.' }); return }
      const ratio = returned.quantity / Number(line.quantity)
      const lineBaseCents = Math.round(Number(line.quantity) * Math.round(Number(line.unit_price) * 100))
      const returnedBaseCents = Math.round(lineBaseCents * ratio)
      const returnedDiscountCents = Math.round(Number(line.discount_amount) * 100 * ratio)
      const returnedLineTaxCents = Math.round(Number(line.tax_amount) * 100 * ratio)
      const subtotalCents = returnedBaseCents - returnedDiscountCents
      const amountCents = subtotalCents + returnedLineTaxCents
      if (amountCents <= 0) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Returned invoice line has no positive value to credit.' }); return }
      returnedCents += amountCents
      returnedSubtotalCents += subtotalCents
      returnedTaxCents += returnedLineTaxCents
      details.push({ lineId: String(line.id), itemId: line.item_id ? String(line.item_id) : null, quantity: returned.quantity, amountCents })
      await client.query('UPDATE invoice_lines SET returned_quantity = returned_quantity + $1 WHERE id = $2', [returned.quantity.toFixed(3), line.id])
      if (input.data.restock && line.item_id) {
        const itemResult = await client.query("SELECT data FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'inventory' FOR UPDATE", [line.item_id, request.session!.workspaceId])
        const itemData = itemResult.rows[0]?.data as Record<string, unknown> | undefined
        if (!itemData) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Inventory item for this return no longer exists.' }); return }
        const nextQuantity = Number((Number(itemData.quantity ?? 0) + returned.quantity).toFixed(3))
        await client.query('UPDATE workspace_records SET data = $1::jsonb, updated_at = now() WHERE id = $2 AND workspace_id = $3', [JSON.stringify({ ...itemData, quantity: nextQuantity }), line.item_id, request.session!.workspaceId])
        const locationId = await ensureInventoryLocation(client, request.session!.workspaceId, invoice.location_id ? String(invoice.location_id) : undefined)
        if (!locationId) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Invoice stock location is no longer active.' }); return }
        await client.query(`INSERT INTO inventory_location_stock (workspace_id, location_id, item_id, quantity)
          VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, location_id, item_id)
          DO UPDATE SET quantity = inventory_location_stock.quantity + EXCLUDED.quantity, updated_at = now()`,
        [request.session!.workspaceId, locationId, line.item_id, returned.quantity.toFixed(3)])
        const unitCost = Number(itemData.cost ?? 0)
        costOfGoodsReturned += returned.quantity * unitCost
        await client.query(`INSERT INTO inventory_movements (id, workspace_id, item_id, location_id, movement_type, quantity_delta, unit_cost, reference, moved_at, created_by)
          VALUES ($1, $2, $3, $4, 'purchase', $5, $6, $7, $8, $9)`,
        [randomUUID(), request.session!.workspaceId, line.item_id, locationId, returned.quantity.toFixed(3), unitCost.toFixed(2), `Return ${String(invoice.id).slice(0, 8)}`, input.data.returnDate, request.session!.userId])
      }
    }
    const amount = returnedCents / 100
    if (input.data.refundAmount > amount) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Cash refund cannot exceed the return credit amount.' }); return }
    const returnId = randomUUID()
    await client.query('INSERT INTO sales_returns (id, workspace_id, invoice_id, amount, refund_amount, reason, return_date, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [returnId, request.session!.workspaceId, invoice.id, amount.toFixed(2), input.data.refundAmount.toFixed(2), input.data.reason, input.data.returnDate, request.session!.userId])
    for (const line of details) await client.query('INSERT INTO sales_return_lines (id, return_id, invoice_line_id, item_id, quantity, amount) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), returnId, line.lineId, line.itemId, line.quantity.toFixed(3), (line.amountCents / 100).toFixed(2)])
    const creditToReceivable = amount - input.data.refundAmount
    const totalReturned = Number(prior.rows[0].returned) + amount
    const totalRefunded = Number(prior.rows[0].refunded) + input.data.refundAmount
    const remainingDueCents = Math.round((Number(invoice.amount) - Number(invoice.amount_paid) - totalReturned + totalRefunded) * 100)
    await client.query("UPDATE invoices SET status = CASE WHEN $1 > 0 THEN 'unpaid' ELSE 'paid' END WHERE id = $2 AND workspace_id = $3", [remainingDueCents, invoice.id, request.session!.workspaceId])
    const journalLines: JournalLineInput[] = []
    if (returnedSubtotalCents > 0) journalLines.push({ accountCode: '4000', debit: returnedSubtotalCents / 100, credit: 0 })
    if (returnedTaxCents > 0) journalLines.push({ accountCode: '2150', debit: returnedTaxCents / 100, credit: 0 })
    if (input.data.refundAmount > 0) journalLines.push({ accountCode: '1000', debit: 0, credit: input.data.refundAmount })
    if (creditToReceivable > 0) journalLines.push({ accountCode: '1100', debit: 0, credit: creditToReceivable })
    if (costOfGoodsReturned > 0) journalLines.push({ accountCode: '1200', debit: Number(costOfGoodsReturned.toFixed(2)), credit: 0 }, { accountCode: '5100', debit: 0, credit: Number(costOfGoodsReturned.toFixed(2)) })
    await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: input.data.returnDate, description: `Sales return: ${invoice.customer} — ${input.data.reason}`, sourceType: 'sales_return', sourceId: returnId, lines: journalLines })
    await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'sales.return_recorded', entityType: 'invoice', entityId: String(invoice.id), eventData: { returnId, amount, refundAmount: input.data.refundAmount, restocked: input.data.restock } })
    await client.query('COMMIT')
    response.status(201).json({ return: { id: returnId, amount: amount.toFixed(2), refundAmount: input.data.refundAmount.toFixed(2), status: input.data.refundAmount > 0 ? 'refund_recorded' : 'credit_issued' } })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})

app.post('/v1/transactions', requirePool, verifyOrigin, requireSession, requireAccountingRole, async (request: AuthedRequest, response, next) => {
  const input = z.object({ description: z.string().trim().min(1).max(240), amount: z.coerce.number().finite().positive().max(999999999999), direction: z.enum(['income', 'expense']), account: z.string().trim().min(1).max(80), date: z.string().date() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a description, positive amount, transaction type, account, and valid date.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const id = randomUUID()
    const result = await client.query('INSERT INTO ledger_transactions (id, workspace_id, description, amount, direction, account, transaction_date) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, description, amount::text, direction, account, transaction_date, created_at', [id, request.session!.workspaceId, input.data.description, input.data.amount.toFixed(2), input.data.direction, input.data.account, input.data.date])
    const amount = input.data.amount
    const lines: JournalLineInput[] = input.data.direction === 'income'
      ? [{ accountCode: '1000', debit: amount, credit: 0 }, { accountCode: '4000', debit: 0, credit: amount }]
      : [{ accountCode: '6000', debit: amount, credit: 0 }, { accountCode: '1000', debit: 0, credit: amount }]
    await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: input.data.date, description: input.data.description, sourceType: 'transaction', sourceId: id, lines })
    await client.query('COMMIT')
    response.status(201).json({ transaction: result.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  }
  finally { client.release() }
})

app.post('/v1/invoices', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const input = z.object({
    customer: z.string().trim().min(1).max(160),
    customerEmail: z.string().trim().email().max(254).or(z.literal('')).default(''),
    locationId: z.string().uuid().optional(),
    idempotencyKey: z.string().uuid().optional(),
    description: z.string().trim().min(1).max(240).optional(),
    amount: z.coerce.number().finite().positive().max(999999999999).optional(),
    lines: z.array(commercialLineSchema.omit({ recoverableTaxAmount: true })).min(1).max(100).optional(),
    dueDate: z.string().date(),
  }).superRefine((value, context) => {
    if (!value.lines && (!value.description || !value.amount)) context.addIssue({ code: 'custom', message: 'Provide invoice lines or a description and amount.' })
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a customer, invoice lines (or description and amount), and a valid due date.' }); return }
  let financials: ReturnType<typeof calculateCommercialLines>
  try {
    const lines = input.data.lines ?? [{ description: input.data.description!, quantity: 1, unitPrice: input.data.amount!, discountAmount: 0, taxAmount: 0, recoverableTaxAmount: 0 }]
    financials = calculateCommercialLines(lines.map((line) => ({ ...line, recoverableTaxAmount: 0 })))
  } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Invoice line amounts are invalid.' }); return }
  if (financials.total <= 0) { response.status(400).json({ error: 'Invoice total must be greater than zero.' }); return }
  const description = input.data.description ?? financials.lines.map((line) => line.description).join('; ').slice(0, 240)
  const requestHash = input.data.idempotencyKey
    ? createHash('sha256').update(JSON.stringify({ ...input.data, idempotencyKey: undefined })).digest('hex')
    : null
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    if (input.data.idempotencyKey && requestHash) {
      const lockId = createHash('sha256').update(`${request.session!.workspaceId}:${input.data.idempotencyKey}`).digest().readBigInt64BE(0).toString()
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockId])
      const prior = await client.query('SELECT request_hash, invoice_id FROM invoice_idempotency_keys WHERE workspace_id = $1 AND idempotency_key = $2 FOR UPDATE', [request.session!.workspaceId, input.data.idempotencyKey])
      if (prior.rowCount) {
        if (prior.rows[0].request_hash !== requestHash) {
          await client.query('ROLLBACK')
          response.status(409).json({ error: 'This checkout retry key was already used for different sale details. Start a new checkout.' })
          return
        }
        if (!prior.rows[0]?.invoice_id) {
          await client.query('ROLLBACK')
          response.status(409).json({ error: 'The earlier checkout is still being finalized. Retry it shortly.' })
          return
        }
        const priorInvoice = await client.query('SELECT id, customer, customer_email, description, amount::text, due_date, status, created_at FROM invoices WHERE id = $1 AND workspace_id = $2', [prior.rows[0].invoice_id, request.session!.workspaceId])
        if (!priorInvoice.rowCount) throw new Error('A checkout retry key references an invoice that is no longer available.')
        await client.query('COMMIT')
        response.status(200).json({ invoice: priorInvoice.rows[0], idempotentReplay: true })
        return
      }
      await client.query('INSERT INTO invoice_idempotency_keys (workspace_id, idempotency_key, request_hash) VALUES ($1, $2, $3)', [request.session!.workspaceId, input.data.idempotencyKey, requestHash])
    }
    const id = randomUUID()
    const locationId = financials.lines.some((line) => line.itemId) || input.data.locationId ? await ensureInventoryLocation(client, request.session!.workspaceId, input.data.locationId) : null
    if (financials.lines.some((line) => line.itemId) && !locationId) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Active stock location not found.' }); return }
    const result = await client.query('INSERT INTO invoices (id, workspace_id, customer, customer_email, description, amount, due_date, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, customer, customer_email, description, amount::text, due_date, status, created_at', [id, request.session!.workspaceId, input.data.customer, input.data.customerEmail, description, financials.total.toFixed(2), input.data.dueDate, locationId])
    if (input.data.idempotencyKey) {
      await client.query('UPDATE invoice_idempotency_keys SET invoice_id = $1 WHERE workspace_id = $2 AND idempotency_key = $3', [id, request.session!.workspaceId, input.data.idempotencyKey])
    }
    let costOfGoodsSold = 0
    for (const [index, line] of financials.lines.entries()) {
      if (line.itemId) {
        const item = await client.query("SELECT data FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'inventory' FOR UPDATE", [line.itemId, request.session!.workspaceId])
        const itemData = item.rows[0]?.data as Record<string, unknown> | undefined
        if (!itemData) { await client.query('ROLLBACK'); response.status(400).json({ error: 'A sales line references an inventory item that is not in this business.' }); return }
        const onHand = Number(itemData.quantity ?? 0)
        const locationStock = await client.query('SELECT quantity::text FROM inventory_location_stock WHERE workspace_id = $1 AND location_id = $2 AND item_id = $3 FOR UPDATE', [request.session!.workspaceId, locationId, line.itemId])
        const localOnHand = Number(locationStock.rows[0]?.quantity ?? 0)
        if (line.quantity > localOnHand || line.quantity > onHand) { await client.query('ROLLBACK'); response.status(409).json({ error: `Not enough stock for ${String(itemData.name ?? 'this item')} at the selected location. Available: ${localOnHand}.` }); return }
        const itemCost = Number(itemData.cost ?? 0)
        const nextQuantity = Number((onHand - line.quantity).toFixed(3))
        await client.query('UPDATE workspace_records SET data = $1::jsonb, updated_at = now() WHERE id = $2 AND workspace_id = $3', [JSON.stringify({ ...itemData, quantity: nextQuantity }), line.itemId, request.session!.workspaceId])
        await client.query('UPDATE inventory_location_stock SET quantity = quantity - $1, updated_at = now() WHERE workspace_id = $2 AND location_id = $3 AND item_id = $4', [line.quantity.toFixed(3), request.session!.workspaceId, locationId, line.itemId])
        const movementId = randomUUID()
        await client.query("INSERT INTO inventory_movements (id, workspace_id, item_id, location_id, movement_type, quantity_delta, unit_cost, reference, moved_at, created_by) VALUES ($1, $2, $3, $4, 'sale', $5, $6, $7, $8, $9)", [movementId, request.session!.workspaceId, line.itemId, locationId, (-line.quantity).toFixed(3), itemCost.toFixed(2), `Invoice ${id.slice(0, 8)}`, nairobiToday(), request.session!.userId])
        costOfGoodsSold += line.quantity * itemCost
      }
      await client.query('INSERT INTO invoice_lines (id, invoice_id, line_number, item_id, description, quantity, unit_price, discount_amount, tax_amount, total_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [randomUUID(), id, index + 1, line.itemId ?? null, line.description, line.quantity.toFixed(3), line.unitPrice.toFixed(2), line.discountAmount, line.taxAmount, line.totalAmount])
    }
    const journalLines: JournalLineInput[] = [{ accountCode: '1100', debit: financials.total, credit: 0 }]
    if (financials.subtotal > 0) journalLines.push({ accountCode: '4000', debit: 0, credit: financials.subtotal })
    if (financials.tax > 0) journalLines.push({ accountCode: '2150', debit: 0, credit: financials.tax })
    if (costOfGoodsSold > 0) journalLines.push({ accountCode: '5100', debit: Number(costOfGoodsSold.toFixed(2)), credit: 0 }, { accountCode: '1200', debit: 0, credit: Number(costOfGoodsSold.toFixed(2)) })
    await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: nairobiToday(), description: `Invoice: ${input.data.customer} — ${description}`, sourceType: 'invoice', sourceId: id, lines: journalLines })
    await client.query('COMMIT')
    response.status(201).json({ invoice: result.rows[0] })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})

app.get('/v1/estimates', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, customer, customer_email, description, amount::text, valid_until, status, invoice_id, created_at FROM estimates WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 200', [request.session!.workspaceId])
    response.json({ estimates: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/estimates', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const input = z.object({
    customer: z.string().trim().min(1).max(160),
    customerEmail: z.string().trim().email().max(254).or(z.literal('')).default(''),
    description: z.string().trim().min(1).max(240).optional(),
    amount: z.coerce.number().finite().positive().max(999999999999).optional(),
    lines: z.array(commercialLineSchema.omit({ recoverableTaxAmount: true })).min(1).max(100).optional(),
    validUntil: z.string().date(),
  }).superRefine((value, context) => {
    if (!value.lines && (!value.description || !value.amount)) context.addIssue({ code: 'custom', message: 'Provide estimate lines or a description and amount.' })
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a customer, estimate lines (or description and amount), and a valid expiry date.' }); return }
  let financials: ReturnType<typeof calculateCommercialLines>
  try {
    const lines = input.data.lines ?? [{ description: input.data.description!, quantity: 1, unitPrice: input.data.amount!, discountAmount: 0, taxAmount: 0 }]
    financials = calculateCommercialLines(lines.map((line) => ({ ...line, recoverableTaxAmount: 0 })))
  } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Estimate line amounts are invalid.' }); return }
  if (financials.total <= 0) { response.status(400).json({ error: 'Estimate total must be greater than zero.' }); return }
  const description = input.data.description ?? financials.lines.map((line) => line.description).join('; ').slice(0, 240)
  const client = await pool!.connect()
  try {
    const id = randomUUID()
    await client.query('BEGIN')
    const result = await client.query('INSERT INTO estimates (id, workspace_id, customer, customer_email, description, amount, valid_until) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, customer, customer_email, description, amount::text, valid_until, status, created_at', [id, request.session!.workspaceId, input.data.customer, input.data.customerEmail, description, financials.total.toFixed(2), input.data.validUntil])
    for (const [index, line] of financials.lines.entries()) {
      await client.query('INSERT INTO estimate_lines (id, estimate_id, line_number, item_id, description, quantity, unit_price, discount_amount, tax_amount, total_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [randomUUID(), id, index + 1, line.itemId ?? null, line.description, line.quantity.toFixed(3), line.unitPrice.toFixed(2), line.discountAmount, line.taxAmount, line.totalAmount])
    }
    await client.query('COMMIT')
    response.status(201).json({ estimate: result.rows[0] })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})
app.get('/v1/sales-orders', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query(`SELECT o.id, o.estimate_id, o.invoice_id, o.status, o.created_at, e.customer, e.description, e.amount::text
      FROM sales_orders o JOIN estimates e ON e.id = o.estimate_id
      WHERE o.workspace_id = $1 ORDER BY o.created_at DESC LIMIT 200`, [request.session!.workspaceId])
    response.json({ orders: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/estimates/:estimateId/order', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const estimate = await client.query("SELECT id FROM estimates WHERE id = $1 AND workspace_id = $2 AND status = 'accepted' AND invoice_id IS NULL FOR UPDATE", [request.params.estimateId, request.session!.workspaceId])
    if (!estimate.rowCount) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Only an accepted estimate can become an order.' }); return }
    const existing = await client.query('SELECT id, status FROM sales_orders WHERE workspace_id = $1 AND estimate_id = $2 FOR UPDATE', [request.session!.workspaceId, request.params.estimateId])
    if (existing.rows[0] && existing.rows[0].status !== 'cancelled') { await client.query('ROLLBACK'); response.status(409).json({ error: 'This estimate already has an active sales order.' }); return }
    const id = existing.rows[0]?.id ?? randomUUID()
    if (existing.rows[0]) {
      await client.query("UPDATE sales_orders SET status = 'confirmed', invoice_id = NULL, fulfilled_at = NULL WHERE id = $1 AND workspace_id = $2", [id, request.session!.workspaceId])
    } else {
      await client.query('INSERT INTO sales_orders (id, workspace_id, estimate_id, created_by) VALUES ($1, $2, $3, $4)', [id, request.session!.workspaceId, request.params.estimateId, request.session!.userId])
    }
    await client.query('COMMIT')
    response.status(201).json({ order: { id, estimateId: request.params.estimateId, status: 'confirmed' } })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})
app.patch('/v1/sales-orders/:orderId/status', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const input = z.object({ status: z.enum(['fulfilled', 'cancelled']) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Choose fulfilled or cancelled.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(`UPDATE sales_orders SET status = $1, fulfilled_at = CASE WHEN $1 = 'fulfilled' THEN now() ELSE fulfilled_at END
      WHERE id = $2 AND workspace_id = $3 AND status = 'confirmed' RETURNING id, estimate_id, status`,
    [input.data.status, request.params.orderId, request.session!.workspaceId])
    await client.query('COMMIT')
    if (!result.rowCount) { response.status(409).json({ error: 'Only a confirmed order can be fulfilled or cancelled.' }); return }
    response.json({ order: result.rows[0] })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})
app.patch('/v1/estimates/:estimateId/status', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const input = z.object({ status: z.enum(['sent', 'accepted', 'declined', 'void']) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Choose a valid estimate status.' }); return }
  try {
    const result = await pool!.query("UPDATE estimates SET status = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3 AND status IN ('draft', 'sent', 'accepted', 'declined') RETURNING id, status", [input.data.status, request.params.estimateId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(404).json({ error: 'Estimate not found or already converted.' }); return }
    response.json({ estimate: result.rows[0] })
  } catch (error) { next(error) }
})
app.post('/v1/estimates/:estimateId/convert', requirePool, verifyOrigin, requireSession, requireWorkspaceWriter, async (request: AuthedRequest, response, next) => {
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query("SELECT id, customer, customer_email, description, amount::text, status FROM estimates WHERE id = $1 AND workspace_id = $2 AND status = 'accepted' AND invoice_id IS NULL FOR UPDATE", [request.params.estimateId, request.session!.workspaceId])
    const estimate = found.rows[0]
    if (!estimate) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Only an accepted estimate that has not been converted can become an invoice.' }); return }
    const order = await client.query('SELECT id, status FROM sales_orders WHERE estimate_id = $1 AND workspace_id = $2 FOR UPDATE', [estimate.id, request.session!.workspaceId])
    if (order.rowCount && order.rows[0].status !== 'fulfilled') { await client.query('ROLLBACK'); response.status(409).json({ error: 'Fulfill the sales order before converting it to an invoice.' }); return }
    const invoiceId = randomUUID()
    const dueDate = z.string().date().safeParse(request.body?.dueDate)
    if (!dueDate.success) { await client.query('ROLLBACK'); response.status(400).json({ error: 'Provide a valid invoice due date.' }); return }
    const requestedLocation = z.string().uuid().optional().safeParse(request.body?.locationId)
    if (!requestedLocation.success) { await client.query('ROLLBACK'); response.status(400).json({ error: 'Choose a valid stock location.' }); return }
    const estimateLines = await client.query('SELECT line_number, item_id, description, quantity::text, unit_price::text, discount_amount::text, tax_amount::text, total_amount::text FROM estimate_lines WHERE estimate_id = $1 ORDER BY line_number', [estimate.id])
    const hasInventory = estimateLines.rows.some((line: Record<string, unknown>) => Boolean(line.item_id))
    const locationId = hasInventory || requestedLocation.data ? await ensureInventoryLocation(client, request.session!.workspaceId, requestedLocation.data) : null
    if (hasInventory && !locationId) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Active stock location not found.' }); return }
    const invoice = await client.query('INSERT INTO invoices (id, workspace_id, customer, customer_email, description, amount, due_date, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, customer, amount::text, due_date, status', [invoiceId, request.session!.workspaceId, estimate.customer, estimate.customer_email, estimate.description, estimate.amount, dueDate.data, locationId])
    let invoiceSubtotalCents = 0
    let invoiceTaxCents = 0
    let costOfGoodsSold = 0
    for (const line of estimateLines.rows) {
      const lineBaseCents = Math.round(Number(line.quantity) * Math.round(Number(line.unit_price) * 100))
      invoiceSubtotalCents += lineBaseCents - Math.round(Number(line.discount_amount) * 100)
      invoiceTaxCents += Math.round(Number(line.tax_amount) * 100)
      if (line.item_id) {
        const item = await client.query("SELECT data FROM workspace_records WHERE id = $1 AND workspace_id = $2 AND record_type = 'inventory' FOR UPDATE", [line.item_id, request.session!.workspaceId])
        const itemData = item.rows[0]?.data as Record<string, unknown> | undefined
        if (!itemData) { await client.query('ROLLBACK'); response.status(409).json({ error: 'This estimate refers to an inventory item that no longer exists.' }); return }
        const onHand = Number(itemData.quantity ?? 0)
        const quantity = Number(line.quantity)
        const locationStock = await client.query('SELECT quantity::text FROM inventory_location_stock WHERE workspace_id = $1 AND location_id = $2 AND item_id = $3 FOR UPDATE', [request.session!.workspaceId, locationId, line.item_id])
        const localOnHand = Number(locationStock.rows[0]?.quantity ?? 0)
        if (quantity > onHand || quantity > localOnHand) { await client.query('ROLLBACK'); response.status(409).json({ error: `Not enough stock for ${String(itemData.name ?? 'this item')} at the selected location. Available: ${localOnHand}.` }); return }
        const itemCost = Number(itemData.cost ?? 0)
        await client.query('UPDATE workspace_records SET data = $1::jsonb, updated_at = now() WHERE id = $2 AND workspace_id = $3', [JSON.stringify({ ...itemData, quantity: Number((onHand - quantity).toFixed(3)) }), line.item_id, request.session!.workspaceId])
        await client.query('UPDATE inventory_location_stock SET quantity = quantity - $1, updated_at = now() WHERE workspace_id = $2 AND location_id = $3 AND item_id = $4', [quantity.toFixed(3), request.session!.workspaceId, locationId, line.item_id])
        const movementId = randomUUID()
        await client.query("INSERT INTO inventory_movements (id, workspace_id, item_id, location_id, movement_type, quantity_delta, unit_cost, reference, moved_at, created_by) VALUES ($1, $2, $3, $4, 'sale', $5, $6, $7, $8, $9)", [movementId, request.session!.workspaceId, line.item_id, locationId, (-quantity).toFixed(3), itemCost.toFixed(2), `Invoice ${invoiceId.slice(0, 8)}`, nairobiToday(), request.session!.userId])
        costOfGoodsSold += quantity * itemCost
      }
      await client.query('INSERT INTO invoice_lines (id, invoice_id, line_number, item_id, description, quantity, unit_price, discount_amount, tax_amount, total_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [randomUUID(), invoiceId, line.line_number, line.item_id, line.description, line.quantity, line.unit_price, line.discount_amount, line.tax_amount, line.total_amount])
    }
    const journalLines: JournalLineInput[] = [{ accountCode: '1100', debit: Number(estimate.amount), credit: 0 }]
    if (invoiceSubtotalCents > 0) journalLines.push({ accountCode: '4000', debit: 0, credit: invoiceSubtotalCents / 100 })
    if (invoiceTaxCents > 0) journalLines.push({ accountCode: '2150', debit: 0, credit: invoiceTaxCents / 100 })
    if (costOfGoodsSold > 0) journalLines.push({ accountCode: '5100', debit: Number(costOfGoodsSold.toFixed(2)), credit: 0 }, { accountCode: '1200', debit: 0, credit: Number(costOfGoodsSold.toFixed(2)) })
    await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: nairobiToday(), description: `Invoice: ${estimate.customer} — ${estimate.description}`, sourceType: 'invoice', sourceId: invoiceId, lines: journalLines })
    await client.query("UPDATE estimates SET status = 'converted', invoice_id = $1, updated_at = now() WHERE id = $2", [invoiceId, estimate.id])
    await client.query("UPDATE sales_orders SET status = 'fulfilled', invoice_id = $1, fulfilled_at = COALESCE(fulfilled_at, now()) WHERE estimate_id = $2 AND workspace_id = $3", [invoiceId, estimate.id, request.session!.workspaceId])
    await client.query('COMMIT')
    response.status(201).json({ invoice: invoice.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})

app.get('/v1/bills', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, supplier, description, amount::text, amount_paid::text, GREATEST(amount - amount_paid, 0)::text AS amount_due, bill_date, due_date, status, approval_status, created_at FROM vendor_bills WHERE workspace_id = $1 ORDER BY due_date, created_at DESC LIMIT 200', [request.session!.workspaceId])
    response.json({ bills: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/bills', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({
    supplier: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(240).optional(),
    amount: z.coerce.number().finite().positive().max(999999999999).optional(),
    lines: z.array(commercialLineSchema).min(1).max(100).optional(),
    billDate: z.string().date(),
    dueDate: z.string().date(),
    requiresApproval: z.boolean().default(false),
  }).superRefine((value, context) => {
    if (!value.lines && (!value.description || !value.amount)) context.addIssue({ code: 'custom', message: 'Provide bill lines or a description and amount.' })
  }).safeParse(request.body)
  if (!input.success || input.data.billDate > input.data.dueDate) { response.status(400).json({ error: 'Enter a supplier, description, positive amount, and valid bill/due dates.' }); return }
  let financials: ReturnType<typeof calculateCommercialLines>
  try {
    const lines = input.data.lines ?? [{ description: input.data.description!, quantity: 1, unitPrice: input.data.amount!, discountAmount: 0, taxAmount: 0, recoverableTaxAmount: 0 }]
    financials = calculateCommercialLines(lines)
  } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Bill line amounts are invalid.' }); return }
  if (financials.total <= 0) { response.status(400).json({ error: 'Bill total must be greater than zero.' }); return }
  const description = input.data.description ?? financials.lines.map((line) => line.description).join('; ').slice(0, 240)
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    await ensureDefaultAccounts(request.session!.workspaceId)
    const id = randomUUID()
    const approvalStatus = input.data.requiresApproval ? 'pending' : 'approved'
    const bill = await client.query(`INSERT INTO vendor_bills (id, workspace_id, supplier, description, amount, bill_date, due_date, approval_status, approved_by, approved_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 = 'approved' THEN $9::uuid ELSE NULL END, CASE WHEN $8 = 'approved' THEN now() ELSE NULL END)
      RETURNING id, supplier, description, amount::text, bill_date, due_date, status, approval_status`, [id, request.session!.workspaceId, input.data.supplier, description, financials.total.toFixed(2), input.data.billDate, input.data.dueDate, approvalStatus, request.session!.userId])
    for (const [index, line] of financials.lines.entries()) {
      await client.query('INSERT INTO vendor_bill_lines (id, bill_id, line_number, description, quantity, unit_price, discount_amount, tax_amount, recoverable_tax_amount, total_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [randomUUID(), id, index + 1, line.description, line.quantity.toFixed(3), line.unitPrice.toFixed(2), line.discountAmount, line.taxAmount, line.recoverableTaxAmount, line.totalAmount])
    }
    if (approvalStatus === 'approved') {
      const expenseAmount = financials.total - financials.recoverableTax
      const journalLines: JournalLineInput[] = [{ accountCode: '6000', debit: expenseAmount, credit: 0 }]
      if (financials.recoverableTax > 0) journalLines.push({ accountCode: '1300', debit: financials.recoverableTax, credit: 0 })
      journalLines.push({ accountCode: '2200', debit: 0, credit: financials.total })
      await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: input.data.billDate, description: `Bill: ${input.data.supplier} — ${description}`, sourceType: 'vendor_bill', sourceId: id, lines: journalLines })
    }
    await client.query('COMMIT')
    response.status(201).json({ bill: bill.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})
app.post('/v1/bills/:billId/approval', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ decision: z.enum(['approved', 'rejected']) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Choose approve or reject for this bill.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query("SELECT id, supplier, description, amount::text, bill_date FROM vendor_bills WHERE id = $1 AND workspace_id = $2 AND approval_status = 'pending' FOR UPDATE", [request.params.billId, request.session!.workspaceId])
    const bill = found.rows[0]
    if (!bill) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Pending bill approval not found.' }); return }
    if (input.data.decision === 'approved') {
      const amount = Number(bill.amount)
      const lines = await client.query('SELECT COALESCE(SUM(recoverable_tax_amount), 0)::text AS recoverable_tax FROM vendor_bill_lines WHERE bill_id = $1', [bill.id])
      const recoverableTax = Number(lines.rows[0].recoverable_tax)
      const journalLines: JournalLineInput[] = [{ accountCode: '6000', debit: amount - recoverableTax, credit: 0 }]
      if (recoverableTax > 0) journalLines.push({ accountCode: '1300', debit: recoverableTax, credit: 0 })
      journalLines.push({ accountCode: '2200', debit: 0, credit: amount })
      await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: String(bill.bill_date).slice(0, 10), description: `Bill: ${bill.supplier} — ${bill.description}`, sourceType: 'vendor_bill', sourceId: String(bill.id), lines: journalLines })
    }
    await client.query('UPDATE vendor_bills SET approval_status = $1, approved_by = $2, approved_at = now() WHERE id = $3 AND workspace_id = $4', [input.data.decision, request.session!.userId, bill.id, request.session!.workspaceId])
    await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: `bill.${input.data.decision}`, entityType: 'vendor_bill', entityId: String(bill.id) })
    await client.query('COMMIT')
    response.json({ billId: bill.id, approvalStatus: input.data.decision })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})
app.post('/v1/bills/:billId/payments', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ amount: z.coerce.number().finite().positive().max(999999999999), paymentDate: z.string().date() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a positive payment amount and valid payment date.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query("SELECT id, supplier, description, amount::text, amount_paid::text FROM vendor_bills WHERE id = $1 AND workspace_id = $2 AND status = 'unpaid' AND approval_status = 'approved' FOR UPDATE", [request.params.billId, request.session!.workspaceId])
    const bill = found.rows[0]
    if (!bill) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Unpaid bill not found.' }); return }
    const amountDue = Number(bill.amount) - Number(bill.amount_paid)
    if (Math.round(input.data.amount * 100) > Math.round(amountDue * 100)) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Payment cannot exceed the outstanding bill balance.' }); return }
    const paymentId = randomUUID()
    await client.query('INSERT INTO bill_payments (id, workspace_id, bill_id, amount, payment_date, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [paymentId, request.session!.workspaceId, bill.id, input.data.amount.toFixed(2), input.data.paymentDate, request.session!.userId])
    const updated = await client.query("UPDATE vendor_bills SET amount_paid = amount_paid + $1, status = CASE WHEN amount_paid + $1 >= amount THEN 'paid' ELSE 'unpaid' END, updated_at = now() WHERE id = $2 AND workspace_id = $3 RETURNING amount::text, amount_paid::text, status", [input.data.amount.toFixed(2), bill.id, request.session!.workspaceId])
    await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: input.data.paymentDate, description: `Bill payment: ${bill.supplier} — ${bill.description}`, sourceType: 'vendor_bill_payment', sourceId: paymentId, lines: [{ accountCode: '2200', debit: input.data.amount, credit: 0 }, { accountCode: '1000', debit: 0, credit: input.data.amount }] })
    await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'bill.payment_recorded', entityType: 'vendor_bill', entityId: String(bill.id), eventData: { paymentId, amount: input.data.amount, paymentDate: input.data.paymentDate } })
    await client.query('COMMIT')
    response.json({ payment: { id: paymentId, amount: input.data.amount.toFixed(2), ...updated.rows[0] } })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})

app.get('/v1/accounting/chart', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    await ensureDefaultAccounts(request.session!.workspaceId)
    const result = await pool!.query('SELECT id, code, name, account_type AS type, active FROM workspace_accounts WHERE workspace_id = $1 ORDER BY code', [request.session!.workspaceId])
    response.json({ accounts: result.rows })
  } catch (error) { next(error) }
})

app.get('/v1/accounting/trial-balance', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  const input = z.object({ from: z.string().date().optional(), to: z.string().date().optional() }).safeParse(request.query)
  if (!input.success) { response.status(400).json({ error: 'Use valid YYYY-MM-DD from/to dates.' }); return }
  try {
    await ensureDefaultAccounts(request.session!.workspaceId)
    const result = await pool!.query(`SELECT a.id, a.code, a.name, a.account_type AS type, COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit ELSE 0 END), 0)::text AS debit, COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit ELSE 0 END), 0)::text AS credit FROM workspace_accounts a LEFT JOIN journal_lines l ON l.account_id = a.id LEFT JOIN journal_entries e ON e.id = l.journal_entry_id AND e.workspace_id = a.workspace_id AND ($2::date IS NULL OR e.entry_date >= $2) AND ($3::date IS NULL OR e.entry_date <= $3) WHERE a.workspace_id = $1 GROUP BY a.id, a.code, a.name, a.account_type ORDER BY a.code`, [request.session!.workspaceId, input.data.from ?? null, input.data.to ?? null])
    const accounts = result.rows.map((row: Record<string, unknown>) => ({ ...row, debit: String(row.debit), credit: String(row.credit), balance: (Number(row.debit) - Number(row.credit)).toFixed(2) }))
    response.json({ accounts, totals: { debit: accounts.reduce((total: number, row: { debit: string }) => total + Number(row.debit), 0).toFixed(2), credit: accounts.reduce((total: number, row: { credit: string }) => total + Number(row.credit), 0).toFixed(2) } })
  } catch (error) { next(error) }
})

app.get('/v1/accounting/reports/financial-statements', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  const today = nairobiToday()
  const input = z.object({
    from: z.string().date().default(`${today.slice(0, 4)}-01-01`),
    to: z.string().date().default(today),
  }).safeParse(request.query)
  if (!input.success || input.data.from > input.data.to) {
    response.status(400).json({ error: 'Use a valid date range with from on or before to.' })
    return
  }
  try {
    await ensureDefaultAccounts(request.session!.workspaceId)
    const result = await pool!.query(`SELECT a.code, a.name, a.account_type AS type,
      COALESCE(SUM(CASE WHEN e.entry_date >= $2 THEN l.debit ELSE 0 END), 0)::text AS period_debit,
      COALESCE(SUM(CASE WHEN e.entry_date >= $2 THEN l.credit ELSE 0 END), 0)::text AS period_credit,
      COALESCE(SUM(l.debit), 0)::text AS balance_debit,
      COALESCE(SUM(l.credit), 0)::text AS balance_credit
      FROM workspace_accounts a
      LEFT JOIN journal_lines l ON l.account_id = a.id
      LEFT JOIN journal_entries e ON e.id = l.journal_entry_id
        AND e.workspace_id = a.workspace_id AND e.entry_date <= $3
      WHERE a.workspace_id = $1
      GROUP BY a.code, a.name, a.account_type
      ORDER BY a.code`, [request.session!.workspaceId, input.data.from, input.data.to])

    const rows: Array<{ code: string; name: string; type: string; periodDebit: number; periodCredit: number; balanceDebit: number; balanceCredit: number }> = result.rows.map((row: Record<string, unknown>) => ({
      code: String(row.code),
      name: String(row.name),
      type: String(row.type),
      periodDebit: Number(row.period_debit),
      periodCredit: Number(row.period_credit),
      balanceDebit: Number(row.balance_debit),
      balanceCredit: Number(row.balance_credit),
    }))
    const nonZero = (amount: number) => Math.round(amount * 100) !== 0
    const incomeAccounts = rows.filter((row) => row.type === 'income').map((row) => ({ code: row.code, name: row.name, amount: row.periodCredit - row.periodDebit })).filter((row) => nonZero(row.amount))
    const expenseAccounts = rows.filter((row) => row.type === 'expense').map((row) => ({ code: row.code, name: row.name, amount: row.periodDebit - row.periodCredit })).filter((row) => nonZero(row.amount))
    const totalIncome = incomeAccounts.reduce((sum, row) => sum + row.amount, 0)
    const totalExpenses = expenseAccounts.reduce((sum, row) => sum + row.amount, 0)
    const assets = rows.filter((row) => row.type === 'asset').map((row) => ({ code: row.code, name: row.name, amount: row.balanceDebit - row.balanceCredit })).filter((row) => nonZero(row.amount))
    const liabilities = rows.filter((row) => row.type === 'liability').map((row) => ({ code: row.code, name: row.name, amount: row.balanceCredit - row.balanceDebit })).filter((row) => nonZero(row.amount))
    const equity = rows.filter((row) => row.type === 'equity').map((row) => ({ code: row.code, name: row.name, amount: row.balanceCredit - row.balanceDebit })).filter((row) => nonZero(row.amount))
    const accumulatedEarnings = rows.filter((row) => row.type === 'income').reduce((sum, row) => sum + row.balanceCredit - row.balanceDebit, 0)
      - rows.filter((row) => row.type === 'expense').reduce((sum, row) => sum + row.balanceDebit - row.balanceCredit, 0)
    const totalAssets = assets.reduce((sum, row) => sum + row.amount, 0)
    const totalLiabilities = liabilities.reduce((sum, row) => sum + row.amount, 0)
    const totalEquity = equity.reduce((sum, row) => sum + row.amount, 0) + accumulatedEarnings
    response.json({
      from: input.data.from,
      to: input.data.to,
      incomeStatement: {
        income: incomeAccounts,
        expenses: expenseAccounts,
        totalIncome,
        totalExpenses,
        netIncome: totalIncome - totalExpenses,
      },
      balanceSheet: {
        asOf: input.data.to,
        assets,
        liabilities,
        equity,
        accumulatedEarnings,
        totalAssets,
        totalLiabilities,
        totalEquity,
        liabilitiesAndEquity: totalLiabilities + totalEquity,
        difference: totalAssets - totalLiabilities - totalEquity,
      },
    })
  } catch (error) { next(error) }
})

app.get('/v1/accounting/reconciliations', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query(`SELECT r.id, r.account_label, r.period_start, r.period_end, r.opening_balance::text,
      r.statement_ending_balance::text, r.status, r.completed_at,
      count(m.transaction_id)::int AS matched_count,
      COALESCE(SUM(CASE WHEN t.direction = 'income' THEN t.amount ELSE -t.amount END), 0)::text AS matched_net
      FROM bank_reconciliations r
      LEFT JOIN bank_reconciliation_matches m ON m.reconciliation_id = r.id
      LEFT JOIN ledger_transactions t ON t.id = m.transaction_id
      WHERE r.workspace_id = $1
      GROUP BY r.id ORDER BY r.period_end DESC, r.created_at DESC LIMIT 100`, [request.session!.workspaceId])
    response.json({ reconciliations: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/accounting/reconciliations', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ accountLabel: z.string().trim().min(1).max(120), periodStart: z.string().date(), periodEnd: z.string().date(), openingBalance: z.coerce.number().finite(), statementEndingBalance: z.coerce.number().finite() }).safeParse(request.body)
  if (!input.success || input.data.periodStart > input.data.periodEnd) { response.status(400).json({ error: 'Enter an account, valid dates, and statement balances.' }); return }
  try {
    const id = randomUUID()
    const result = await pool!.query(`INSERT INTO bank_reconciliations (id, workspace_id, account_label, period_start, period_end, opening_balance, statement_ending_balance)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, account_label, period_start, period_end, opening_balance::text, statement_ending_balance::text, status`,
    [id, request.session!.workspaceId, input.data.accountLabel, input.data.periodStart, input.data.periodEnd, input.data.openingBalance.toFixed(2), input.data.statementEndingBalance.toFixed(2)])
    response.status(201).json({ reconciliation: result.rows[0] })
  } catch (error) { next(error) }
})
app.get('/v1/accounting/reconciliations/:reconciliationId', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query(`SELECT id, account_label, period_start, period_end, opening_balance::text, statement_ending_balance::text, status, completed_at
      FROM bank_reconciliations WHERE id = $1 AND workspace_id = $2`, [request.params.reconciliationId, request.session!.workspaceId])
    const reconciliation = result.rows[0]
    if (!reconciliation) { response.status(404).json({ error: 'Reconciliation not found.' }); return }
    const transactions = await pool!.query(`SELECT t.id, t.description, t.amount::text, t.direction, t.account, t.transaction_date,
      (m.transaction_id IS NOT NULL) AS matched
      FROM ledger_transactions t
      LEFT JOIN bank_reconciliation_matches m ON m.transaction_id = t.id
      WHERE t.workspace_id = $1 AND t.account = $2 AND t.transaction_date BETWEEN $3 AND $4
      ORDER BY t.transaction_date, t.created_at`,
    [request.session!.workspaceId, reconciliation.account_label, reconciliation.period_start, reconciliation.period_end])
    const matchedNet = transactions.rows.reduce((sum: number, item: Record<string, unknown>) => item.matched === true ? sum + (item.direction === 'income' ? Number(item.amount) : -Number(item.amount)) : sum, 0)
    response.json({ reconciliation, transactions: transactions.rows, matchedNet: matchedNet.toFixed(2), calculatedEndingBalance: (Number(reconciliation.opening_balance) + matchedNet).toFixed(2), difference: (Number(reconciliation.statement_ending_balance) - Number(reconciliation.opening_balance) - matchedNet).toFixed(2) })
  } catch (error) { next(error) }
})
app.put('/v1/accounting/reconciliations/:reconciliationId/matches/:transactionId', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ matched: z.boolean() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Specify whether this transaction is matched.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query("SELECT id, account_label, period_start, period_end, status FROM bank_reconciliations WHERE id = $1 AND workspace_id = $2 FOR UPDATE", [request.params.reconciliationId, request.session!.workspaceId])
    const reconciliation = result.rows[0]
    if (!reconciliation) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Reconciliation not found.' }); return }
    if (reconciliation.status !== 'in_progress') { await client.query('ROLLBACK'); response.status(409).json({ error: 'Completed reconciliations cannot be changed.' }); return }
    if (input.data.matched) {
      const transaction = await client.query('SELECT id FROM ledger_transactions WHERE id = $1 AND workspace_id = $2 AND account = $3 AND transaction_date BETWEEN $4 AND $5', [request.params.transactionId, request.session!.workspaceId, reconciliation.account_label, reconciliation.period_start, reconciliation.period_end])
      if (!transaction.rowCount) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Transaction is outside this account or reconciliation date range.' }); return }
      await client.query('INSERT INTO bank_reconciliation_matches (reconciliation_id, transaction_id) VALUES ($1, $2) ON CONFLICT (reconciliation_id, transaction_id) DO NOTHING', [reconciliation.id, request.params.transactionId])
    } else {
      await client.query('DELETE FROM bank_reconciliation_matches WHERE reconciliation_id = $1 AND transaction_id = $2', [reconciliation.id, request.params.transactionId])
    }
    await client.query('COMMIT')
    response.json({ matched: input.data.matched })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && 'code' in error && error.code === '23505') { response.status(409).json({ error: 'This transaction is already matched to another reconciliation.' }); return }
    next(error)
  } finally { client.release() }
})
app.post('/v1/accounting/reconciliations/:reconciliationId/complete', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('SELECT id, opening_balance::text, statement_ending_balance::text, status FROM bank_reconciliations WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [request.params.reconciliationId, request.session!.workspaceId])
    const reconciliation = result.rows[0]
    if (!reconciliation) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Reconciliation not found.' }); return }
    if (reconciliation.status !== 'in_progress') { await client.query('ROLLBACK'); response.status(409).json({ error: 'Reconciliation is already completed.' }); return }
    const net = await client.query(`SELECT COALESCE(SUM(CASE WHEN t.direction = 'income' THEN t.amount ELSE -t.amount END), 0)::text AS matched_net
      FROM bank_reconciliation_matches m JOIN ledger_transactions t ON t.id = m.transaction_id WHERE m.reconciliation_id = $1`, [reconciliation.id])
    const calculated = Math.round((Number(reconciliation.opening_balance) + Number(net.rows[0].matched_net)) * 100)
    const expected = Math.round(Number(reconciliation.statement_ending_balance) * 100)
    if (calculated !== expected) { await client.query('ROLLBACK'); response.status(409).json({ error: `Reconciliation does not balance. Difference: KSh ${((expected - calculated) / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}.` }); return }
    await client.query("UPDATE bank_reconciliations SET status = 'completed', completed_by = $1, completed_at = now() WHERE id = $2", [request.session!.userId, reconciliation.id])
    await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'bank_reconciliation.completed', entityType: 'bank_reconciliation', entityId: String(reconciliation.id), eventData: { endingBalance: reconciliation.statement_ending_balance, matchedNet: net.rows[0].matched_net } })
    await client.query('COMMIT')
    response.json({ status: 'completed', endingBalance: reconciliation.statement_ending_balance })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})

app.get('/v1/accounting/journals', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const entries = await pool!.query(`SELECT e.id, e.entry_date, e.description, e.source_type, e.source_id, e.reversal_of, e.correction_reason, e.created_at,
      (SELECT r.id FROM journal_entries r WHERE r.reversal_of = e.id LIMIT 1) AS reversed_by
      FROM journal_entries e WHERE e.workspace_id = $1 ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 100`, [request.session!.workspaceId])
    const result = []
    for (const entry of entries.rows) {
      const lines = await pool!.query('SELECT a.code, a.name, l.description, l.debit::text, l.credit::text FROM journal_lines l JOIN workspace_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1 ORDER BY a.code', [entry.id])
      result.push({ ...entry, lines: lines.rows })
    }
    response.json({ entries: result })
  } catch (error) { next(error) }
})

app.post('/v1/accounting/journals/:journalId/reverse', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ date: z.string().date(), reason: z.string().trim().min(5).max(240) }).safeParse(request.body)
  if (!input.success || !z.string().uuid().safeParse(request.params.journalId).success) { response.status(400).json({ error: 'Provide a valid correction date and a reason of at least five characters.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const original = await client.query('SELECT id, description, reversal_of FROM journal_entries WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [request.params.journalId, request.session!.workspaceId])
    if (!original.rowCount) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Journal entry not found in this business.' }); return }
    if (original.rows[0].reversal_of) { await client.query('ROLLBACK'); response.status(409).json({ error: 'A reversal entry cannot itself be reversed. Correct the original entry with a replacement journal if needed.' }); return }
    const prior = await client.query('SELECT id FROM journal_entries WHERE reversal_of = $1', [request.params.journalId])
    if (prior.rowCount) { await client.query('ROLLBACK'); response.status(409).json({ error: 'This journal entry already has a reversal.' }); return }
    const lines = await client.query('SELECT a.code, l.description, l.debit::text, l.credit::text FROM journal_lines l JOIN workspace_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1 ORDER BY a.code', [request.params.journalId])
    const reversalId = await insertJournal(client, {
      workspaceId: request.session!.workspaceId,
      userId: request.session!.userId,
      date: input.data.date,
      description: `Reversal of ${String(original.rows[0].description).slice(0, 180)}`,
      sourceType: 'journal_reversal',
      sourceId: String(original.rows[0].id),
      reversalOf: String(original.rows[0].id),
      correctionReason: input.data.reason,
      lines: lines.rows.map((line: Record<string, unknown>) => ({ accountCode: String(line.code), description: line.description ? `Reversal: ${String(line.description).slice(0, 120)}` : undefined, debit: Number(line.credit), credit: Number(line.debit) })),
    })
    await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'journal.reversed', entityType: 'journal_entry', entityId: String(original.rows[0].id), eventData: { reversalId, date: input.data.date, reason: input.data.reason } })
    await client.query('COMMIT')
    response.status(201).json({ originalJournalId: original.rows[0].id, reversalJournalId: reversalId, status: 'reversed' })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof Error && error.message.startsWith('Accounting period ')) { response.status(409).json({ error: error.message }); return }
    next(error)
  } finally { client.release() }
})

app.get('/v1/accounting/periods', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, period, status, closed_at FROM accounting_periods WHERE workspace_id = $1 ORDER BY period DESC', [request.session!.workspaceId])
    response.json({ periods: result.rows })
  } catch (error) { next(error) }
})

app.get('/v1/accounting/audit-events', requirePool, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, actor_user_id, event_type, entity_type, entity_id, event_data, created_at FROM audit_events WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 200', [request.session!.workspaceId])
    response.json({ events: result.rows })
  } catch (error) { next(error) }
})

app.post('/v1/accounting/periods/:period/close', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).safeParse(request.params.period)
  if (!period.success) { response.status(400).json({ error: 'Period must use YYYY-MM format.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    await client.query('INSERT INTO accounting_periods (id, workspace_id, period) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, period) DO NOTHING', [randomUUID(), request.session!.workspaceId, period.data])
    const periodRow = await client.query('SELECT status FROM accounting_periods WHERE workspace_id = $1 AND period = $2 FOR UPDATE', [request.session!.workspaceId, period.data])
    if (periodRow.rows[0]?.status === 'closed') { await client.query('ROLLBACK'); response.status(409).json({ error: 'Accounting period is already closed.' }); return }
    const [year = 2026, month = 1] = period.data.split('-').map(Number)
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
    const totals = await client.query('SELECT COALESCE(SUM(l.debit), 0)::text AS debit, COALESCE(SUM(l.credit), 0)::text AS credit FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id WHERE e.workspace_id = $1 AND e.entry_date >= $2 AND e.entry_date < $3', [request.session!.workspaceId, startDate, nextMonth])
    if (Math.round(Number(totals.rows[0].debit) * 100) !== Math.round(Number(totals.rows[0].credit) * 100)) { await client.query('ROLLBACK'); response.status(409).json({ error: 'The period trial balance is out of balance and cannot be closed.' }); return }
    await client.query('UPDATE accounting_periods SET status = $1, closed_by = $2, closed_at = now() WHERE workspace_id = $3 AND period = $4', ['closed', request.session!.userId, request.session!.workspaceId, period.data])
    await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'accounting_period.closed', entityType: 'accounting_period', eventData: { period: period.data, debit: totals.rows[0].debit, credit: totals.rows[0].credit } })
    await client.query('COMMIT')
    response.json({ period: period.data, status: 'closed', totals: totals.rows[0] })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})

app.post('/v1/accounting/periods/:period/reopen', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).safeParse(request.params.period)
  if (!period.success) { response.status(400).json({ error: 'Period must use YYYY-MM format.' }); return }
  try {
    const client = await pool!.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query("UPDATE accounting_periods SET status = 'open', closed_by = NULL, closed_at = NULL WHERE workspace_id = $1 AND period = $2 AND status = 'closed' RETURNING period, status", [request.session!.workspaceId, period.data])
      if (!result.rowCount) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Closed accounting period not found.' }); return }
      await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'accounting_period.reopened', entityType: 'accounting_period', eventData: { period: period.data } })
      await client.query('COMMIT')
      response.json({ period: result.rows[0] })
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  } catch (error) { next(error) }
})

app.post('/v1/accounting/journals', requirePool, verifyOrigin, requireSession, async (request: AuthedRequest, response, _next) => {
  const input = z.object({ date: z.string().date(), description: z.string().trim().min(1).max(240), lines: z.array(z.object({ accountCode: z.string().trim().min(1).max(20), description: z.string().trim().max(160).optional(), debit: z.coerce.number().finite().min(0), credit: z.coerce.number().finite().min(0) })).min(2).max(30) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide a journal date, description and at least two debit/credit lines.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const id = await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: input.data.date, description: input.data.description, sourceType: 'manual', lines: input.data.lines })
    await client.query('COMMIT')
    response.status(201).json({ journalEntryId: id, status: 'posted' })
    } catch (error) {
      await client.query('ROLLBACK')
      const message = error instanceof Error ? error.message : 'Could not post journal.'
      response.status(message.startsWith('Accounting period ') ? 409 : 400).json({ error: message })
    }
  finally { client.release() }
})

app.get('/v1/payroll/employees', requirePool, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, employee_data_encrypted, active, created_at FROM employees WHERE workspace_id = $1 ORDER BY created_at DESC', [request.session!.workspaceId])
    response.json({ employees: result.rows.map((row: Record<string, unknown>) => ({ id: row.id, ...decryptPayrollData<Record<string, unknown>>(String(row.employee_data_encrypted)), active: row.active, created_at: row.created_at })) })
  } catch (error) { next(error) }
})

const employeeRecordSchema = z.object({
  employeeNumber: z.string().trim().min(1).max(40),
  fullName: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(254).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional(),
  bankName: z.string().trim().max(100).optional(),
  bankAccountName: z.string().trim().max(160).optional(),
  bankAccountNumber: z.string().trim().max(34).optional(),
  grossMonthlyPay: z.coerce.number().finite().positive().max(100_000_000),
  otherTaxableDeductions: z.coerce.number().finite().min(0).default(0),
  otherTaxReliefs: z.coerce.number().finite().min(0).default(0),
  deductions: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['taxable_base', 'tax_relief', 'post_tax']),
    amount: z.coerce.number().finite().positive().max(100_000_000),
  })).max(30).default([]),
})

function normalizeEmployeeRecord(data: z.infer<typeof employeeRecordSchema>) {
  return {
    ...data,
    email: data.email?.toLowerCase() || '',
    otherTaxableDeductions: data.deductions.filter((item) => item.kind === 'taxable_base').reduce((sum, item) => sum + item.amount, data.otherTaxableDeductions),
    otherTaxReliefs: data.deductions.filter((item) => item.kind === 'tax_relief').reduce((sum, item) => sum + item.amount, data.otherTaxReliefs),
  }
}

app.post('/v1/payroll/employees', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  const input = employeeRecordSchema.safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter an employee number, name, and positive gross monthly pay.' }); return }
  try {
    const id = randomUUID()
    const employee = normalizeEmployeeRecord(input.data)
    await pool!.query('INSERT INTO employees (id, workspace_id, employee_data_encrypted) VALUES ($1, $2, $3)', [id, request.session!.workspaceId, encryptPayrollData(employee)])
    const client = await pool!.connect()
    try {
      await client.query('BEGIN')
      await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'employee.created', entityType: 'employee', entityId: id, eventData: { employeeNumber: employee.employeeNumber } })
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
    response.status(201).json({ employee: { id, ...employee, active: true } })
  } catch (error) { next(error) }
})

app.put('/v1/payroll/employees/:employeeId', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  const input = employeeRecordSchema.safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter an employee number, name, and positive gross monthly pay.' }); return }
  try {
    const employee = normalizeEmployeeRecord(input.data)
    const result = await pool!.query('UPDATE employees SET employee_data_encrypted = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3 RETURNING id, active', [encryptPayrollData(employee), request.params.employeeId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(404).json({ error: 'Employee not found.' }); return }
    const client = await pool!.connect()
    try {
      await client.query('BEGIN')
      await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'employee.updated', entityType: 'employee', entityId: String(result.rows[0].id), eventData: { employeeNumber: employee.employeeNumber } })
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
    response.json({ employee: { id: result.rows[0].id, ...employee, active: result.rows[0].active } })
  } catch (error) { next(error) }
})

app.patch('/v1/payroll/employees/:employeeId/status', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  const input = z.object({ active: z.boolean() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide active as true or false.' }); return }
  try {
    const result = await pool!.query('UPDATE employees SET active = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3 RETURNING id, active', [input.data.active, request.params.employeeId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(404).json({ error: 'Employee not found.' }); return }
    response.json({ employee: result.rows[0] })
  } catch (error) { next(error) }
})

app.get('/v1/payroll/runs', requirePool, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query(`SELECT id, period, status, rule_set, employee_count, gross_total::text, net_total::text, paid_total::text,
      GREATEST(net_total - paid_total, 0)::text AS outstanding_total, paye_total::text, shif_total::text,
      nssf_employee_total::text, nssf_employer_total::text, housing_employee_total::text, housing_employer_total::text, created_at
      FROM payroll_runs WHERE workspace_id = $1 ORDER BY period DESC`, [request.session!.workspaceId])
    response.json({ runs: result.rows })
  } catch (error) { next(error) }
})

app.post('/v1/payroll/runs', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  const input = z.object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    employeeIds: z.array(z.string().uuid()).min(1).max(500).optional(),
    bonuses: z.array(z.object({ employeeId: z.string().uuid(), amount: z.coerce.number().finite().min(0).max(100_000_000) })).max(500).optional(),
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter a valid payroll period and at least one valid employee selection.' }); return }
  if (input.data.period < '2026-02') { response.status(409).json({ error: 'The installed KE-2026-01 payroll estimate snapshot is effective from 2026-02 only. Do not calculate historical payroll with this rule set.' }); return }
  try {
    const activeRows = await pool!.query('SELECT id, employee_data_encrypted FROM employees WHERE workspace_id = $1 AND active = true', [request.session!.workspaceId])
    const selectedIds = input.data.employeeIds ? new Set(input.data.employeeIds) : null
    if (selectedIds && selectedIds.size !== input.data.employeeIds?.length) { response.status(400).json({ error: 'An employee can only appear once in a payroll run.' }); return }
    const selectedRows = selectedIds ? activeRows.rows.filter((row: Record<string, unknown>) => selectedIds.has(String(row.id))) : activeRows.rows
    if (!selectedRows.length || (selectedIds && selectedRows.length !== selectedIds.size)) { response.status(409).json({ error: 'Select one or more active employees from this business before preparing payroll.' }); return }
    const includedIds = new Set(selectedRows.map((row: Record<string, unknown>) => String(row.id)))
    const bonusByEmployee = new Map<string, number>()
    for (const bonus of input.data.bonuses ?? []) {
      if (bonusByEmployee.has(bonus.employeeId) || !includedIds.has(bonus.employeeId)) { response.status(400).json({ error: 'Each bonus must be unique and belong to an employee selected for this payroll run.' }); return }
      bonusByEmployee.set(bonus.employeeId, bonus.amount)
    }
    for (const row of selectedRows) {
      const employee = decryptPayrollData<Record<string, unknown>>(String(row.employee_data_encrypted))
      const grossSalary = Number(employee.grossMonthlyPay)
      const bonusAmount = bonusByEmployee.get(String(row.id)) ?? 0
      const estimate = estimateKenyaPayroll({ grossMonthlyPay: grossSalary + bonusAmount, otherTaxableDeductions: Number(employee.otherTaxableDeductions ?? 0), otherTaxReliefs: Number(employee.otherTaxReliefs ?? 0) })
      if (estimate.netPayEstimate < 0) { response.status(409).json({ error: `Current estimate deductions exceed gross pay for employee ${String(employee.employeeNumber)}. Obtain qualified payroll review and correct the inputs before creating this run.` }); return }
      const postTaxDeductions = Array.isArray(employee.deductions) ? (employee.deductions as Array<{ kind: string; amount: number }>).filter((item) => item.kind === 'post_tax').reduce((sum, item) => sum + Number(item.amount), 0) : 0
      if (postTaxDeductions > estimate.netPayEstimate) { response.status(409).json({ error: `Post-tax deductions exceed estimated net pay for employee ${String(employee.employeeNumber)}. Correct the deduction before creating this payroll run.` }); return }
    }
    const items = selectedRows.map((row: Record<string, unknown>) => {
      const employee = decryptPayrollData<Record<string, unknown>>(String(row.employee_data_encrypted))
      const bonusAmount = bonusByEmployee.get(String(row.id)) ?? 0
      const estimate = estimateKenyaPayroll({ grossMonthlyPay: Number(employee.grossMonthlyPay) + bonusAmount, otherTaxableDeductions: Number(employee.otherTaxableDeductions ?? 0), otherTaxReliefs: Number(employee.otherTaxReliefs ?? 0) })
      const postTaxDeductions = Array.isArray(employee.deductions) ? (employee.deductions as Array<{ kind: string; amount: number }>).filter((item) => item.kind === 'post_tax').reduce((sum, item) => sum + Number(item.amount), 0) : 0
      estimate.netPayEstimate = Math.round((estimate.netPayEstimate - postTaxDeductions + Number.EPSILON) * 100) / 100
      return { employeeId: String(row.id), employee, bonusAmount, estimate }
    })
    const sum = (field: keyof KenyaPayrollEstimate) => items.reduce((total: number, item: { estimate: KenyaPayrollEstimate }) => total + Number(item.estimate[field]), 0)
    const id = randomUUID()
    const totals = { gross: sum('grossMonthlyPay'), net: sum('netPayEstimate'), paye: sum('payeEstimate'), shif: sum('shifEmployee'), nssfEmployee: sum('nssfEmployee'), nssfEmployer: sum('nssfEmployer'), housingEmployee: sum('housingLevyEmployee'), housingEmployer: sum('housingLevyEmployer') }
    const client = await pool!.connect()
    try {
      await client.query('BEGIN')
      await client.query('INSERT INTO payroll_runs (id, workspace_id, period, rule_set, employee_count, gross_total, net_total, paye_total, shif_total, nssf_employee_total, nssf_employer_total, housing_employee_total, housing_employer_total, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)', [id, request.session!.workspaceId, input.data.period, 'KE-2026-01', items.length, totals.gross.toFixed(2), totals.net.toFixed(2), totals.paye.toFixed(2), totals.shif.toFixed(2), totals.nssfEmployee.toFixed(2), totals.nssfEmployer.toFixed(2), totals.housingEmployee.toFixed(2), totals.housingEmployer.toFixed(2), request.session!.userId])
      for (const item of items) await client.query('INSERT INTO payroll_run_items (id, payroll_run_id, employee_id, payslip_encrypted) VALUES ($1, $2, $3, $4)', [randomUUID(), id, item.employeeId, encryptPayrollData({ period: input.data.period, employee: item.employee, bonusAmount: item.bonusAmount, estimate: item.estimate })])
        await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'payroll_run.draft_created', entityType: 'payroll_run', entityId: id, eventData: { period: input.data.period, employeeCount: items.length, ruleSet: 'KE-2026-01', gross: totals.gross.toFixed(2) } })
      await client.query('COMMIT')
      response.status(201).json({ run: { id, period: input.data.period, status: 'draft', ruleSet: 'KE-2026-01', employeeCount: items.length, ...totals }, reviewRequired: true })
    } catch (error) { await client.query('ROLLBACK'); next(error) }
    finally { client.release() }
  } catch (error) { next(error) }
})

app.get('/v1/payroll/runs/:runId/payslips', requirePool, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  try {
    const run = await pool!.query('SELECT id FROM payroll_runs WHERE id = $1 AND workspace_id = $2', [request.params.runId, request.session!.workspaceId])
    if (!run.rowCount) { response.status(404).json({ error: 'Payroll run not found.' }); return }
    const result = await pool!.query('SELECT id, payslip_encrypted FROM payroll_run_items WHERE payroll_run_id = $1 ORDER BY created_at', [request.params.runId])
    response.json({ payslips: result.rows.map((row: Record<string, unknown>) => ({ id: row.id, ...decryptPayrollData<Record<string, unknown>>(String(row.payslip_encrypted)) })) })
  } catch (error) { next(error) }
})

app.post('/v1/payroll/runs/:runId/post', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  await ensureDefaultAccounts(request.session!.workspaceId)
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('SELECT * FROM payroll_runs WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [request.params.runId, request.session!.workspaceId])
    const run = result.rows[0]
    if (!run) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Payroll run not found.' }); return }
    if (run.status !== 'draft') { await client.query('ROLLBACK'); response.status(409).json({ error: 'Only a draft payroll run can be posted.' }); return }
    const nssfTotal = Number(run.nssf_employee_total) + Number(run.nssf_employer_total)
    const housingTotal = Number(run.housing_employee_total) + Number(run.housing_employer_total)
    const runItems = await client.query('SELECT payslip_encrypted FROM payroll_run_items WHERE payroll_run_id = $1', [run.id])
    const otherDeductionsTotal = runItems.rows.reduce((total: number, row: Record<string, unknown>) => {
      const payslip = decryptPayrollData<Record<string, unknown>>(String(row.payslip_encrypted))
      const employee = payslip.employee as Record<string, unknown> | undefined
      const deductions = Array.isArray(employee?.deductions) ? employee.deductions as Array<{ kind: string; amount: number }> : []
      return total + deductions.filter((item) => item.kind === 'post_tax').reduce((sum, item) => sum + Number(item.amount), 0)
    }, 0)
    const lines: JournalLineInput[] = [
      { accountCode: '5000', debit: Number(run.gross_total), credit: 0 },
      { accountCode: '5010', debit: Number(run.nssf_employer_total), credit: 0 },
      { accountCode: '5020', debit: Number(run.housing_employer_total), credit: 0 },
      { accountCode: '2000', debit: 0, credit: Number(run.net_total) },
      { accountCode: '2100', debit: 0, credit: Number(run.paye_total) },
      { accountCode: '2110', debit: 0, credit: Number(run.shif_total) },
      { accountCode: '2120', debit: 0, credit: nssfTotal },
      { accountCode: '2130', debit: 0, credit: housingTotal },
      { accountCode: '2140', debit: 0, credit: otherDeductionsTotal },
    ].filter((line) => line.debit > 0 || line.credit > 0)
    const [year = 2026, month = 1] = String(run.period).split('-').map(Number)
    const entryDate = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
    await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: entryDate, description: `Payroll ${run.period}`, sourceType: 'payroll', sourceId: String(run.id), lines })
    for (const remittance of [['paye', Number(run.paye_total)], ['shif', Number(run.shif_total)], ['nssf', nssfTotal], ['housing_levy', housingTotal]] as const) {
      await client.query('INSERT INTO payroll_remittances (id, payroll_run_id, workspace_id, remittance_type, amount) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), run.id, request.session!.workspaceId, remittance[0], remittance[1].toFixed(2)])
    }
    await client.query('UPDATE payroll_runs SET status = $1 WHERE id = $2', ['posted', run.id])
    await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'payroll_run.posted', entityType: 'payroll_run', entityId: String(run.id), eventData: { period: run.period, ruleSet: run.rule_set } })
    await client.query('COMMIT')
    response.json({ runId: run.id, status: 'posted', remittancesCreated: 4, reviewRequired: true })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})

app.post('/v1/payroll/runs/:runId/pay', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  const input = z.object({
    amount: z.coerce.number().finite().positive().max(100_000_000),
    paymentReference: z.string().trim().min(1).max(120),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(nairobiToday()),
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter the externally paid amount, payment reference, and a valid payment date.' }); return }
  const client = await pool!.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('SELECT id, period, status, net_total::text, paid_total::text FROM payroll_runs WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [request.params.runId, request.session!.workspaceId])
    const run = result.rows[0]
    if (!run) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Payroll run not found.' }); return }
    if (!['posted', 'partially_paid'].includes(String(run.status))) { await client.query('ROLLBACK'); response.status(409).json({ error: 'Only a posted or partially paid payroll run can receive a payment.' }); return }
    const outstanding = Math.round((Number(run.net_total) - Number(run.paid_total)) * 100) / 100
    if (input.data.amount > outstanding) { await client.query('ROLLBACK'); response.status(409).json({ error: `Payment exceeds the remaining payroll payable of KSh ${outstanding.toFixed(2)}.` }); return }
    const paidTotal = Math.round((Number(run.paid_total) + input.data.amount) * 100) / 100
    const status = paidTotal >= Number(run.net_total) ? 'paid' : 'partially_paid'
    const paymentId = randomUUID()
    await client.query('INSERT INTO payroll_payments (id, payroll_run_id, workspace_id, amount, payment_reference, payment_date, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)', [paymentId, run.id, request.session!.workspaceId, input.data.amount.toFixed(2), input.data.paymentReference, input.data.paymentDate, request.session!.userId])
    await client.query('INSERT INTO ledger_transactions (id, workspace_id, description, amount, direction, account, transaction_date) VALUES ($1, $2, $3, $4, $5, $6, $7)', [paymentId, request.session!.workspaceId, `Net payroll paid ${run.period} · ${input.data.paymentReference}`, input.data.amount.toFixed(2), 'expense', 'Payroll', input.data.paymentDate])
    await insertJournal(client, { workspaceId: request.session!.workspaceId, userId: request.session!.userId, date: input.data.paymentDate, description: `Net payroll paid ${run.period}`, sourceType: 'payroll_payment', sourceId: paymentId, lines: [{ accountCode: '2000', debit: input.data.amount, credit: 0 }, { accountCode: '1000', debit: 0, credit: input.data.amount }] })
    await client.query('UPDATE payroll_runs SET paid_total = $1, status = $2 WHERE id = $3', [paidTotal.toFixed(2), status, run.id])
    await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'payroll_run.payment_recorded', entityType: 'payroll_run', entityId: String(run.id), eventData: { period: run.period, amount: input.data.amount.toFixed(2), outstanding: (Number(run.net_total) - paidTotal).toFixed(2), paymentReference: input.data.paymentReference } })
    await client.query('COMMIT')
    response.json({ runId: run.id, paymentId, status, paidTotal: paidTotal.toFixed(2), outstanding: (Number(run.net_total) - paidTotal).toFixed(2) })
  } catch (error) { await client.query('ROLLBACK'); next(error) }
  finally { client.release() }
})

app.get('/v1/payroll/remittances', requirePool, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, payroll_run_id, remittance_type, amount::text, status, payment_reference, created_at, recorded_at FROM payroll_remittances WHERE workspace_id = $1 ORDER BY created_at DESC', [request.session!.workspaceId])
    response.json({ remittances: result.rows })
  } catch (error) { next(error) }
})

app.post('/v1/payroll/remittances/:remittanceId/record-payment', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  const input = z.object({ paymentReference: z.string().trim().min(1).max(120) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter the external statutory payment reference.' }); return }
  try {
    const result = await pool!.query("UPDATE payroll_remittances SET status = $1, payment_reference = $2, recorded_by = $3, recorded_at = now() WHERE id = $4 AND workspace_id = $5 AND status = 'due' RETURNING id, status, remittance_type, amount::text, payment_reference", ['recorded_paid', input.data.paymentReference, request.session!.userId, request.params.remittanceId, request.session!.workspaceId])
    if (!result.rowCount) { response.status(404).json({ error: 'Due remittance not found.' }); return }
    response.json({ remittance: result.rows[0], note: 'Payment is marked from your recorded reference only; it was not sent to a statutory authority.' })
  } catch (error) { next(error) }
})

app.post('/v1/payroll/kenya/estimate', requirePool, verifyOrigin, requireSession, (request, response, _next) => {
  const input = z.object({
    grossMonthlyPay: z.coerce.number().finite().min(0).max(1_000_000_000),
    otherTaxableDeductions: z.coerce.number().finite().min(0).max(1_000_000_000).default(0),
    otherTaxReliefs: z.coerce.number().finite().min(0).max(1_000_000_000).default(0),
  }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide non-negative monthly gross pay and optional allowable deduction/relief amounts.' }); return }
  const estimate = estimateKenyaPayroll(input.data)
  if (estimate.netPayEstimate < 0) { response.status(409).json({ error: 'The installed estimate produces deductions greater than gross pay for these inputs. Do not use this result; review it with a qualified Kenyan payroll professional.' }); return }
  response.json(estimate)
})

app.post('/v1/invoices/:invoiceId/payments/mpesa', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requireWorkspaceProviderPreference('darajaEnabled'), rateLimit({ windowMs: 15 * 60_000, limit: 5 }), async (request: AuthedRequest, response, next) => {
  if (!mpesaConfigured) { response.status(503).json({ error: 'M-Pesa is not configured. Set all required MPESA_* API environment variables and a public callback URL.' }); return }
  if (env.MPESA_ENV === 'production' && !env.MPESA_CALLBACK_URL!.startsWith('https://')) { response.status(503).json({ error: 'Production Daraja requires a public HTTPS MPESA_CALLBACK_URL.' }); return }

  const input = z.object({ phone: z.string().trim().min(7).max(24) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Enter the customer’s Safaricom-compatible Kenyan phone number.' }); return }
  const phone = normalizeKenyanPhone(input.data.phone)
  if (!phone) { response.status(400).json({ error: 'Use a valid Kenyan mobile number, such as 0712345678 or 254712345678.' }); return }

  try {
    const client = await pool!.connect()
    let invoiceAmount: number
    const paymentId = randomUUID()
    try {
      await client.query('BEGIN')
      const invoiceResult = await client.query('SELECT id, amount, amount_paid, status FROM invoices WHERE id = $1 AND workspace_id = $2 FOR UPDATE', [request.params.invoiceId, request.session!.workspaceId])
      if (!invoiceResult.rowCount) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Invoice not found in this business.' }); return }
      invoiceAmount = Number(invoiceResult.rows[0].amount) - Number(invoiceResult.rows[0].amount_paid)
      if (invoiceResult.rows[0].status !== 'unpaid') { await client.query('ROLLBACK'); response.status(409).json({ error: 'Only unpaid invoices can be sent for M-Pesa payment.' }); return }
      if (!Number.isSafeInteger(invoiceAmount) || invoiceAmount < 1) { await client.query('ROLLBACK'); response.status(400).json({ error: 'M-Pesa STK Push requires a whole-number KSh invoice amount.' }); return }
      const activeRequest = await client.query("SELECT 1 FROM mpesa_payment_requests WHERE invoice_id = $1 AND workspace_id = $2 AND status IN ('initiating', 'pending', 'verification_required') LIMIT 1", [request.params.invoiceId, request.session!.workspaceId])
      if (activeRequest.rowCount) { await client.query('ROLLBACK'); response.status(409).json({ error: 'A payment request is already in progress for this invoice. Check its status before trying again.' }); return }
      await client.query('INSERT INTO mpesa_payment_requests (id, workspace_id, invoice_id, customer_phone, amount, status) VALUES ($1, $2, $3, $4, $5, $6)', [paymentId, request.session!.workspaceId, request.params.invoiceId, phone, invoiceAmount.toFixed(2), 'initiating'])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
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
      const client = await pool!.connect()
      try {
        await client.query('BEGIN')
        await client.query('UPDATE mpesa_payment_requests SET status = $1, merchant_request_id = $2, checkout_request_id = $3 WHERE id = $4', ['pending', String(result.MerchantRequestID ?? ''), checkoutRequestId, paymentId])
        await recordAudit(client, { workspaceId: request.session!.workspaceId, actorUserId: request.session!.userId, eventType: 'mpesa.stk_push_requested', entityType: 'mpesa_payment', entityId: paymentId, eventData: { invoiceId: request.params.invoiceId, amount: invoiceAmount, environment: env.MPESA_ENV } })
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
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
      const invoice = await client.query("UPDATE invoices SET amount_paid = amount_paid + $1, status = CASE WHEN amount_paid + $1 >= amount THEN 'paid' ELSE 'unpaid' END WHERE id = $2 AND workspace_id = $3 AND status = 'unpaid' AND amount_paid + $1 <= amount RETURNING customer, description", [payment.amount, payment.invoice_id, payment.workspace_id])
      if (!invoice.rowCount) throw new Error('Invoice was already paid or changed before this payment callback; review this payment against the bank statement.')
      await client.query('INSERT INTO invoice_payments (id, workspace_id, invoice_id, amount, payment_date) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), payment.workspace_id, payment.invoice_id, payment.amount, nairobiToday()])
      await insertJournal(client, { workspaceId: String(payment.workspace_id), userId: null, date: nairobiToday(), description: `M-Pesa receipt ${String(metadata.MpesaReceiptNumber)}`, sourceType: 'mpesa_payment', sourceId: String(payment.invoice_id), lines: [{ accountCode: '1000', debit: Number(payment.amount), credit: 0 }, { accountCode: '1100', debit: 0, credit: Number(payment.amount) }] })
      await recordAudit(client, { workspaceId: String(payment.workspace_id), actorUserId: null, eventType: 'mpesa.payment_verified', entityType: 'mpesa_payment', entityId: String(payment.id), eventData: { invoiceId: String(payment.invoice_id), receiptNumber: String(metadata.MpesaReceiptNumber), amount: String(payment.amount) } })
      await client.query('COMMIT')
      response.status(200).json({ ResultCode: 0, ResultDesc: 'Payment verified.' })
    } catch (error) { await client.query('ROLLBACK'); next(error) }
    finally { client.release() }
  } catch (error) { next(error) }
})

const complianceIntegration = z.enum(['kra_etims', 'bank_feeds', 'statutory_filing'])
const kraFiscalPayloadSchema = z.object({
  salesTyCd: z.string().trim().min(1).max(5),
  rcptTyCd: z.string().trim().min(1).max(5),
  salesSttsCd: z.string().trim().min(1).max(5),
  cfmDt: z.string().regex(/^\d{14}$/),
  salesDt: z.string().regex(/^\d{8}$/),
  stockRlsDt: z.string().regex(/^\d{14}$/).nullable().optional(),
  custTin: z.string().trim().max(11).nullable().optional(),
  custNm: z.string().trim().max(60).nullable().optional(),
  pmtTyCd: z.string().trim().max(5).nullable().optional(),
  taxblAmtA: z.coerce.number().finite().min(0), taxblAmtB: z.coerce.number().finite().min(0), taxblAmtC: z.coerce.number().finite().min(0), taxblAmtD: z.coerce.number().finite().min(0), taxblAmtE: z.coerce.number().finite().min(0),
  taxRtA: z.coerce.number().finite().min(0), taxRtB: z.coerce.number().finite().min(0), taxRtC: z.coerce.number().finite().min(0), taxRtD: z.coerce.number().finite().min(0), taxRtE: z.coerce.number().finite().min(0),
  taxAmtA: z.coerce.number().finite().min(0), taxAmtB: z.coerce.number().finite().min(0), taxAmtC: z.coerce.number().finite().min(0), taxAmtD: z.coerce.number().finite().min(0), taxAmtE: z.coerce.number().finite().min(0),
  totItemCnt: z.coerce.number().int().positive().max(1000),
  totTaxblAmt: z.coerce.number().finite().min(0), totTaxAmt: z.coerce.number().finite().min(0), totAmt: z.coerce.number().finite().positive(),
  prchrAcptcYn: z.enum(['Y', 'N']),
  remark: z.string().max(400).nullable().optional(),
  receipt: z.object({ custTin: z.string().max(11).nullable().optional(), custMblNo: z.string().max(20).nullable().optional(), rcptPbctDt: z.string().regex(/^\d{14}$/), trdeNm: z.string().max(20).nullable().optional(), adrs: z.string().max(200).nullable().optional(), topMsg: z.string().max(20).nullable().optional(), btmMsg: z.string().max(20).nullable().optional(), prchrAcptcYn: z.enum(['Y', 'N']) }),
  itemList: z.array(z.object({ itemSeq: z.coerce.number().int().positive(), itemClsCd: z.string().trim().max(10).nullable().optional(), itemCd: z.string().trim().min(1).max(20), itemNm: z.string().trim().min(1).max(200), bcd: z.string().max(20).nullable().optional(), pkgUnitCd: z.string().trim().min(1).max(5), pkg: z.coerce.number().finite().min(0), qtyUnitCd: z.string().trim().min(1).max(5), qty: z.coerce.number().finite().positive(), prc: z.coerce.number().finite().min(0), splyAmt: z.coerce.number().finite().min(0), dcRt: z.coerce.number().finite().min(0).default(0), dcAmt: z.coerce.number().finite().min(0).default(0), taxTyCd: z.enum(['A', 'B', 'C', 'D', 'E']), taxblAmt: z.coerce.number().finite().min(0), taxAmt: z.coerce.number().finite().min(0), totAmt: z.coerce.number().finite().min(0) })).min(1).max(1000),
}).superRefine((payload, context) => {
  const cents = (value: number) => Math.round((value + Number.EPSILON) * 100)
  const categories = ['A', 'B', 'C', 'D', 'E'] as const
  const totalTaxable = payload.itemList.reduce((sum, item) => sum + cents(item.taxblAmt), 0)
  const totalTax = payload.itemList.reduce((sum, item) => sum + cents(item.taxAmt), 0)
  const totalAmount = payload.itemList.reduce((sum, item) => sum + cents(item.totAmt), 0)
  if (payload.totItemCnt !== payload.itemList.length) context.addIssue({ code: 'custom', path: ['totItemCnt'], message: 'Must equal the number of itemList entries.' })
  if (cents(payload.totTaxblAmt) !== totalTaxable || cents(payload.totTaxAmt) !== totalTax || cents(payload.totAmt) !== totalAmount) context.addIssue({ code: 'custom', path: ['totAmt'], message: 'Document totals must match the sums of its item lines.' })
  for (const category of categories) {
    const categoryTaxable = payload.itemList.filter((item) => item.taxTyCd === category).reduce((sum, item) => sum + cents(item.taxblAmt), 0)
    const categoryTax = payload.itemList.filter((item) => item.taxTyCd === category).reduce((sum, item) => sum + cents(item.taxAmt), 0)
    if (cents(payload[`taxblAmt${category}`]) !== categoryTaxable || cents(payload[`taxAmt${category}`]) !== categoryTax) context.addIssue({ code: 'custom', path: [`taxblAmt${category}`], message: `Tax category ${category} totals must match itemList.` })
  }
})
type KraOsuCredentials = { taxpayerPin: string; branchId: string; deviceSerial: string; cmcKey?: string }
async function kraOsuRequest<T extends Record<string, unknown>>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${kraEtimsApiBase}${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000),
  })
  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(`KRA OSCU returned HTTP ${response.status}: ${String(result.resultMsg ?? 'request failed').slice(0, 300)}`)
  return result as T
}
function assertKraSuccess(result: Record<string, unknown>) {
  const code = String(result.resultCd ?? '')
  if (code !== '000') throw Object.assign(new Error(`KRA eTIMS rejected the request (${code || 'no result code'}): ${String(result.resultMsg ?? 'unknown KRA response').slice(0, 400)}`), { kraResult: result })
}
app.get('/v1/integrations/etims/config', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT environment, device_id, sdc_id, mrc_no, initialized_at, updated_at FROM kra_oscu_workspaces WHERE workspace_id = $1', [request.session!.workspaceId])
    const row = result.rows[0]
    response.json({ configured: Boolean(row), environment: env.KRA_ETIMS_ENV, liveSubmissionsEnabled: kraEtimsLiveEnabled, initialized: Boolean(row?.initialized_at), device: row ? { deviceId: row.device_id, sdcId: row.sdc_id, mrcNo: row.mrc_no, initializedAt: row.initialized_at } : null, credentialsEncryptionReady: Boolean(env.KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY), apiBase: kraEtimsApiBase })
  } catch (error) { next(error) }
})
app.put('/v1/integrations/etims/device', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requireWorkspaceProviderPreference('kraEtimsLiveEnabled', true), async (request: AuthedRequest, response, next) => {
  if (!env.KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY) { response.status(503).json({ error: 'Set KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY on the API service before configuring OSCU credentials.' }); return }
  if (env.KRA_ETIMS_ENV === 'production' && !kraEtimsLiveEnabled) { response.status(503).json({ error: 'Production OSCU is disabled. Verify KRA production approval, then explicitly set KRA_ETIMS_LIVE_ENABLED=true on the API service.' }); return }
  const input = z.object({ taxpayerPin: z.string().trim().regex(/^[A-Z0-9]{11}$/i), branchId: z.string().trim().regex(/^\d{2}$/), deviceSerial: z.string().trim().min(1).max(100) }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Provide an 11-character KRA PIN, two-character branch ID (00 for head office), and KRA-approved device serial.' }); return }
  try {
    const encrypted = encryptKraCredentials({ taxpayerPin: input.data.taxpayerPin.toUpperCase(), branchId: input.data.branchId, deviceSerial: input.data.deviceSerial })
    await pool!.query(`INSERT INTO kra_oscu_workspaces (workspace_id, credentials_encrypted, environment) VALUES ($1, $2, $3)
      ON CONFLICT (workspace_id) DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted, environment = EXCLUDED.environment, device_id = NULL, sdc_id = NULL, mrc_no = NULL, initialized_at = NULL, updated_at = now()`, [request.session!.workspaceId, encrypted, env.KRA_ETIMS_ENV])
    response.status(200).json({ configured: true, initialized: false, environment: env.KRA_ETIMS_ENV, notice: 'Device details saved encrypted. Initialize only after KRA has approved this taxpayer/device for the selected OSCU environment.' })
  } catch (error) { next(error) }
})
app.post('/v1/integrations/etims/initialize', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requireWorkspaceProviderPreference('kraEtimsLiveEnabled', true), async (request: AuthedRequest, response, next) => {
  if (!env.KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY) { response.status(503).json({ error: 'KRA OSCU credential encryption is not configured on the API service.' }); return }
  if (env.KRA_ETIMS_ENV === 'production' && !kraEtimsLiveEnabled) { response.status(503).json({ error: 'Production OSCU is disabled until its server-side kill switch is explicitly enabled after KRA approval.' }); return }
  try {
    const row = await pool!.query('SELECT credentials_encrypted FROM kra_oscu_workspaces WHERE workspace_id = $1', [request.session!.workspaceId])
    if (!row.rowCount) { response.status(409).json({ error: 'Save the KRA PIN, branch, and approved device serial first.' }); return }
    const credentials = decryptKraCredentials<KraOsuCredentials>(String(row.rows[0].credentials_encrypted))
    const result = await kraOsuRequest<Record<string, unknown>>('/selectInitOsdcInfo', { tin: credentials.taxpayerPin, bhfId: credentials.branchId, dvcSrlNo: credentials.deviceSerial })
    assertKraSuccess(result)
    const data = (result.data && typeof result.data === 'object' ? result.data : {}) as Record<string, unknown>
    const info = (data.info && typeof data.info === 'object' ? data.info : {}) as Record<string, unknown>
    const cmcKey = String(info.cmcKey ?? '')
    if (!cmcKey) { response.status(502).json({ error: 'KRA initialization returned success but no communication key; do not submit invoices until device activation is resolved with KRA.' }); return }
    const encrypted = encryptKraCredentials({ ...credentials, cmcKey })
    await pool!.query('UPDATE kra_oscu_workspaces SET credentials_encrypted = $1, device_id = $2, sdc_id = $3, mrc_no = $4, initialized_at = now(), updated_at = now() WHERE workspace_id = $5', [encrypted, String(info.dvcId ?? ''), String(info.sdcId ?? info.sdicId ?? ''), String(info.mrcNo ?? ''), request.session!.workspaceId])
    response.json({ initialized: true, environment: env.KRA_ETIMS_ENV, device: { deviceId: info.dvcId ?? null, sdcId: info.sdcId ?? info.sdicId ?? null, mrcNo: info.mrcNo ?? null }, notice: 'KRA device initialization succeeded. Communication credentials are encrypted at rest and were not returned to the browser.' })
  } catch (error) {
    if (error instanceof Error && 'kraResult' in error) { response.status(502).json({ error: error.message, providerResponse: (error as Error & { kraResult?: unknown }).kraResult }); return }
    next(error)
  }
})
app.get('/v1/integrations/etims/codes', requirePool, requireSession, requireWorkspaceProviderPreference('kraEtimsLiveEnabled', true), async (request: AuthedRequest, response, next) => {
  if (!env.KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY) { response.status(503).json({ error: 'KRA OSCU credential encryption is not configured.' }); return }
  try {
    const row = await pool!.query('SELECT credentials_encrypted, initialized_at FROM kra_oscu_workspaces WHERE workspace_id = $1', [request.session!.workspaceId])
    if (!row.rowCount || !row.rows[0].initialized_at) { response.status(409).json({ error: 'Initialize the KRA OSCU device before requesting official tax and item codes.' }); return }
    const credentials = decryptKraCredentials<KraOsuCredentials>(String(row.rows[0].credentials_encrypted))
    const result = await kraOsuRequest<Record<string, unknown>>('/selectCodeList', { tin: credentials.taxpayerPin, bhfId: credentials.branchId, cmcKey: credentials.cmcKey, lastReqDt: '20180101000000' })
    assertKraSuccess(result)
    response.json({ result, source: 'KRA eTIMS OSCU', environment: env.KRA_ETIMS_ENV })
  } catch (error) {
    if (error instanceof Error && 'kraResult' in error) { response.status(502).json({ error: error.message, providerResponse: (error as Error & { kraResult?: unknown }).kraResult }); return }
    next(error)
  }
})

app.get('/v1/integrations/onboarding', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT integration_type, milestone, self_reported_note, details, updated_at FROM integration_onboarding WHERE workspace_id = $1 ORDER BY integration_type', [request.session!.workspaceId])
    response.json({ onboarding: result.rows, notice: 'Milestones are self-reported workspace tracking only; they do not establish provider approval or certification.' })
  } catch (error) { next(error) }
})
app.put('/v1/integrations/onboarding/:integrationType', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const type = complianceIntegration.safeParse(request.params.integrationType)
  const input = z.object({ milestone: z.enum(['not_started', 'application_in_progress', 'sandbox_testing', 'certification_review', 'certified']), note: z.string().trim().max(1000).default(''), details: z.record(z.string(), z.union([z.string().trim().max(500), z.boolean()])).default({}) }).safeParse(request.body)
  if (!type.success || !input.success) { response.status(400).json({ error: 'Choose a supported integration and valid onboarding milestone.' }); return }
  if (input.data.milestone === 'certified' && type.data !== 'kra_etims') { response.status(400).json({ error: 'The certification milestone applies only to eTIMS; statutory routes and bank-feed approvals are tracked separately.' }); return }
  const safeDetails = { ...input.data.details }
  if (type.data === 'kra_etims') {
    const allowed = ['solution', 'taxpayerPin', 'sandboxReference', 'certificationReference', 'productionApprovalReference']
    if (Object.keys(safeDetails).some((key) => !allowed.includes(key))) { response.status(400).json({ error: 'KRA profile accepts only route and non-secret certification references. Never submit passwords or private keys here.' }); return }
    delete safeDetails.taxpayerPin
    if (input.data.milestone === 'sandbox_testing' && (!input.data.details.solution || !input.data.details.sandboxReference)) { response.status(400).json({ error: 'Select OSCU/VSCU and record the KRA sandbox registration reference before marking sandbox testing.' }); return }
    if (input.data.milestone === 'certified' && (!input.data.details.solution || !input.data.details.sandboxReference || !input.data.details.certificationReference || !input.data.details.productionApprovalReference)) { response.status(400).json({ error: 'A self-reported certified milestone requires the solution, sandbox reference, certification reference, and production approval reference. This will still not verify certification.' }); return }
  }
  if (type.data === 'statutory_filing') {
    const allowed = ['payeRoute', 'ahlRoute', 'shifRoute', 'nssfRoute', 'providerName', 'routeConfirmationReference', 'routesConfirmed']
    if (Object.keys(input.data.details).some((key) => !allowed.includes(key))) { response.status(400).json({ error: 'Statutory profile accepts filing-route details and non-secret evidence references only. Do not enter passwords or API keys.' }); return }
  }
  try {
    const result = await pool!.query('INSERT INTO integration_onboarding (workspace_id, integration_type, milestone, self_reported_note, details, updated_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6) ON CONFLICT (workspace_id, integration_type) DO UPDATE SET milestone = EXCLUDED.milestone, self_reported_note = EXCLUDED.self_reported_note, details = EXCLUDED.details, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING integration_type, milestone, self_reported_note, details, updated_at', [request.session!.workspaceId, type.data, input.data.milestone, input.data.note, JSON.stringify(safeDetails), request.session!.userId])
    response.json({ onboarding: result.rows[0], verified: false, notice: 'Details are self-reported, not verified. Do not store secrets in this profile.' })
  } catch (error) { next(error) }
})
app.get('/v1/integrations/drafts', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, integration_type, source_type, source_id, payload_version, draft_payload, workflow_status, provider_status, external_invoice_number, fiscal_receipt_signature, reviewer_name, reviewer_qualification, reviewer_registration, reviewer_reference, reviewer_attested_at, created_at, updated_at FROM compliance_submission_drafts WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 100', [request.session!.workspaceId])
    response.json({ drafts: result.rows })
  } catch (error) { next(error) }
})
app.post('/v1/integrations/etims/drafts/:invoiceId', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  try {
    const invoiceResult = await pool!.query('SELECT i.id, i.customer, i.customer_email, i.description, i.amount::text, i.due_date, i.status, w.name AS business_name FROM invoices i JOIN workspaces w ON w.id = i.workspace_id WHERE i.id = $1 AND i.workspace_id = $2', [request.params.invoiceId, request.session!.workspaceId])
    const invoiceRow = invoiceResult.rows[0]
    if (!invoiceRow) { response.status(404).json({ error: 'Invoice not found in this workspace.' }); return }
    const draftPayload = { invoiceId: invoiceRow.id, businessName: invoiceRow.business_name, customer: invoiceRow.customer, customerEmail: invoiceRow.customer_email, description: invoiceRow.description, amount: invoiceRow.amount, dueDate: invoiceRow.due_date, internalStatus: invoiceRow.status, taxBreakdown: null, note: 'Internal invoice snapshot only. Map tax types, rates, trader and item fields using the current KRA OSCU/VSCU specification before submission.' }
    const result = await pool!.query("INSERT INTO compliance_submission_drafts (workspace_id, integration_type, source_type, source_id, payload_version, draft_payload, created_by) VALUES ($1, 'kra_etims', 'invoice', $2, 'kashflow-etims-draft-v1', $3::jsonb, $4) ON CONFLICT (workspace_id, integration_type, source_type, source_id) DO NOTHING RETURNING id, integration_type, source_type, source_id, payload_version, draft_payload, workflow_status, provider_status, created_at, updated_at", [request.session!.workspaceId, invoiceRow.id, JSON.stringify(draftPayload), request.session!.userId])
    const draft = result.rows[0] ?? (await pool!.query("SELECT id, integration_type, source_type, source_id, payload_version, draft_payload, workflow_status, provider_status, created_at, updated_at FROM compliance_submission_drafts WHERE workspace_id = $1 AND integration_type = 'kra_etims' AND source_type = 'invoice' AND source_id = $2", [request.session!.workspaceId, invoiceRow.id])).rows[0]
    response.status(201).json({ draft, providerSubmission: 'blocked_uncertified_adapter', notice: 'Draft created only. No request was sent to KRA and this is not a fiscal invoice.' })
  } catch (error) { next(error) }
})
app.put('/v1/integrations/etims/drafts/:draftId/fiscal-payload', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = kraFiscalPayloadSchema.safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Fiscal payload is invalid or totals do not reconcile.', issues: input.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) }); return }
  try {
    const draft = await pool!.query("SELECT id, source_id FROM compliance_submission_drafts WHERE id = $1 AND workspace_id = $2 AND integration_type = 'kra_etims' AND source_type = 'invoice' AND workflow_status = 'draft' AND provider_status IN ('blocked_no_certified_adapter', 'rejected_by_kra')", [request.params.draftId, request.session!.workspaceId])
    if (!draft.rowCount) { response.status(404).json({ error: 'Editable KRA eTIMS invoice draft not found.' }); return }
    const invoice = await pool!.query('SELECT amount::text, status FROM invoices WHERE id = $1 AND workspace_id = $2', [draft.rows[0].source_id, request.session!.workspaceId])
    if (!invoice.rowCount || invoice.rows[0].status === 'void') { response.status(409).json({ error: 'Invoice is unavailable or void.' }); return }
    if (Math.round(Number(invoice.rows[0].amount) * 100) !== Math.round(input.data.totAmt * 100)) { response.status(409).json({ error: 'KRA fiscal total must exactly match the saved internal invoice total. Edit the internal invoice or fiscal data first.' }); return }
    const result = await pool!.query("UPDATE compliance_submission_drafts SET draft_payload = jsonb_set(draft_payload, '{fiscalPayload}', $1::jsonb, true), provider_status = 'blocked_no_certified_adapter', provider_result = NULL, external_invoice_number = NULL, fiscal_receipt_signature = NULL, provider_submitted_at = NULL, updated_at = now() WHERE id = $2 AND workspace_id = $3 RETURNING id, payload_version, workflow_status, updated_at", [JSON.stringify(input.data), request.params.draftId, request.session!.workspaceId])
    response.json({ draft: result.rows[0], notice: 'KRA payload saved for review. Codes must be selected from current KRA code lists; no request was sent.' })
  } catch (error) { next(error) }
})
app.post('/v1/integrations/statutory/drafts/:runId', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requirePayrollEncryption, async (request: AuthedRequest, response, next) => {
  try {
    const runResult = await pool!.query('SELECT id, period, status, rule_set, employee_count, gross_total::text, net_total::text, paye_total::text, shif_total::text, nssf_employee_total::text, nssf_employer_total::text, housing_employee_total::text, housing_employer_total::text FROM payroll_runs WHERE id = $1 AND workspace_id = $2', [request.params.runId, request.session!.workspaceId])
    const run = runResult.rows[0]
    if (!run) { response.status(404).json({ error: 'Payroll run not found in this workspace.' }); return }
    if (run.status === 'draft') { response.status(409).json({ error: 'Review and post this payroll run before preparing its filing package.' }); return }
    const routeProfile = await pool!.query("SELECT details FROM integration_onboarding WHERE workspace_id = $1 AND integration_type = 'statutory_filing'", [request.session!.workspaceId])
    const draftPayload = { payrollRunId: run.id, period: run.period, payrollStatus: run.status, ruleSet: run.rule_set, employeeCount: run.employee_count, totals: { gross: run.gross_total, net: run.net_total, paye: run.paye_total, shif: run.shif_total, nssfEmployee: run.nssf_employee_total, nssfEmployer: run.nssf_employer_total, housingEmployee: run.housing_employee_total, housingEmployer: run.housing_employer_total }, returnMappings: null, routePlan: routeProfile.rows[0]?.details ?? {}, note: 'Preparation summary only, not a statutory return. Validate current rates, employee-level data and form schemas with qualified Kenyan payroll professionals and each authority/provider.' }
    const result = await pool!.query("INSERT INTO compliance_submission_drafts (workspace_id, integration_type, source_type, source_id, payload_version, draft_payload, created_by) VALUES ($1, 'statutory_filing', 'payroll_run', $2, 'kashflow-statutory-draft-v1', $3::jsonb, $4) ON CONFLICT (workspace_id, integration_type, source_type, source_id) DO NOTHING RETURNING id, integration_type, source_type, source_id, payload_version, draft_payload, workflow_status, provider_status, created_at, updated_at", [request.session!.workspaceId, run.id, JSON.stringify(draftPayload), request.session!.userId])
    const draft = result.rows[0] ?? (await pool!.query("SELECT id, integration_type, source_type, source_id, payload_version, draft_payload, workflow_status, provider_status, reviewer_name, reviewer_qualification, reviewer_registration, reviewer_reference, reviewer_attested_at, created_at, updated_at FROM compliance_submission_drafts WHERE workspace_id = $1 AND integration_type = 'statutory_filing' AND source_type = 'payroll_run' AND source_id = $2", [request.session!.workspaceId, run.id])).rows[0]
    response.status(201).json({ draft, providerSubmission: 'blocked_no_authorized_filing_adapter', notice: 'Preparation draft only. No tax or contribution authority was contacted and no payment or return was filed.' })
  } catch (error) { next(error) }
})
app.patch('/v1/integrations/drafts/:draftId', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, async (request: AuthedRequest, response, next) => {
  const input = z.object({ workflowStatus: z.enum(['draft', 'reviewed', 'cancelled']), reviewerName: z.string().trim().min(2).max(160).optional(), reviewerQualification: z.string().trim().min(2).max(160).optional(), reviewerRegistration: z.string().trim().min(2).max(100).optional(), reviewerReference: z.string().trim().min(2).max(200).optional() }).safeParse(request.body)
  if (!input.success) { response.status(400).json({ error: 'Workflow status must be draft, reviewed, or cancelled.' }); return }
  try {
    const existing = await pool!.query('SELECT integration_type, draft_payload FROM compliance_submission_drafts WHERE id = $1 AND workspace_id = $2', [request.params.draftId, request.session!.workspaceId])
    if (!existing.rowCount) { response.status(404).json({ error: 'Draft not found in this workspace.' }); return }
    const isStatutory = existing.rows[0].integration_type === 'statutory_filing'
    const isKraEtims = existing.rows[0].integration_type === 'kra_etims'
    if (input.data.workflowStatus === 'reviewed' && isKraEtims) {
      const fiscal = kraFiscalPayloadSchema.safeParse((existing.rows[0].draft_payload as Record<string, unknown>)?.fiscalPayload)
      if (!fiscal.success) { response.status(409).json({ error: 'Save a complete KRA OSCU fiscal payload with reconciled totals before marking this invoice draft reviewed.' }); return }
      const device = await pool!.query('SELECT initialized_at FROM kra_oscu_workspaces WHERE workspace_id = $1 AND environment = $2', [request.session!.workspaceId, env.KRA_ETIMS_ENV])
      if (!device.rowCount || !device.rows[0].initialized_at) { response.status(409).json({ error: `Configure and initialize a KRA ${env.KRA_ETIMS_ENV} OSCU device before review.` }); return }
      if (env.KRA_ETIMS_ENV === 'production') {
        const profile = await pool!.query("SELECT milestone, details FROM integration_onboarding WHERE workspace_id = $1 AND integration_type = 'kra_etims'", [request.session!.workspaceId])
        const details = (profile.rows[0]?.details ?? {}) as Record<string, unknown>
        if (!kraEtimsLiveEnabled || profile.rows[0]?.milestone !== 'certified' || !details.certificationReference || !details.productionApprovalReference) { response.status(409).json({ error: 'Production review is blocked until the server production switch is enabled and KRA certification/production approval references are recorded. References are self-reported and not independently verified.' }); return }
      }
    }
    if (input.data.workflowStatus === 'reviewed' && isStatutory && (!input.data.reviewerName || !input.data.reviewerQualification || !input.data.reviewerRegistration || !input.data.reviewerReference)) {
      response.status(400).json({ error: 'Statutory review requires reviewer name, qualification, professional registration/member number, and review reference.' }); return
    }
    if (input.data.workflowStatus === 'reviewed' && isStatutory) {
      const profile = await pool!.query("SELECT details FROM integration_onboarding WHERE workspace_id = $1 AND integration_type = 'statutory_filing'", [request.session!.workspaceId])
      const details = (profile.rows[0]?.details ?? {}) as Record<string, unknown>
      if (details.routesConfirmed !== true || !details.routeConfirmationReference || !details.payeRoute || !details.ahlRoute || !details.shifRoute || !details.nssfRoute) { response.status(409).json({ error: 'Confirm and record PAYE, AHL, SHIF, and NSSF routes plus the authority/provider confirmation reference before marking this draft reviewed. This route record is self-reported, not verified.' }); return }
      if ([details.payeRoute, details.ahlRoute, details.shifRoute, details.nssfRoute].includes('authorized_provider') && !details.providerName) { response.status(409).json({ error: 'Provide the authorized provider name and its reference for provider-routed submissions.' }); return }
    }
    const result = await pool!.query('UPDATE compliance_submission_drafts SET workflow_status = $1, reviewer_name = COALESCE($2, reviewer_name), reviewer_qualification = COALESCE($3, reviewer_qualification), reviewer_registration = COALESCE($4, reviewer_registration), reviewer_reference = COALESCE($5, reviewer_reference), reviewer_attested_at = CASE WHEN $6 THEN now() ELSE reviewer_attested_at END, updated_at = now() WHERE id = $7 AND workspace_id = $8 AND provider_status = $9 RETURNING id, integration_type, source_type, workflow_status, provider_status, reviewer_name, reviewer_qualification, reviewer_registration, reviewer_reference, reviewer_attested_at, updated_at', [input.data.workflowStatus, input.data.reviewerName ?? null, input.data.reviewerQualification ?? null, input.data.reviewerRegistration ?? null, input.data.reviewerReference ?? null, isStatutory && input.data.workflowStatus === 'reviewed', request.params.draftId, request.session!.workspaceId, 'blocked_no_certified_adapter'])
    if (!result.rowCount) { response.status(404).json({ error: 'Draft not found in this workspace.' }); return }
    response.json({ draft: result.rows[0], notice: isStatutory && input.data.workflowStatus === 'reviewed' ? 'Reviewer details are self-reported and unverified; this is not legal approval. No provider submission occurred.' : 'This changes internal draft workflow only; no provider submission occurred.' })
  } catch (error) { next(error) }
})
app.post('/v1/integrations/drafts/:draftId/submit', requirePool, verifyOrigin, requireSession, requireWorkspaceAdmin, requireWorkspaceProviderPreference('kraEtimsLiveEnabled', true), async (request: AuthedRequest, response, next) => {
  try {
    const result = await pool!.query('SELECT id, integration_type, source_type, source_id, draft_payload, workflow_status, provider_status, external_invoice_number, provider_result FROM compliance_submission_drafts WHERE id = $1 AND workspace_id = $2', [request.params.draftId, request.session!.workspaceId])
    const draft = result.rows[0]
    if (!draft) { response.status(404).json({ error: 'Draft not found in this workspace.' }); return }
    if (draft.integration_type === 'kra_etims' && draft.provider_status === 'accepted_by_kra') { response.json({ submissionStatus: 'accepted_by_kra', result: draft.provider_result, externalInvoiceNumber: draft.external_invoice_number, duplicateRequest: true }); return }
    if (draft.integration_type === 'kra_etims' && ['submitted_to_kra', 'submission_unknown'].includes(String(draft.provider_status))) { response.status(409).json({ error: 'A prior KRA request may have reached KRA. Do not retry and create a duplicate fiscal invoice; reconcile this draft with KRA before any retry.', submissionStatus: draft.provider_status, externalInvoiceNumber: draft.external_invoice_number }); return }
    if (draft.workflow_status !== 'reviewed') { response.status(409).json({ error: 'Mark the draft internally reviewed before requesting an authority submission.' }); return }
    const integrationType = String(draft.integration_type)
    if (integrationType === 'statutory_filing') {
      const [review, routeProfile] = await Promise.all([
        pool!.query('SELECT reviewer_name, reviewer_qualification, reviewer_registration, reviewer_reference FROM compliance_submission_drafts WHERE id = $1 AND workspace_id = $2', [draft.id, request.session!.workspaceId]),
        pool!.query("SELECT details FROM integration_onboarding WHERE workspace_id = $1 AND integration_type = 'statutory_filing'", [request.session!.workspaceId]),
      ])
      const routeDetails = (routeProfile.rows[0]?.details ?? {}) as Record<string, unknown>
      if (!review.rows[0]?.reviewer_name || !review.rows[0]?.reviewer_qualification || !review.rows[0]?.reviewer_registration || !review.rows[0]?.reviewer_reference) { response.status(409).json({ error: 'Qualified Kenyan payroll/tax review details and professional registration are required. No submission was sent.' }); return }
      if (routeDetails.routesConfirmed !== true || !routeDetails.routeConfirmationReference || !routeDetails.payeRoute || !routeDetails.ahlRoute || !routeDetails.shifRoute || !routeDetails.nssfRoute) { response.status(409).json({ error: 'Record and confirm the filing route and authority/provider reference for PAYE, AHL, SHIF, and NSSF before attempting filing. Route confirmation is self-reported, not verified. No submission was sent.' }); return }
      if ([routeDetails.payeRoute, routeDetails.ahlRoute, routeDetails.shifRoute, routeDetails.nssfRoute].includes('authorized_provider') && !routeDetails.providerName) { response.status(409).json({ error: 'Record the authorized provider name and approval reference for the selected provider route. No submission was sent.' }); return }
      const provider = 'authorized statutory filing adapter'
      response.status(503).json({ error: `Submission is blocked: no ${provider} is installed and verified for this business.`, submissionStatus: 'not_submitted', required: ['Obtain qualified Kenyan payroll/tax review and verify reviewer registration', 'Confirm PAYE, AHL, SHIF, and NSSF routes with authorities/providers', 'Obtain official return specifications and authorized machine-to-machine access', 'Implement and certify each separate return adapter'] })
      return
    } else if (integrationType === 'kra_etims') {
      if (!env.KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY) { response.status(503).json({ error: 'KRA credential encryption is not configured on the API service.', submissionStatus: 'not_submitted' }); return }
      if (!draft.draft_payload || typeof draft.draft_payload !== 'object' || !('fiscalPayload' in draft.draft_payload)) { response.status(409).json({ error: 'Complete and save KRA fiscal data from current official code lists before submission.', submissionStatus: 'not_submitted' }); return }
      const fiscal = kraFiscalPayloadSchema.safeParse((draft.draft_payload as Record<string, unknown>).fiscalPayload)
      if (!fiscal.success) { response.status(409).json({ error: 'Saved KRA fiscal payload is invalid; update and review it before submission.', submissionStatus: 'not_submitted' }); return }
      const sourceInvoice = await pool!.query('SELECT amount::text, status FROM invoices WHERE id = $1 AND workspace_id = $2', [draft.source_id, request.session!.workspaceId])
      if (!sourceInvoice.rowCount || sourceInvoice.rows[0].status === 'void') { response.status(409).json({ error: 'The source invoice is missing or void. No KRA request was sent.', submissionStatus: 'not_submitted' }); return }
      if (Math.round(Number(sourceInvoice.rows[0].amount) * 100) !== Math.round(fiscal.data.totAmt * 100)) { response.status(409).json({ error: 'The saved invoice total changed after draft review. Update and review the fiscal payload again before submitting.', submissionStatus: 'not_submitted' }); return }
      if (env.KRA_ETIMS_ENV === 'production') {
        if (!kraEtimsLiveEnabled) { response.status(503).json({ error: 'Production eTIMS is disabled by KRA_ETIMS_LIVE_ENABLED. Keep sandbox mode until KRA production certification/approval and customer credentials have been confirmed.', submissionStatus: 'not_submitted' }); return }
        if (!env.KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY) { response.status(503).json({ error: 'Production eTIMS requires persistent server-side credential encryption.', submissionStatus: 'not_submitted' }); return }
      }
      const profile = await pool!.query("SELECT milestone, details FROM integration_onboarding WHERE workspace_id = $1 AND integration_type = 'kra_etims'", [request.session!.workspaceId])
      const profileRow = profile.rows[0]
      const details = (profileRow?.details ?? {}) as Record<string, unknown>
      if (env.KRA_ETIMS_ENV === 'production' && (profileRow?.milestone !== 'certified' || !details.solution || !details.sandboxReference || !details.certificationReference || !details.productionApprovalReference)) {
        response.status(409).json({ error: 'Record the OSCU/VSCU solution, sandbox, certification and production approval references before production submission. These entries are self-reported and KRA approval is not verified by KashFlow. No submission was sent.' }); return
      }
      const device = await pool!.query('SELECT credentials_encrypted, initialized_at FROM kra_oscu_workspaces WHERE workspace_id = $1 AND environment = $2', [request.session!.workspaceId, env.KRA_ETIMS_ENV])
      if (!device.rowCount || !device.rows[0].initialized_at) { response.status(409).json({ error: `Configure and initialize an approved KRA ${env.KRA_ETIMS_ENV} OSCU device first.`, submissionStatus: 'not_submitted' }); return }
      const credentials = decryptKraCredentials<KraOsuCredentials>(String(device.rows[0].credentials_encrypted))
      if (!credentials.cmcKey) { response.status(409).json({ error: 'KRA device communication key is missing; initialize the device again.', submissionStatus: 'not_submitted' }); return }
      const counterClient = await pool!.connect()
      let invoiceNumber: number
      try {
        await counterClient.query('BEGIN')
        await counterClient.query('INSERT INTO kra_oscu_invoice_counters (workspace_id, last_invoice_number) VALUES ($1, 0) ON CONFLICT (workspace_id) DO NOTHING', [request.session!.workspaceId])
        const counter = await counterClient.query('SELECT last_invoice_number FROM kra_oscu_invoice_counters WHERE workspace_id = $1 FOR UPDATE', [request.session!.workspaceId])
        invoiceNumber = Number(counter.rows[0].last_invoice_number) + 1
        await counterClient.query('UPDATE kra_oscu_invoice_counters SET last_invoice_number = $1 WHERE workspace_id = $2', [invoiceNumber, request.session!.workspaceId])
        const reservation = await counterClient.query("UPDATE compliance_submission_drafts SET provider_status = 'submitted_to_kra', external_invoice_number = $1, provider_submitted_at = now(), updated_at = now() WHERE id = $2 AND workspace_id = $3 AND provider_status IN ('blocked_no_certified_adapter', 'rejected_by_kra') RETURNING id", [String(invoiceNumber), draft.id, request.session!.workspaceId])
        if (!reservation.rowCount) { await counterClient.query('ROLLBACK'); response.status(409).json({ error: 'A concurrent request already reserved this KRA invoice. Reconcile its provider status before retrying.' }); return }
        await counterClient.query('COMMIT')
      } catch (error) { await counterClient.query('ROLLBACK'); throw error }
      finally { counterClient.release() }
      const requestPayload = { tin: credentials.taxpayerPin, bhfId: credentials.branchId, cmcKey: credentials.cmcKey, trdInvcNo: `KF-${String(draft.source_id).replace(/-/g, '').slice(0, 40)}`, invcNo: invoiceNumber, orgInvcNo: 0, ...fiscal.data }
      try {
        const providerResult = await kraOsuRequest<Record<string, unknown>>('/saveTrnsSalesOsdc', requestPayload)
        const success = String(providerResult.resultCd ?? '') === '000'
        const data = providerResult.data && typeof providerResult.data === 'object' ? providerResult.data : null
        await pool!.query(`UPDATE compliance_submission_drafts SET provider_status = $1, provider_result = $2::jsonb, fiscal_receipt_signature = $3,
          workflow_status = CASE WHEN $4 THEN workflow_status ELSE 'draft' END,
          external_invoice_number = CASE WHEN $4 THEN external_invoice_number ELSE NULL END,
          provider_submitted_at = CASE WHEN $4 THEN provider_submitted_at ELSE NULL END,
          updated_at = now() WHERE id = $5 AND workspace_id = $6`, [success ? 'accepted_by_kra' : 'rejected_by_kra', JSON.stringify(providerResult), data && typeof data === 'object' ? String((data as Record<string, unknown>).rcptSign ?? '') : null, success, draft.id, request.session!.workspaceId])
        response.status(success ? 200 : 502).json({ submissionStatus: success ? 'accepted_by_kra' : 'rejected_by_kra', externalInvoiceNumber: String(invoiceNumber), result: providerResult, environment: env.KRA_ETIMS_ENV, notice: success ? 'KRA OSCU accepted the fiscalization request. Verify the returned receipt/signature in KRA records.' : 'KRA rejected the fiscalization request; correct the provider response issues before creating a replacement request.' })
      } catch (error) {
        await pool!.query("UPDATE compliance_submission_drafts SET provider_status = 'submission_unknown', provider_result = $1::jsonb, updated_at = now() WHERE id = $2 AND workspace_id = $3", [JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 500) : 'Network result unknown.' }), draft.id, request.session!.workspaceId])
        response.status(504).json({ error: 'KRA request outcome is unknown due to a network/provider error. Do not retry automatically; reconcile by taxpayer PIN and reserved invoice number first.', submissionStatus: 'submission_unknown', externalInvoiceNumber: String(invoiceNumber) })
      }
      return
    }
    response.status(400).json({ error: 'Unsupported authority submission type.' })
  } catch (error) { next(error) }
})

app.get('/v1/integrations/readiness', requirePool, requireSession, async (request: AuthedRequest, response, next) => {
  try {
    const workspaceSettings = await pool!.query('SELECT preferences FROM workspace_settings WHERE workspace_id = $1', [request.session!.workspaceId])
    const settings = { ...defaultWorkspaceSettings, ...(workspaceSettings.rows[0]?.preferences ?? {}) }
    const callbackIsSecure = env.MPESA_ENV !== 'production' || env.MPESA_CALLBACK_URL?.startsWith('https://') === true
    const mpesaReady = Boolean(settings.darajaEnabled && mpesaConfigured && callbackIsSecure)
    const kraReady = Boolean(settings.kraEtimsLiveEnabled && env.KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY && kraEtimsLiveEnabled)
    const monoReady = Boolean(settings.monoEnabled && monoConfigured)
    response.json({ mode: mpesaReady ? 'mpesa_configured' : 'setup_required', integrations: [
      { id: 'kra_etims', status: kraReady ? 'oscu_production_switches_enabled_approval_and_device_still_required' : settings.kraEtimsLiveEnabled ? `oscu_${env.KRA_ETIMS_ENV}_live_disabled` : 'oscu_workspace_disabled' },
      { id: 'mpesa', status: mpesaReady ? `configured_${env.MPESA_ENV}` : settings.darajaEnabled ? 'daraja_credentials_and_callback_required' : 'workspace_daraja_disabled' },
      { id: 'bank_feeds', status: monoReady ? 'mono_configured_consent_required' : settings.monoEnabled ? 'mono_business_approval_and_server_keys_required' : 'workspace_mono_disabled' },
      { id: 'email', status: emailConfigured ? 'resend_configured' : 'resend_api_key_and_verified_sender_required' },
      { id: 'payroll', status: `encrypted_internal_runs_${env.PAYROLL_DATA_ENCRYPTION_KEY ? 'configured' : 'encryption_key_required'}_statutory_filing_not_implemented` },
      { id: 'paye_shif_nssf_ahl_filing', status: 'statutory_filing_not_implemented' },
    ], note: `Workspace preferences are enforced on Daraja payment initiation, Mono linking/sync, and production KRA OSCU operations. Render provider credentials remain shared across businesses. KRA readiness here only reports that operator/workspace switches and encryption config are present; KRA approval, certification, initialized production device, fiscal mapping review, and reconciliation are still required. Statutory filing adapters are not implemented, regardless of saved preferences. Payroll estimates remain internal and are not certified.` })
  } catch (error) { next(error) }
})
app.use((_request, response) => response.status(404).json({ error: 'Not found' }))
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof SyntaxError) { response.status(400).json({ error: 'Invalid JSON request body' }); return }
  console.error('Unhandled API error:', error)
  response.status(500).json({ error: 'Internal server error', ...(env.NODE_ENV === 'production' ? {} : { detail: error instanceof Error ? error.message : String(error) }) })
})

async function start() {
  if (pool && env.BACKUP_RESTORE_MAINTENANCE_MODE !== 'true') {
    const { readdir, readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const migrationDir = fileURLToPath(new URL('../migrations', import.meta.url))
    const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort()
    for (const file of files) {
      const migration = await readFile(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), 'utf8')
      await pool.query(migration)
    }
    const workspaces = await pool.query('SELECT id FROM workspaces')
    for (const workspace of workspaces.rows) await ensureDefaultAccounts(String(workspace.id))
  }
  const server = app.listen(env.PORT, () => console.info(`KashFlow API listening on port ${env.PORT}`))
  if (pool && backupSettings && env.BACKUP_RESTORE_MAINTENANCE_MODE !== 'true') {
    const runHourlyBackup = async () => {
      try {
        const result = await withBackupLock(() => createDatabaseBackup(backupSettings))
        console.info(`Hourly full database backup completed: ${result.key}`)
      } catch (error) {
        console.error('Hourly full database backup failed:', error instanceof Error ? error.message : String(error))
      }
    }
    const now = new Date()
    const nextHour = new Date(now)
    nextHour.setUTCHours(now.getUTCHours() + 1, 0, 0, 0)
    let backupInterval: ReturnType<typeof setInterval> | undefined
    const firstBackup = setTimeout(() => {
      void runHourlyBackup()
      backupInterval = setInterval(() => { void runHourlyBackup() }, 60 * 60_000)
    }, nextHour.getTime() - now.getTime())
    server.on('close', () => {
      clearTimeout(firstBackup)
      if (backupInterval) clearInterval(backupInterval)
    })
    console.info('Hourly full database backups enabled; one encrypted S3 object per UTC hour is retained and overwritten every 24 hours.')
  }
  if (pool && monoConfigured) {
    const syncInterval = setInterval(() => {
      void (async () => {
        const accounts = await pool!.query("SELECT a.id, a.workspace_id, a.provider_account_id, s.preferences FROM connected_bank_accounts a LEFT JOIN workspace_settings s ON s.workspace_id = a.workspace_id WHERE a.provider = 'mono' AND a.connection_status = 'connected'")
        for (const account of accounts.rows) {
          if (account.preferences?.monoEnabled !== true) continue
          try { await syncMonoAccount(String(account.workspace_id), String(account.id), String(account.provider_account_id)) }
          catch (error) { console.error('Scheduled Mono bank sync failed:', error instanceof Error ? error.message : String(error)) }
        }
      })().catch((error: unknown) => console.error('Mono bank sync scheduler failed:', error))
    }, env.MONO_SYNC_INTERVAL_MINUTES * 60_000)
    syncInterval.unref()
  }
  return server
}
const server = await start()
async function shutdown() { server.close(); await pool?.end() }
process.on('SIGTERM', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })
