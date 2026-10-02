import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { Pool } from 'pg'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().url().optional(),
})

const parsedEnv = envSchema.safeParse(process.env)
if (!parsedEnv.success) {
  console.error('Invalid API environment configuration:', parsedEnv.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`).join('; '))
  process.exit(1)
}
const env = parsedEnv.data

const pool = env.DATABASE_URL ? new Pool({ connectionString: env.DATABASE_URL, max: 5 }) : undefined
const app = express()
app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: env.FRONTEND_ORIGIN, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] }))
app.use(express.json({ limit: '32kb', type: 'application/json' }))
app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }))

app.get('/healthz', async (_request, response) => {
  let database = 'not_configured'
  if (pool) {
    try {
      await pool.query('SELECT 1')
      database = 'available'
    } catch {
      database = 'unavailable'
    }
  }
  const healthy = database !== 'unavailable'
  response.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', database })
})

app.get('/v1/integrations/readiness', (_request, response) => {
  response.json({
    mode: 'setup_required',
    integrations: [
      { id: 'kra_etims', status: 'provider_required', provider: null },
      { id: 'mpesa', status: 'daraja_credentials_required', provider: 'Safaricom Daraja' },
      { id: 'bank_feeds', status: 'provider_required', provider: null },
      { id: 'paye_shif_nssf_ahl', status: 'filing_route_required', provider: null },
    ],
    note: 'No external provider is connected. This readiness endpoint does not submit payments, invoices, payroll, or statutory filings.',
  })
})

app.use((_request, response) => response.status(404).json({ error: 'Not found' }))
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof SyntaxError) {
    response.status(400).json({ error: 'Invalid JSON request body' })
    return
  }
  response.status(500).json({ error: 'Internal server error' })
})

const server = app.listen(env.PORT, () => console.info(`KashFlow API listening on port ${env.PORT}`))

async function shutdown() {
  server.close()
  await pool?.end()
}
process.on('SIGTERM', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })
