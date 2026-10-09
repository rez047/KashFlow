import { Ionicons } from '@expo/vector-icons'
import * as Network from 'expo-network'
import * as SecureStore from 'expo-secure-store'
import { Tabs } from 'expo-router'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { refreshCatalog, syncQueuedCounts } from '../../src/lib/api'
import { getOfflineSnapshot, type OfflineSnapshot } from '../../src/lib/offline'

type AppState = {
  token: string | null
  online: boolean
  loading: boolean
  syncing: boolean
  snapshot: OfflineSnapshot | null
  reloadLocal: () => Promise<void>
  refresh: () => Promise<void>
  syncNow: (showMessage?: boolean) => Promise<void>
}
const AppContext = createContext<AppState | null>(null)
export function useKashFlow() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useKashFlow must be used inside the KashFlow app provider.')
  return value
}

export default function TabLayout() {
  const [token, setToken] = useState<string | null>(null)
  const [online, setOnline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null)
  const lastOnline = useRef<boolean | null>(null)

  const refresh = useCallback(async () => {
    if (!token) return
    const email = snapshot?.userEmail ?? ''
    await refreshCatalog(token, email)
    setSnapshot(await getOfflineSnapshot())
  }, [snapshot?.userEmail, token])

  const reloadLocal = useCallback(async () => { setSnapshot(await getOfflineSnapshot()) }, [])

  const syncNow = useCallback(async (showMessage = true) => {
    if (!token) {
      if (showMessage) Alert.alert('Sign in required', 'Connect to the internet and sign in to sync this device.')
      return
    }
    if (!online) {
      if (showMessage) Alert.alert('You are offline', 'Your counts are safely saved on this device. Sync will be available when your connection returns.')
      return
    }
    setSyncing(true)
    try {
      const result = await syncQueuedCounts(token)
      await refreshCatalog(token, snapshot?.userEmail ?? '')
      setSnapshot(await getOfflineSnapshot())
      if (showMessage) Alert.alert('Sync complete', `${result.synced} count${result.synced === 1 ? '' : 's'} synced${result.conflicts ? ` · ${result.conflicts} need review` : ''}${result.failed ? ` · ${result.failed} still pending` : ''}.`)
    } catch (error) {
      if (showMessage) Alert.alert('Could not sync', error instanceof Error ? error.message : 'Your saved counts are still on this device. Try again when the connection is stable.')
    } finally {
      setSyncing(false)
    }
  }, [online, snapshot?.userEmail, token])

  const refreshRef = useRef(refresh)
  const syncRef = useRef(syncNow)
  refreshRef.current = refresh
  syncRef.current = syncNow

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
        try { await refreshCatalog(savedToken, cached?.userEmail ?? ''); if (active) setSnapshot(await getOfflineSnapshot()) } catch { /* Keep the last encrypted snapshot available offline. */ }
        if (active && cached?.counts.some((count) => count.state === 'pending')) {
          setTimeout(() => Alert.alert('Back online', 'Your saved inventory counts are ready to sync.', [{ text: 'Later', style: 'cancel' }, { text: 'Sync now', onPress: () => { void syncRef.current() } }]), 500)
        }
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

  const context = useMemo(() => ({ token, online, loading, syncing, snapshot, reloadLocal, refresh, syncNow }), [token, online, loading, syncing, snapshot, reloadLocal, refresh, syncNow])
  return <AppContext.Provider value={context}>
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: '#0c9a79',
      tabBarInactiveTintColor: '#829098',
      tabBarStyle: { height: 69, paddingTop: 8, paddingBottom: 8, backgroundColor: '#fff', borderTopColor: '#e7e8e3', elevation: 0 },
      tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
    }}>
      <Tabs.Screen name="home" options={{ title: 'Today', tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="stock" options={{ title: 'Stock', tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="count" options={{ title: 'Count', tabBarIcon: ({ color, size }) => <Ionicons name="scan-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="sync" options={{ title: 'Sync', tabBarIcon: ({ color, size }) => <Ionicons name="sync-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ href: null, tabBarButton: () => null }} />
    </Tabs>
  </AppContext.Provider>
}
