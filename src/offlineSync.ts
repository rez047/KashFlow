export type OfflineMutation = {
  id: string
  workspaceId: string
  userId: string
  path: string
  method: string
  body: string | null
  idempotencyKey: string
  createdAt: string
  state: 'pending' | 'attention'
  message: string
}

type CachedResponse = { key: string; workspaceId: string; userId: string; path: string; body: unknown; savedAt: string }
type StoredCachedResponse = Omit<CachedResponse, 'body'> & { sealedBody: SealedPayload }
type StoredOfflineMutation = Omit<OfflineMutation, 'body'> & { sealedBody: SealedPayload }
type SealedPayload = { iv: number[]; ciphertext: number[] }
type OfflineStore = 'responses' | 'mutations' | 'metadata' | 'local'

const DATABASE_NAME = 'kashflow-offline-v1'
const DATABASE_VERSION = 2
let databasePromise: Promise<IDBDatabase> | undefined
let activeWorkspaceId: string | undefined
let activeUserId: string | undefined
let encryptionKeyPromise: Promise<CryptoKey> | undefined

function openDatabase() {
  if (databasePromise) return databasePromise
  if (!globalThis.indexedDB) return Promise.reject(new Error('This device does not provide local offline storage.'))
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('responses')) database.createObjectStore('responses', { keyPath: 'key' })
      if (!database.objectStoreNames.contains('mutations')) database.createObjectStore('mutations', { keyPath: 'id' })
      if (!database.objectStoreNames.contains('metadata')) database.createObjectStore('metadata', { keyPath: 'key' })
      if (!database.objectStoreNames.contains('local')) database.createObjectStore('local', { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open offline storage.'))
    request.onblocked = () => reject(new Error('Offline storage is busy in another KashFlow tab. Close the other tab and retry.'))
  })
  databasePromise = opening
  opening.catch(() => { if (databasePromise === opening) databasePromise = undefined })
  return opening
}

function storeRequest<T>(storeName: OfflineStore, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = operation(transaction.objectStore(storeName))
    let result: T
    request.onsuccess = () => { result = request.result }
    request.onerror = () => reject(request.error ?? new Error('Offline storage request failed.'))
    transaction.oncomplete = () => resolve(result!)
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline storage transaction failed.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline storage transaction was aborted.'))
  }))
}

async function offlineEncryptionKey(): Promise<CryptoKey> {
  if (encryptionKeyPromise) return encryptionKeyPromise
  const pending = (async () => {
    if (!globalThis.crypto?.subtle) throw new Error('Encrypted offline storage is unavailable in this app context.')
    const saved = await storeRequest<{ key: string; value: CryptoKey } | undefined>('metadata', 'readonly', (store) => store.get('offline-encryption-key'))
    if (saved?.value) return saved.value
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    try {
      await storeRequest('metadata', 'readwrite', (store) => store.add({ key: 'offline-encryption-key', value: key }))
      return key
    } catch {
      const winner = await storeRequest<{ key: string; value: CryptoKey } | undefined>('metadata', 'readonly', (store) => store.get('offline-encryption-key'))
      if (winner?.value) return winner.value
      throw new Error('Could not initialize encrypted offline storage.')
    }
  })()
  encryptionKeyPromise = pending
  pending.catch(() => { if (encryptionKeyPromise === pending) encryptionKeyPromise = undefined })
  return pending
}

async function seal(value: unknown): Promise<SealedPayload> {
  const key = await offlineEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) }
}

async function unseal(value: SealedPayload) {
  const key = await offlineEncryptionKey()
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv) }, key, new Uint8Array(value.ciphertext))
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown
}

function responseKey(workspaceId: string, userId: string, path: string) { return `${userId}:${workspaceId}:${path}` }

export async function setActiveOfflineWorkspace(workspaceId: string, userId?: string) {
  if (!workspaceId) return
  activeWorkspaceId = workspaceId
  if (userId) activeUserId = userId
  await storeRequest('metadata', 'readwrite', (store) => store.put({ key: 'last-workspace', value: { workspaceId, userId: activeUserId } }))
}

