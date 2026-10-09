import { getCountsToSync, saveSnapshot, updateCount, type InventoryItem, type InventoryLocation } from './offline'

export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://kashflow-api.onrender.com').replace(/\/$/, '')
const nativeHeaders = { 'Content-Type': 'application/json', 'X-Kashflow-Client': 'native' }

export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(status: number, data: Record<string, unknown>) {
    super(typeof data.error === 'string' ? data.error : `Request failed (${status}).`)
    this.status = status
    this.data = data
  }
}

export async function api<T>(path: string, token?: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: { ...nativeHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new ApiError(response.status, data)
  return data as T
}

export async function refreshCatalog(token: string, userEmail: string) {
  const [me, itemResult, locationResult, stockResult] = await Promise.all([
    api<{ workspace: { id: string; name: string } }>('/v1/auth/me', token),
    api<{ records: { id: string; data: Record<string, unknown> }[] }>('/v1/records/inventory', token),
    api<{ locations: InventoryLocation[] }>('/v1/inventory/locations', token),
    api<{ stock: { item_id: string; location_id: string; quantity: string }[] }>('/v1/inventory/location-stock', token),
  ])
  const items: InventoryItem[] = itemResult.records.map(({ id, data }) => ({
    id,
    name: String(data.name ?? data.description ?? 'Untitled item'),
    sku: String(data.sku ?? ''),
    category: String(data.category ?? ''),
    unit: String(data.unit ?? 'units'),
    cost: Number(data.cost ?? 0),
    quantity: Number(data.quantity ?? 0),
  }))
  const locations = locationResult.locations.map((location) => ({ ...location, is_default: Boolean(location.is_default), active: Boolean(location.active) }))
  const stock = stockResult.stock.map((row) => ({ ...row, quantity: Number(row.quantity) }))
  const refreshedAt = await saveSnapshot({ workspaceId: me.workspace.id, workspaceName: me.workspace.name, userEmail, items, locations, stock })
  return { workspace: me.workspace, refreshedAt, itemCount: items.length }
}

export async function syncQueuedCounts(token: string, workspaceId: string) {
  if (!workspaceId) throw new Error('Refresh a business inventory before syncing saved counts.')
  const session = await api<{ workspace: { id: string } }>('/v1/auth/me', token)
  if (session.workspace.id !== workspaceId) {
    throw new ApiError(409, { error: 'This sign-in belongs to a different business than the saved counts. Switch back to the original business before syncing them.' })
  }
  const queued = await getCountsToSync(workspaceId)
  let synced = 0
  let conflicts = 0
  let failed = 0
  for (const count of queued) {
    try {
      await api('/v1/inventory/counts', token, {
        method: 'POST',
        body: {
          itemId: count.itemId,
          locationId: count.locationId,
          countedQuantity: count.countedQuantity,
          expectedQuantity: count.expectedQuantity,
          idempotencyKey: count.idempotencyKey,
          date: count.date,
          reference: count.reference,
        },
      })
      await updateCount(count.idempotencyKey, 'synced')
      synced += 1
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.data.conflict === true) {
        const latest = typeof error.data.serverQuantity === 'number' ? error.data.serverQuantity : null
        await updateCount(count.idempotencyKey, 'conflict', error.message, latest)
        conflicts += 1
      } else {
        failed += 1
      }
    }
  }
  return { synced, conflicts, failed }
}
