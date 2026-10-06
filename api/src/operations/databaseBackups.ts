import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { S3Client, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

export type BackupSettings = {
  databaseUrl: string
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export type BackupSummary = { key: string; lastModified: string | null; size: number }

const retentionSlots = 24
let activeBackup = false

function createClient(settings: BackupSettings) {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: true,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  })
}

function databaseOptions(databaseUrl: string) {
  const connection = new URL(databaseUrl)
  return {
    host: connection.hostname,
    port: connection.port || '5432',
    username: decodeURIComponent(connection.username),
    password: decodeURIComponent(connection.password),
    database: decodeURIComponent(connection.pathname.slice(1)),
    sslMode: connection.searchParams.get('sslmode'),
  }
}

function runTool(command: 'pg_dump' | 'pg_restore', args: string[], password: string, sslMode: string | null, input?: Readable) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, PGPASSWORD: password, ...(sslMode ? { PGSSLMODE: sslMode } : {}) }, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    const stdout = child.stdout
    const stderrStream = child.stderr
    if (!stdout || !stderrStream) { child.kill(); reject(new Error(`${command} process streams could not be opened.`)); return }
    stdout.resume()
    let stderr = ''
    stderrStream.setEncoding('utf8')
    stderrStream.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4000) })
    child.on('error', (error) => reject(new Error(`${command} could not start: ${error.message}`)))
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${String(code)}: ${stderr.trim()}`)))
    if (input) {
      const stdin = child.stdin
      if (!stdin) { child.kill(); reject(new Error(`${command} input stream could not be opened.`)); return }
      input.on('error', (error) => stdin.destroy(error))
      input.pipe(stdin)
    }
  })
}

function hourlySlot(date: Date) {
  return `hourly-${String(date.getUTCHours()).padStart(2, '0')}.dump`
}

export async function listDatabaseBackups(settings: BackupSettings): Promise<BackupSummary[]> {
  const client = createClient(settings)
  try {
    const result = await client.send(new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: 'database-backups/' }))
    const backups = (result.Contents ?? []).map((item) => ({
      key: item.Key ?? '',
      lastModified: item.LastModified?.toISOString() ?? null,
      size: item.Size ?? 0,
    })).filter((item) => item.key).sort((left, right) => (right.lastModified ?? '').localeCompare(left.lastModified ?? ''))
    const expired = backups.slice(retentionSlots)
    if (expired.length) {
      const deletion = await client.send(new DeleteObjectsCommand({ Bucket: settings.bucket, Delete: { Objects: expired.map(({ key }) => ({ Key: key })) } }))
      if (deletion.Errors?.length) throw new Error(`Could not enforce 24-backup retention for ${deletion.Errors.length} expired object(s).`)
    }
    return backups.slice(0, retentionSlots)
  } finally { client.destroy() }
}

export async function createDatabaseBackup(settings: BackupSettings, now = new Date(), keyOverride?: string) {
  if (activeBackup) throw new Error('A database backup is already in progress.')
  const database = databaseOptions(settings.databaseUrl)
  const key = keyOverride ?? `database-backups/${hourlySlot(now)}`
  if (keyOverride && !/^database-safety\/[a-z0-9-]+\.dump$/.test(keyOverride)) throw new Error('Invalid pre-restore safety backup object key.')
  const client = createClient(settings)
  activeBackup = true
  const child = spawn('pg_dump', [
    '--format=custom', '--no-owner', '--no-privileges',
    '--host', database.host, '--port', database.port, '--username', database.username, '--dbname', database.database,
  ], { env: { ...process.env, PGPASSWORD: database.password, ...(database.sslMode ? { PGSSLMODE: database.sslMode } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout = child.stdout
  const stderrStream = child.stderr
  if (!stdout || !stderrStream) {
    child.kill()
    client.destroy()
    activeBackup = false
    throw new Error('pg_dump process streams could not be opened.')
  }
  let stderr = ''
  stderrStream.setEncoding('utf8')
  stderrStream.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4000) })
  try {
    const upload = new Upload({
      client,
      params: { Bucket: settings.bucket, Key: key, Body: stdout, ContentType: 'application/vnd.postgresql.custom', ServerSideEncryption: 'AES256', Metadata: { createdat: now.toISOString(), retentionhours: '24' } },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    })
    const exit = new Promise<void>((resolve, reject) => {
      child.on('error', (error) => reject(new Error(`pg_dump could not start: ${error.message}`)))
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited with code ${String(code)}: ${stderr.trim()}`)))
    })
    await Promise.all([upload.done(), exit])
    return { key, createdAt: now.toISOString() }
  } catch (error) {
    child.kill()
    try { await client.send(new DeleteObjectsCommand({ Bucket: settings.bucket, Delete: { Objects: [{ Key: key }] } })) }
    catch (cleanupError) { console.error('Could not remove incomplete S3 database backup:', cleanupError) }
    throw error
  } finally {
    client.destroy()
    activeBackup = false
  }
}

export async function restoreDatabaseBackup(settings: BackupSettings, key: string) {
  if (!/^database-backups\/hourly-(?:0[0-9]|1[0-9]|2[0-3])\.dump$/.test(key)) throw new Error('Choose a valid retained hourly backup key.')
  const client = createClient(settings)
  const database = databaseOptions(settings.databaseUrl)
  try {
    const backup = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }))
    if (!backup.Body) throw new Error('The selected backup has no contents.')
    const args = [
      '--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction',
      '--host', database.host, '--port', database.port, '--username', database.username, '--dbname', database.database,
    ]
    await runTool('pg_restore', args, database.password, database.sslMode, Readable.fromWeb(backup.Body.transformToWebStream() as Parameters<typeof Readable.fromWeb>[0]))
  } finally { client.destroy() }
}

export function isBackupInProgress() {
  return activeBackup
}
