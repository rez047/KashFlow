// End-to-end regression tests for KashFlow auth + workspace + Daraja behaviour.
//
// These tests boot the real Express API (api/src/server.ts) against the built-in
// development pg-mem database, then drive it over HTTP with fetch. They lock in three
// behaviours that were requested and are easy to regress:
//   1. Users can switch between businesses/workspaces.
//   2. Each business can save its own encrypted Daraja (M-Pesa) credentials.
//   3. Changing the password is admin-only, the old password stops working, only the
//      new password is accepted afterwards, and existing sessions are invalidated.
//
// Run from api/ with:  npx tsx test/integration.test.mts
// (No database is required; the API falls back to an in-memory pg-mem database.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3998
const BASE = `http://127.0.0.1:${PORT}`
const ORIGIN = 'http://localhost:5173'
// ONLINE_COMMERCE_ENCRYPTION_KEY must be set so per-business Daraja credential storage is enabled.
const COMMERCE_KEY = 'test-commerce-encryption-key-at-least-32-chars-xxxx'

let server: ChildProcess | undefined

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/healthz`)
      if (response.ok) return
    } catch (error) { lastError = error }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`API did not become ready: ${String(lastError)}`)
}

type ApiResult = { status: number; json: Record<string, any> }
function client() {
  let cookie = ''
  return {
    get cookie() { return cookie },
    set cookie(value: string) { cookie = value },
    async api(pathName: string, init: RequestInit & { body?: string } = {}): Promise<ApiResult> {
      const headers: Record<string, string> = { Origin: ORIGIN }
      if (cookie) headers.Cookie = cookie
      if (init.body !== undefined) headers['Content-Type'] = 'application/json'
      const response = await fetch(`${BASE}${pathName}`, { ...init, headers })
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';')
        const eq = pair.indexOf('=')
        if (pair.slice(0, eq) === 'kashflow_session') cookie = pair
      }
      const text = await response.text()
      let json: unknown
      try { json = text ? JSON.parse(text) : null } catch { json = text }
      return { status: response.status, json: json as Record<string, any> }
    },
  }
}


test('KashFlow integration', { timeout: 120_000 }, async (t) => {
  t.before(async () => {
    const childEnv: Record<string, string> = {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      FRONTEND_ORIGIN: ORIGIN,
      SESSION_SECRET: 'integration-test-secret-at-least-32-characters-xxxx',
      PAYROLL_DATA_ENCRYPTION_KEY: 'integration-test-payroll-key-at-least-32-characters',
      ONLINE_COMMERCE_ENCRYPTION_KEY: COMMERCE_KEY,
    } as Record<string, string>
    // Remove DATABASE_URL entirely so the API uses its in-memory pg-mem fallback.
    delete childEnv.DATABASE_URL
    server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/server.ts'], {
      cwd: apiDir,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout?.on('data', (chunk) => process.stdout.write(`[api] ${chunk}`))
    server.stderr?.on('data', (chunk) => process.stderr.write(`[api:err] ${chunk}`))
    await waitForServer()
  })
  t.after(() => { server?.kill('SIGTERM') })

  await t.test('password change is admin-only and invalidates the old password', async () => {
    const admin = client()
    const bootstrap = await admin.api('/v1/auth/bootstrap', { method: 'POST', body: JSON.stringify({ identifier: 'owner@acme.test', password: 'OriginalPassword1!', businessName: 'Acme Ltd' }) })
    assert.equal(bootstrap.status, 201, 'first admin bootstraps')

    const me = await admin.api('/v1/auth/me')
    assert.equal(me.status, 200)
    const workspaceA = me.json.workspace.id as string

    const second = await admin.api('/v1/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Beta Shop' }) })
    assert.equal(second.status, 201)
    await admin.api(`/v1/workspaces/${workspaceA}/activate`, { method: 'POST' })
    const invite = await admin.api(`/v1/workspaces/${workspaceA}/invitations`, { method: 'POST', body: JSON.stringify({ email: 'viewer@acme.test', role: 'viewer', scope: 'single' }) })
    assert.equal(invite.status, 201)
    const inviteToken = new URL(invite.json.invitationUrl as string).searchParams.get('invite') as string
    const viewer = client()
    const accepted = await viewer.api('/v1/invitations/accept', { method: 'POST', body: JSON.stringify({ token: inviteToken, email: 'viewer@acme.test', password: 'ViewerPassword123!' }) })
    assert.equal(accepted.status, 200, 'viewer accepts invitation and gets a session')

    const viewerAttempt = await viewer.api('/v1/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'ViewerPassword123!', newPassword: 'HackedPassword123!' }) })
    assert.equal(viewerAttempt.status, 403, 'non-admin cannot change the account password')

    const staleSessionCookie = admin.cookie
    const changed = await admin.api('/v1/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'OriginalPassword1!', newPassword: 'RotatedPassword9!' }) })
    assert.equal(changed.status, 200, 'admin changes the password')

    const stale = client(); stale.cookie = staleSessionCookie
    const staleMe = await stale.api('/v1/auth/me')
    assert.equal(staleMe.status, 401, 'the old session is invalidated after a password change')

    const oldLogin = client()
    const withOld = await oldLogin.api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'owner@acme.test', password: 'OriginalPassword1!' }) })
    assert.equal(withOld.status, 401, 'the old password is rejected after a change')

    const newLogin = client()
    const withNew = await newLogin.api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'owner@acme.test', password: 'RotatedPassword9!' }) })
    assert.equal(withNew.status, 200, 'only the new password is accepted after a change')

    const oldAgain = client()
    const withOldAgain = await oldAgain.api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'owner@acme.test', password: 'OriginalPassword1!' }) })
    assert.equal(withOldAgain.status, 401, 'the old password stays rejected')
  })


  await t.test('a user can switch between businesses', async () => {
    const admin = client()
    const bootstrap = await admin.api('/v1/auth/bootstrap', { method: 'POST', body: JSON.stringify({ identifier: 'switcher@acme.test', password: 'SwitcherPassword1!', businessName: 'First Shop' }) })
    assert.equal(bootstrap.status, 201)
    const me = await admin.api('/v1/auth/me')
    const first = me.json.workspace.id as string

    const created = await admin.api('/v1/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Second Shop' }) })
    assert.equal(created.status, 201)
    const second = created.json.workspace.id as string

    const afterCreate = await admin.api('/v1/auth/me')
    assert.equal(afterCreate.json.workspace.id, second, 'creating a business switches to it')

    const activateFirst = await admin.api(`/v1/workspaces/${first}/activate`, { method: 'POST' })
    assert.equal(activateFirst.status, 200)
    const backToFirst = await admin.api('/v1/auth/me')
    assert.equal(backToFirst.json.workspace.id, first, 'switching back to the first business works')
    assert.equal((backToFirst.json.workspaces as unknown[]).length, 2, 'both businesses are listed')
  })

  await t.test('each business saves its own encrypted Daraja credentials', async () => {
    const admin = client()
    await admin.api('/v1/auth/bootstrap', { method: 'POST', body: JSON.stringify({ identifier: 'daraja@acme.test', password: 'DarajaPassword1!', businessName: 'Daraja Shop' }) })
    const me = await admin.api('/v1/auth/me')
    const workspaceId = me.json.workspace.id as string

    const before = await admin.api('/v1/integrations/daraja')
    assert.equal(before.status, 200)
    assert.equal(before.json.connection, null, 'no Daraja credentials saved yet')
    assert.equal(before.json.encryptionReady, true, 'credential encryption is available')

    const save = await admin.api('/v1/integrations/daraja', { method: 'PUT', body: JSON.stringify({
      consumerKey: 'sandbox-consumer-key',
      consumerSecret: 'sandbox-consumer-secret',
      shortcode: '174379',
      passkey: 'sandbox-passkey-value',
      callbackUrl: 'https://api.example.com/v1/integrations/mpesa/callback',
      environment: 'sandbox',
      transactionType: 'CustomerPayBillOnline',
    }) })
    assert.equal(save.status, 200, 'Daraja credentials are saved')
    assert.equal(save.json.connection.shortcode, '174379')
    assert.equal(save.json.connection.credentialsConfigured, true)
    const serialized = JSON.stringify(save.json)
    assert.ok(!serialized.includes('sandbox-consumer-secret'), 'consumer secret is never returned')
    assert.ok(!serialized.includes('sandbox-passkey-value'), 'passkey is never returned')

    const after = await admin.api('/v1/integrations/daraja')
    assert.equal(after.json.connection.shortcode, '174379', 'saved credentials load back (non-secret fields only)')

    const secondBiz = await admin.api('/v1/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Other Daraja Shop' }) })
    assert.equal(secondBiz.status, 201)
    const secondView = await admin.api('/v1/integrations/daraja')
    assert.equal(secondView.json.connection, null, 'the second business has no Daraja credentials of its own')

    await admin.api(`/v1/workspaces/${workspaceId}/activate`, { method: 'POST' })
    const readiness = await admin.api('/v1/integrations/readiness')
    assert.equal(readiness.status, 200)
    assert.ok(Array.isArray(readiness.json.integrations), 'readiness returns the integrations list')
  })
})

