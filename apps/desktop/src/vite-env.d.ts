/// <reference types="vite/client" />

interface Window {
  kashflowDesktop: {
    loadVault(): Promise<DesktopVault>
    saveVault(value: DesktopVault): Promise<void>
    request(path: string, token?: string, options?: { method?: string; body?: unknown }): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }>
    ping(): Promise<boolean>
    version(): Promise<string>
  }
}

type DesktopVault = {
  token: string
  userEmail: string
  workspaceId: string
  workspaceName: string
  workspaces: Array<{ id: string; name: string; role: string }>
  refreshedAt: string
  items: Array<{ id: string; name: string; sku: string; category: string; unit: string; cost: number; quantity: number }>
  locations: Array<{ id: string; name: string; code: string; is_default: boolean; active: boolean }>
  stock: Array<{ item_id: string; location_id: string; quantity: number }>
  counts: Array<{ idempotencyKey: string; workspaceId: string; itemId: string; itemName: string; locationId: string; locationName: string; countedQuantity: number; expectedQuantity: number; date: string; reference: string; state: 'pending' | 'conflict' | 'synced' | 'superseded'; serverQuantity: number | null; message: string; createdAt: string }>
}