export async function getActiveOfflineWorkspace() {
  if (activeWorkspaceId && activeUserId) return activeWorkspaceId
  const value = await storeRequest<{ key: string; value: string | { workspaceId?: string; userId?: string } } | undefined>('metadata', 'readonly', (store) => store.get('last-workspace'))
  if (!activeWorkspaceId) activeWorkspaceId = typeof value?.value === 'string' ? value.value : value?.value.workspaceId
  if (!activeUserId) activeUserId = typeof value?.value === 'object' ? value.value.userId : undefined
  return activeWorkspaceId
}

export async function getActiveOfflineUser() {
  if (!activeWorkspaceId || !activeUserId) await getActiveOfflineWorkspace()
  return activeUserId
}

export async function cacheApiResponse(workspaceId: string | undefined, userId: string | undefined, path: string, body: unknown) {
  const scope = path === '/v1/auth/status' ? 'public' : workspaceId
  if (!scope || path.startsWith('/v1/auth/') && path !== '/v1/auth/me' && path !== '/v1/auth/status') return
  const owner = path === '/v1/auth/status' ? 'public' : userId
  if (!owner) return
  const record: StoredCachedResponse = { key: responseKey(scope, owner, path), workspaceId: scope, userId: owner, path, sealedBody: await seal(body), savedAt: new Date().toISOString() }
  await storeRequest('responses', 'readwrite', (store) => store.put(record))
}

function localDataKey(workspaceId: string, userId: string, key: string) {
  return `${userId}:${workspaceId}:${key}`
}

export async function readOfflineLocalData<T>(workspaceId: string, userId: string, key: string): Promise<T | undefined> {
  const row = await storeRequest<{ key: string; workspaceId: string; userId: string; name: string; sealedBody: SealedPayload } | undefined>(
    'local', 'readonly', (store) => store.get(localDataKey(workspaceId, userId, key)),
  )
  if (!row || row.workspaceId !== workspaceId || row.userId !== userId || row.name !== key) return undefined
  return await unseal(row.sealedBody) as T
}

export async function writeOfflineLocalData(workspaceId: string, userId: string, key: string, value: unknown) {
  const row = { key: localDataKey(workspaceId, userId, key), workspaceId, userId, name: key, sealedBody: await seal(value), savedAt: new Date().toISOString() }
  await storeRequest('local', 'readwrite', (store) => store.put(row))
}

export async function readCachedApiResponse(path: string) {
  const workspaceId = path === '/v1/auth/status' ? 'public' : await getActiveOfflineWorkspace()
  const userId = path === '/v1/auth/status' ? 'public' : await getActiveOfflineUser()
  if (!workspaceId || !userId) return undefined
  const cached = await storeRequest<StoredCachedResponse | undefined>('responses', 'readonly', (store) => store.get(responseKey(workspaceId, userId, path)))
  return cached ? unseal(cached.sealedBody) : undefined
}

export function canQueueOfflinePath(path: string) {
  if (!path.startsWith('/v1/')) return false
  const blocked = [
    /^\/v1\/auth\//,
    /^\/v1\/integrations\/(?:daraja|woocommerce)(?:\/|$)/,
    /^\/v1\/integrations\/etims\/(?:device|initialize)(?:\/|$)/,
    /^\/v1\/banking\/mono\/link(?:\/|$)/,
    /^\/v1\/platform\/backups(?:\/|$)/,
    /^\/v1\/workspaces\/[^/]+\/(?:activate|archive)(?:\/|$)/,
  ]
  return !blocked.some((pattern) => pattern.test(path))
}

export class OfflineQueuedError extends Error {
  readonly offlineQueued = true
  constructor(path: string) {
    const providerAction = path.includes('/payments/mpesa') || path.includes('/integrations/drafts/') && path.endsWith('/submit')
    super(providerAction
      ? 'Saved on this device. The Safaricom/KRA request will be sent after the connection returns; no payment or fiscal receipt is confirmed yet.'
      : 'Saved on this device and queued to sync when the connection returns. Other devices will see it after sync completes.')
    this.name = 'OfflineQueuedError'
  }
}

