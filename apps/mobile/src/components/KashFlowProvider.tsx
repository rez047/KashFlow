import * as Network from 'expo-network'
import * as SecureStore from 'expo-secure-store'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert } from 'react-native'
import { activateBusiness, refreshCatalog, syncQueuedCounts } from '../lib/api'
import { getOfflineSnapshot, saveSnapshot, type OfflineSnapshot } from '../lib/offline'

type AppState = {
  token: string | null
  online: boolean
  loading: boolean
  syncing: boolean
  snapshot: OfflineSnapshot | null
  reloadLocal: () => Promise<void>
  refresh: () => Promise<void>
  syncNow: (showMessage?: boolean) => Promise<void>
  switchBusiness: (workspaceId: string) => Promise<void>
}

const AppContext = createContext<AppState | null>(null)

export function useKashFlow() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useKashFlow must be used inside the KashFlow app provider.')
  return value
}

export function KashFlowProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [online, setOnline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null)
  const lastOnline = useRef<boolean | null>(null)

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const cached = await getOfflineSnapshot()
      await refreshCatalog(token, cached?.userEmail ?? '')
      setSnapshot(await getOfflineSnapshot())
    } catch (error) {
      Alert.alert('Refresh paused', error instanceof Error ? error.message : 'Your last saved inventory is still available offline. Try again when the connection is stable.')
    }
  }, [token])

  const reloadLocal = useCallback(async () => { setSnapshot(await getOfflineSnapshot()) }, [])

  const switchBusiness = useCallback(async (workspaceId: string) => {
    if (!token) throw new Error('Sign in while connected before switching businesses.')
    if (!online) throw new Error('Connect to the internet before switching businesses.')
    if (!workspaceId || workspaceId === snapshot?.workspaceId) return
    const target = snapshot?.workspaces.find((workspace) => workspace.id === workspaceId)
    if (!target) throw new Error('Refresh your business list while online before switching.')
    const activated = await activateBusiness(token, workspaceId)
    if (!activated.accessToken) throw new Error('The server did not return a secure business session. Update the app or sign in again.')
    const nextToken = activated.accessToken
    await SecureStore.setItemAsync('kashflow.access-token', nextToken)
    setToken(nextToken)
    try {
      await refreshCatalog(nextToken, snapshot?.userEmail ?? '')
      setSnapshot(await getOfflineSnapshot())
    } catch (error) {
      let rolledBack = false
      if (snapshot?.workspaceId) {
        try {
          const rollback = await activateBusiness(nextToken, snapshot.workspaceId)
          if (!rollback.accessToken) throw new Error('The original business session could not be restored.')
          await SecureStore.setItemAsync('kashflow.access-token', rollback.accessToken)
          setToken(rollback.accessToken)
          rolledBack = true
        } catch { /* If the service is unreachable, save a safe empty snapshot for the newly active business below. */ }
      }
      if (!rolledBack) {
        await saveSnapshot({ workspaceId, workspaceName: activated.workspace.name, userEmail: snapshot?.userEmail ?? '', items: [], locations: [], stock: [], workspaces: snapshot?.workspaces ?? [target] })
        setSnapshot(await getOfflineSnapshot())
        throw new Error(`Switched to ${activated.workspace.name}, but inventory could not refresh. Your saved counts are safe; try Refresh when the connection returns.`)
      }
      throw error
    }
  }, [online, snapshot, token])

  const syncNow = useCallback(async (showMessage = true) => {
    if (!token) {
      if (showMessage) Alert.alert('Sign in required', 'Connect to the internet and sign in to sync this device.')
      return
    }
    if (!online) {
      if (showMessage) Alert.alert('You are offline', 'Your counts are safely saved on this device. Sync will be available when your connection returns.')
      return
    }
    if (!snapshot?.workspaceId) {
      if (showMessage) Alert.alert('Inventory not loaded', 'Refresh this business once while connected before syncing counts.')
      return
    }
    setSyncing(true)
    try {
      const result = await syncQueuedCounts(token, snapshot.workspaceId)
      await refreshCatalog(token, snapshot.userEmail)
      setSnapshot(await getOfflineSnapshot())
      if (showMessage) Alert.alert('Sync complete', `${result.synced} count${result.synced === 1 ? '' : 's'} synced${result.conflicts ? ` · ${result.conflicts} need review` : ''}${result.failed ? ` · ${result.failed} still pending` : ''}.`)
    } catch (error) {
      if (showMessage) Alert.alert('Could not sync', error instanceof Error ? error.message : 'Your saved counts are still on this device. Try again when the connection is stable.')
    } finally {
      setSyncing(false)
    }
  }, [online, snapshot, token])

  const refreshRef = useRef(refresh)
  const syncRef = useRef(syncNow)

  useEffect(() => {
    refreshRef.current = refresh
    syncRef.current = syncNow
  }, [refresh, syncNow])

  useEffect(() => {
    let active = true
    const load = async () => {
      const [savedToken, cached, network] = await Promise.all([
        SecureStore.getItemAsync('kashflow.access-token'),
        getOfflineSnapshot().catch(() => null),
        Network.getNetworkStateAsync().catch(() => ({ isConnected: false, isInternetReachable: false })),
      ])
      if (!active) return
      setToken(savedToken)
      setSnapshot(cached)
      const connected = Boolean(network.isConnected && network.isInternetReachable !== false)
      setOnline(connected)
      lastOnline.current = connected
      if (savedToken && connected) {
        try {
          await refreshCatalog(savedToken, cached?.userEmail ?? '')
          const current = await getOfflineSnapshot()
          if (active) {
            setSnapshot(current)
            if (current?.counts.some((count) => count.state === 'pending')) {
              setTimeout(() => Alert.alert('Back online', 'Your saved inventory counts are ready to sync.', [{ text: 'Later', style: 'cancel' }, { text: 'Sync now', onPress: () => { void syncRef.current() } }]), 500)
            }
          }
        } catch { /* Keep the last encrypted snapshot available offline. */ }
      }
      if (active) setLoading(false)
    }
    void load()
    const subscription = Network.addNetworkStateListener((state) => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false)
      setOnline(connected)
      const wasOnline = lastOnline.current
      lastOnline.current = connected
      if (connected && wasOnline === false) {
        void getOfflineSnapshot().then((cached) => {
          if (!cached?.counts.some((count) => count.state === 'pending')) {
            Alert.alert('Connection restored', 'Your workspace can refresh now.', [{ text: 'Later', style: 'cancel' }, { text: 'Refresh', onPress: () => { void refreshRef.current() } }])
          } else {
            Alert.alert('Connection restored', 'Your saved inventory counts are ready to sync.', [{ text: 'Later', style: 'cancel' }, { text: 'Sync now', onPress: () => { void syncRef.current() } }])
          }
        }).catch(() => undefined)
      }
    })
    return () => { active = false; subscription.remove() }
  }, [])

  const context = useMemo(() => ({ token, online, loading, syncing, snapshot, reloadLocal, refresh, syncNow, switchBusiness }), [token, online, loading, syncing, snapshot, reloadLocal, refresh, syncNow, switchBusiness])
  return <AppContext.Provider value={context}>{children}</AppContext.Provider>
}
