import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import * as SQLite from 'expo-sqlite'

export type InventoryItem = { id: string; name: string; sku: string; category: string; unit: string; cost: number; quantity: number }
export type InventoryLocation = { id: string; name: string; code: string; is_default: boolean; active: boolean }
export type LocationStock = { item_id: string; location_id: string; quantity: number }
export type BusinessWorkspace = { id: string; name: string; role: string }
export type QueuedCount = {
  idempotencyKey: string
  workspaceId: string
  itemId: string
  itemName: string
  locationId: string
  locationName: string
  countedQuantity: number
  expectedQuantity: number
  date: string
  reference: string
  state: 'pending' | 'conflict' | 'synced' | 'superseded'
  serverQuantity: number | null
  message: string
  createdAt: string
}
export type OfflineSnapshot = {
  workspaceId: string
  workspaceName: string
  userEmail: string
  refreshedAt: string
  workspaces: BusinessWorkspace[]
  items: InventoryItem[]
  locations: InventoryLocation[]
  stock: LocationStock[]
  counts: QueuedCount[]
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined

async function database() {
  if (databasePromise) return databasePromise
  const pendingDatabase = (async () => {
    let key = await SecureStore.getItemAsync('kashflow.sqlite.key')
    if (!key) {
      key = Array.from(Crypto.getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('')
      await SecureStore.setItemAsync('kashflow.sqlite.key', key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
    }
    const db = await SQLite.openDatabaseAsync('kashflow-inventory.db')
    let cipherAvailable = false
    try {
      await db.execAsync(`PRAGMA key = '${key}';`)
      const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version')
      if (!cipher?.cipher_version) {
        throw new Error('Encrypted local storage is unavailable in this build. Install the native KashFlow app instead of using an unencrypted preview.')
      }
      cipherAvailable = true
      await db.execAsync('PRAGMA foreign_keys = ON;')
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS workspace_snapshot (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1), workspace_id TEXT NOT NULL,
          workspace_name TEXT NOT NULL, user_email TEXT NOT NULL, refreshed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workspace_access (
          workspace_id TEXT PRIMARY KEY, workspace_name TEXT NOT NULL, role TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS inventory_items (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
          unit TEXT NOT NULL DEFAULT 'units', cost REAL NOT NULL DEFAULT 0, quantity REAL NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS inventory_locations (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL, is_default INTEGER NOT NULL, active INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS location_stock (
          item_id TEXT NOT NULL, location_id TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0,
          PRIMARY KEY (item_id, location_id)
        );
        CREATE TABLE IF NOT EXISTS count_queue (
          idempotency_key TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, item_id TEXT NOT NULL, location_id TEXT NOT NULL,
          counted_quantity REAL NOT NULL, expected_quantity REAL NOT NULL, count_date TEXT NOT NULL,
          reference TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'pending', server_quantity REAL,
          message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, synced_at TEXT
        );
      `)
      const countColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(count_queue)')
      if (!countColumns.some((column) => column.name === 'workspace_id')) {
        await db.execAsync('ALTER TABLE count_queue ADD COLUMN workspace_id TEXT;')
      }
      await db.runAsync('UPDATE count_queue SET workspace_id = (SELECT workspace_id FROM workspace_snapshot WHERE singleton = 1) WHERE workspace_id IS NULL')
      return db
    } catch (error) {
      await db.closeAsync().catch(() => undefined)
      if (!cipherAvailable) await SQLite.deleteDatabaseAsync('kashflow-inventory.db').catch(() => undefined)
      throw error
    }
  })()
  databasePromise = pendingDatabase
  try {
    return await pendingDatabase
  } catch (error) {
    if (databasePromise === pendingDatabase) databasePromise = undefined
    throw error
  }
}

export async function createLocalCountKey() { return Crypto.randomUUID() }

export async function saveSnapshot(input: {
  workspaceId: string
  workspaceName: string
  userEmail: string
  items: InventoryItem[]
  locations: InventoryLocation[]
  stock: LocationStock[]
  workspaces: BusinessWorkspace[]
}) {
  const db = await database()
  const refreshedAt = new Date().toISOString()
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT OR REPLACE INTO workspace_snapshot (singleton, workspace_id, workspace_name, user_email, refreshed_at) VALUES (1, ?, ?, ?, ?)', input.workspaceId, input.workspaceName, input.userEmail, refreshedAt)
    await db.execAsync('DELETE FROM workspace_access;')
    for (const workspace of input.workspaces) await db.runAsync('INSERT OR REPLACE INTO workspace_access (workspace_id, workspace_name, role) VALUES (?, ?, ?)', workspace.id, workspace.name, workspace.role)
    await db.execAsync('DELETE FROM inventory_items; DELETE FROM inventory_locations; DELETE FROM location_stock;')
    for (const item of input.items) await db.runAsync('INSERT INTO inventory_items (id, name, sku, category, unit, cost, quantity) VALUES (?, ?, ?, ?, ?, ?, ?)', item.id, item.name, item.sku, item.category, item.unit, item.cost, item.quantity)
    for (const location of input.locations) await db.runAsync('INSERT INTO inventory_locations (id, name, code, is_default, active) VALUES (?, ?, ?, ?, ?)', location.id, location.name, location.code, location.is_default ? 1 : 0, location.active ? 1 : 0)
    for (const stock of input.stock) await db.runAsync('INSERT INTO location_stock (item_id, location_id, quantity) VALUES (?, ?, ?)', stock.item_id, stock.location_id, stock.quantity)
  })
  return refreshedAt
}

export async function queueCount(input: Omit<QueuedCount, 'itemName' | 'locationName' | 'state' | 'serverQuantity' | 'message' | 'createdAt'>) {
  const db = await database()
  await db.runAsync('INSERT INTO count_queue (idempotency_key, workspace_id, item_id, location_id, counted_quantity, expected_quantity, count_date, reference, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'pending\', ?)', input.idempotencyKey, input.workspaceId, input.itemId, input.locationId, input.countedQuantity, input.expectedQuantity, input.date, input.reference, new Date().toISOString())
}

export async function updateCount(key: string, state: QueuedCount['state'], message = '', serverQuantity: number | null = null) {
  const db = await database()
  await db.runAsync('UPDATE count_queue SET state = ?, message = ?, server_quantity = ?, synced_at = CASE WHEN ? = \'synced\' THEN ? ELSE synced_at END WHERE idempotency_key = ?', state, message, serverQuantity, state, new Date().toISOString(), key)
}

export async function rebaseCount(key: string, serverQuantity: number) {
  const db = await database()
  const nextKey = await createLocalCountKey()
  await db.runAsync('UPDATE count_queue SET idempotency_key = ?, expected_quantity = ?, state = \'pending\', server_quantity = NULL, message = \'\' WHERE idempotency_key = ?', nextKey, serverQuantity, key)
}

export async function getOfflineSnapshot(): Promise<OfflineSnapshot | null> {
  const db = await database()
  const workspace = await db.getFirstAsync<{ workspace_id: string; workspace_name: string; user_email: string; refreshed_at: string }>('SELECT workspace_id, workspace_name, user_email, refreshed_at FROM workspace_snapshot WHERE singleton = 1')
  if (!workspace) return null
  const [rawItems, rawLocations, rawStock, rawCounts, rawWorkspaces] = await Promise.all([
    db.getAllAsync<InventoryItem>('SELECT * FROM inventory_items ORDER BY name COLLATE NOCASE'),
    db.getAllAsync<{ id: string; name: string; code: string; is_default: number; active: number }>('SELECT * FROM inventory_locations ORDER BY is_default DESC, name COLLATE NOCASE'),
    db.getAllAsync<LocationStock>('SELECT item_id, location_id, quantity FROM location_stock'),
    db.getAllAsync<Omit<QueuedCount, 'itemName' | 'locationName'> & { itemId: string; workspaceId: string; locationId: string; counted_quantity: number; expected_quantity: number; server_quantity: number | null; created_at: string }>('SELECT idempotency_key AS idempotencyKey, workspace_id AS workspaceId, item_id AS itemId, location_id AS locationId, counted_quantity, expected_quantity, count_date AS date, reference, state, server_quantity, message, created_at FROM count_queue ORDER BY created_at DESC'),
    db.getAllAsync<BusinessWorkspace>('SELECT workspace_id AS id, workspace_name AS name, role FROM workspace_access ORDER BY workspace_name COLLATE NOCASE'),
  ])
  const items = rawItems.map((item) => ({ ...item, cost: Number(item.cost), quantity: Number(item.quantity) }))
  const locations = rawLocations.map((location) => ({ ...location, is_default: Boolean(location.is_default), active: Boolean(location.active) }))
  const counts = rawCounts.map((count) => ({
    idempotencyKey: count.idempotencyKey,
    workspaceId: count.workspaceId,
    itemId: count.itemId,
    itemName: items.find((item) => item.id === count.itemId)?.name ?? 'Removed item',
    locationId: count.locationId,
    locationName: locations.find((location) => location.id === count.locationId)?.name ?? 'Removed location',
    countedQuantity: Number(count.counted_quantity),
    expectedQuantity: Number(count.expected_quantity),
    date: count.date,
    reference: count.reference,
    state: count.state,
    serverQuantity: count.server_quantity === null ? null : Number(count.server_quantity),
    message: count.message,
    createdAt: count.created_at,
  }))
  const workspaces = rawWorkspaces.length ? rawWorkspaces : [{ id: workspace.workspace_id, name: workspace.workspace_name, role: 'admin' }]
  return { workspaceId: workspace.workspace_id, workspaceName: workspace.workspace_name, userEmail: workspace.user_email, refreshedAt: workspace.refreshed_at, workspaces, items, locations, stock: rawStock.map((row) => ({ ...row, quantity: Number(row.quantity) })), counts: counts.filter((count) => count.workspaceId === workspace.workspace_id) }
}

export async function getCountsToSync(workspaceId: string) {
  const snapshot = await getOfflineSnapshot()
  return snapshot?.workspaceId === workspaceId ? snapshot.counts.filter((count) => count.state === 'pending' && count.workspaceId === workspaceId) : []
}

export async function clearOfflineVault() {
  const activeDatabase = databasePromise
  databasePromise = undefined
  const db = await activeDatabase?.catch(() => undefined)
  if (db) await db.closeAsync().catch(() => undefined)

  const [, keyResult, tokenResult] = await Promise.allSettled([
    SQLite.deleteDatabaseAsync('kashflow-inventory.db'),
    SecureStore.deleteItemAsync('kashflow.sqlite.key'),
    SecureStore.deleteItemAsync('kashflow.access-token'),
  ])
  if (keyResult.status === 'rejected' || tokenResult.status === 'rejected') {
    throw new Error('The secure device keys could not be removed. Retry sign-out before sharing this device.')
  }
}