export async function queueOfflineMutation(input: {
  workspaceId?: string
  userId?: string
  path: string
  method: string
  body: string | null
  idempotencyKey: string
}) {
  if (!canQueueOfflinePath(input.path)) throw new Error('This action contains account or provider credentials and cannot be saved offline.')
  const workspaceId = input.workspaceId || await getActiveOfflineWorkspace()
  const userId = input.userId || await getActiveOfflineUser()
  if (!workspaceId || !userId) throw new Error('Sign in and refresh this business while online before saving changes offline.')
  if (input.body && input.body.length > 5_000_000) throw new Error('This change is too large to store safely on this device. Reconnect and retry it.')
  const mutation: OfflineMutation = {
    id: crypto.randomUUID(), workspaceId, userId, path: input.path, method: input.method,
    body: input.body, idempotencyKey: input.idempotencyKey, createdAt: new Date().toISOString(), state: 'pending', message: '',
  }
  const { body, ...metadata } = mutation
  const sealedBody = await seal(body)
  await storeRequest('mutations', 'readwrite', (store) => store.add({ ...metadata, sealedBody } as StoredOfflineMutation))
  window.dispatchEvent(new CustomEvent('kashflow:offline-queue-changed'))
}

export async function listOfflineMutations(workspaceId?: string, userId?: string) {
  const rows = await storeRequest<StoredOfflineMutation[]>('mutations', 'readonly', (store) => store.getAll())
  const scoped = rows.filter((item) => (!workspaceId || item.workspaceId === workspaceId) && (!userId || item.userId === userId))
  const decrypted = await Promise.all(scoped.map(async ({ sealedBody, ...metadata }) => ({ ...metadata, body: await unseal(sealedBody) as string | null })))
  return decrypted.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

async function setMutationState(mutation: OfflineMutation, state: OfflineMutation['state'], message: string) {
  const { body, ...metadata } = mutation
  const sealedBody = await seal(body)
  await storeRequest('mutations', 'readwrite', (store) => store.put({ ...metadata, state, message, sealedBody } as StoredOfflineMutation))
}

async function removeMutation(id: string) {
  await storeRequest('mutations', 'readwrite', (store) => store.delete(id))
}

export async function syncOfflineMutations(
  workspaceId: string,
  userId: string,
  send: (mutation: OfflineMutation) => Promise<Response>,
) {
  const mutations = (await listOfflineMutations(workspaceId, userId)).filter((item) => item.state === 'pending')
  let synced = 0
  let needsAttention = 0
  for (const mutation of mutations) {
    if (!navigator.onLine) break
    try {
      const response = await send(mutation)
      if (response.ok) {
        await removeMutation(mutation.id)
        synced += 1
        continue
      }
      const result = await response.json().catch(() => ({})) as { error?: string; submissionStatus?: string }
      const message = result.error || `The server rejected this change (${response.status}). Review it before trying again.`
      await setMutationState(mutation, 'attention', message)
      needsAttention += 1
      // An HTTP response means the server has handled this idempotency key. Keep later
      // commands queued, but do not repeatedly send the item that needs review.
    } catch {
      // A lost connection can leave the outcome uncertain. The server idempotency key
      // makes retry safe; stop this batch and resume when the connection returns.
      break
    }
  }
  window.dispatchEvent(new CustomEvent('kashflow:offline-queue-changed'))
  window.dispatchEvent(new CustomEvent('kashflow:offline-sync-finished', { detail: { synced, needsAttention } }))
  return { synced, needsAttention }
}

export async function clearOfflineResponseCache() {
  const workspaceId = await getActiveOfflineWorkspace()
  const userId = await getActiveOfflineUser()
  if (!workspaceId || !userId) return
  const rows = await storeRequest<StoredCachedResponse[]>('responses', 'readonly', (store) => store.getAll())
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(['responses', 'metadata'], 'readwrite')
    const responses = transaction.objectStore('responses')
    for (const row of rows) if (row.workspaceId === workspaceId && row.userId === userId) responses.delete(row.key)
    transaction.objectStore('metadata').delete('last-workspace')
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear the offline workspace cache.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not clear the offline workspace cache.'))
  })
  activeWorkspaceId = undefined
  activeUserId = undefined
}
