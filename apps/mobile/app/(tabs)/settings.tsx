import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { clearOfflineVault } from '../../src/lib/offline'
import { useKashFlow } from '../../src/components/KashFlowProvider'

export default function SettingsScreen() {
  const { online, snapshot, switchBusiness } = useKashFlow()
  const [busy, setBusy] = useState(false)
  const pendingCount = snapshot?.counts.filter((count) => count.state === 'pending').length ?? 0
  async function changeBusiness(workspaceId: string, workspaceName: string) {
    if (busy) return
    setBusy(true)
    try {
      await switchBusiness(workspaceId)
      Alert.alert('Business switched', `You are now working in ${workspaceName}.`)
    } catch (error) {
      Alert.alert('Could not switch business', error instanceof Error ? error.message : 'Your current workspace and saved counts are unchanged.')
    } finally { setBusy(false) }
  }
  function requestBusinessSwitch(workspaceId: string, workspaceName: string) {
    if (workspaceId === snapshot?.workspaceId || busy) return
    if (!online) { Alert.alert('Connection needed', 'Connect to the internet to switch businesses. Your saved counts remain encrypted on this device.'); return }
    if (pendingCount > 0) {
      Alert.alert('Keep these counts safe?', `${pendingCount} unsynced count${pendingCount === 1 ? '' : 's'} for ${snapshot?.workspaceName} will stay encrypted on this device. You can switch back to sync them.`, [{ text: 'Stay here', style: 'cancel' }, { text: `Switch to ${workspaceName}`, onPress: () => { void changeBusiness(workspaceId, workspaceName) } }])
      return
    }
    void changeBusiness(workspaceId, workspaceName)
  }
  async function signOut() {
    setBusy(true)
    try {
      await clearOfflineVault()
      router.replace('/')
    } catch (error) {
      Alert.alert('Could not clear local data', error instanceof Error ? error.message : 'Try again before sharing this device.')
    } finally { setBusy(false) }
  }
  return <View style={styles.screen}><ScrollView contentContainerStyle={styles.page}>
    <View style={styles.nav}><Pressable accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={19} color="#283a3c" /></Pressable><Text style={styles.navTitle}>Settings</Text><View style={{ width: 38 }} /></View>
    <Text style={styles.eyebrow}>YOUR DEVICE</Text><Text style={styles.title}>A calmer way to work.</Text><Text style={styles.intro}>This app keeps inventory close at hand and tells you clearly when a connection is needed.</Text>

    <View style={styles.card}>
      <View style={styles.businessIcon}><Ionicons name="business-outline" size={19} color="#11876e" /></View><View style={styles.businessBody}><Text style={styles.cardEyebrow}>ACTIVE BUSINESS</Text><Text style={styles.businessName}>{snapshot?.workspaceName ?? 'No saved business'}</Text><Text style={styles.email}>{snapshot?.userEmail ?? 'Sign in while online to sync this device.'}</Text></View><View style={[styles.connection, online ? styles.connectionOnline : styles.connectionOffline]} />
    </View>

    {(snapshot?.workspaces.length ?? 0) > 1 && <><Text style={styles.section}>YOUR BUSINESSES</Text><View style={styles.businessList}>{snapshot?.workspaces.map((workspace) => <Pressable key={workspace.id} disabled={busy || workspace.id === snapshot.workspaceId} accessibilityRole="button" accessibilityState={{ selected: workspace.id === snapshot.workspaceId, disabled: busy || workspace.id === snapshot.workspaceId }} onPress={() => requestBusinessSwitch(workspace.id, workspace.name)} style={[styles.businessOption, workspace.id === snapshot.workspaceId && styles.businessOptionActive]}><View style={styles.businessOptionIcon}><Ionicons name="business-outline" size={16} color={workspace.id === snapshot.workspaceId ? '#13876d' : '#75847d'} /></View><View style={styles.businessOptionCopy}><Text style={styles.businessOptionName}>{workspace.name}</Text><Text style={styles.businessOptionRole}>{workspace.id === snapshot.workspaceId ? 'ACTIVE BUSINESS' : workspace.role.replaceAll('_', ' ').toUpperCase()}</Text></View>{workspace.id === snapshot.workspaceId ? <Ionicons name="checkmark-circle" size={18} color="#17876e" /> : <Ionicons name="chevron-forward" size={16} color="#a0aaa3" />}</Pressable>)}</View><Text style={styles.businessHint}>{online ? 'Switching businesses refreshes its saved inventory. Offline counts stay with the business where you recorded them.' : 'Connect to switch businesses. Your saved inventory and counts remain available offline.'}</Text></>}

    <Text style={styles.section}>WORKS OFFLINE</Text>
    <View style={styles.capabilities}>
      <Capability icon="checkmark-circle" title="Inventory count sessions" detail="Save physical counts to encrypted device storage." />
      <Capability icon="checkmark-circle" title="Last saved product and branch list" detail="Search and count against your most recent snapshot." />
      <Capability icon="checkmark-circle" title="Pending sync and conflict review" detail="Each saved count is checked before stock is adjusted." />
    </View>

    <Text style={styles.section}>NEEDS AN INTERNET CONNECTION</Text>
    <View style={styles.capabilities}>
      <Capability icon="cloud-outline" title="Sign in and business access" detail="An active session is required to send changes to KashFlow." />
      <Capability icon="cloud-outline" title="Live refresh and stock reconciliation" detail="The app checks for new sales and stock movements when connected." />
      <Capability icon="cloud-outline" title="M-Pesa, eTIMS and bank feeds" detail="Provider services are paused offline and resume online." />
    </View>

    <View style={styles.deviceCard}><Ionicons name="shield-checkmark-outline" size={17} color="#14876d" /><View style={styles.deviceCopy}><Text style={styles.deviceTitle}>Encrypted on this device</Text><Text style={styles.deviceDetail}>Inventory snapshots and unsynced counts use SQLCipher. Your sign-in is kept in the device keychain.</Text></View></View>
    {snapshot?.refreshedAt && <Text style={styles.refreshed}>Last inventory snapshot · {new Date(snapshot.refreshedAt).toLocaleString()}</Text>}
    <Pressable disabled={busy} onPress={() => Alert.alert('Sign out and clear this device?', 'The local inventory, saved counts, and sign-in key will be deleted from this device.', [{ text: 'Keep working', style: 'cancel' }, { text: 'Clear & sign out', style: 'destructive', onPress: () => { void signOut() } }])} style={styles.signout}><Ionicons name="log-out-outline" size={16} color="#9c5048" /><Text style={styles.signoutText}>{busy ? 'Clearing device…' : 'Sign out & clear local data'}</Text></Pressable>
    <Text style={styles.version}>KASHFLOW FIELD EDITION · 1.0.0</Text>
  </ScrollView></View>
}

function Capability({ icon, title, detail }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }) {
  return <View style={styles.capability}><Ionicons name={icon} size={15} color={icon === 'cloud-outline' ? '#9b7b49' : '#159172'} /><View style={styles.capabilityCopy}><Text style={styles.capabilityTitle}>{title}</Text><Text style={styles.capabilityDetail}>{detail}</Text></View></View>
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f5f1' }, page: { paddingHorizontal: 20, paddingTop: 19, paddingBottom: 34, maxWidth: 620, width: '100%', alignSelf: 'center' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }, back: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6e8e2' }, navTitle: { color: '#29383a', fontSize: 12, fontWeight: '800' },
  eyebrow: { color: '#128b72', fontSize: 11, letterSpacing: 1.5, fontWeight: '900' }, title: { color: '#1a292e', fontSize: 24, fontWeight: '800', letterSpacing: -0.8, marginTop: 5 }, intro: { color: '#818d87', fontSize: 13, lineHeight: 16, marginTop: 7 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6e9e2', borderRadius: 16, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 19 }, businessIcon: { width: 37, height: 37, borderRadius: 13, backgroundColor: '#e6f4ed', alignItems: 'center', justifyContent: 'center' }, businessBody: { flex: 1 }, cardEyebrow: { color: '#929d96', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 }, businessName: { color: '#253639', fontSize: 14, fontWeight: '800', marginTop: 3 }, email: { color: '#89958f', fontSize: 11, marginTop: 3 }, connection: { width: 9, height: 9, borderRadius: 5 }, connectionOnline: { backgroundColor: '#36ae82' }, connectionOffline: { backgroundColor: '#d39a4d' },
  businessList: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7e9e3', borderRadius: 15, paddingHorizontal: 12 }, businessOption: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#f0f1ed' }, businessOptionActive: { opacity: 1 }, businessOptionIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#f0f4f0', alignItems: 'center', justifyContent: 'center' }, businessOptionCopy: { flex: 1 }, businessOptionName: { color: '#33413e', fontSize: 12, fontWeight: '800' }, businessOptionRole: { color: '#929d97', fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 3 }, businessHint: { color: '#8c9791', fontSize: 11, lineHeight: 14, marginTop: 7 },
  section: { color: '#929d97', fontSize: 10, letterSpacing: 1.4, fontWeight: '900', marginTop: 22, marginBottom: 8 }, capabilities: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7e9e3', borderRadius: 15, paddingHorizontal: 12 }, capability: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderBottomColor: '#f0f1ed' }, capabilityCopy: { flex: 1 }, capabilityTitle: { color: '#33413e', fontSize: 12, fontWeight: '800' }, capabilityDetail: { color: '#8c9791', fontSize: 11, lineHeight: 12, marginTop: 3 },
  deviceCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 13, backgroundColor: '#e8f4ed', marginTop: 17 }, deviceCopy: { flex: 1 }, deviceTitle: { color: '#315f51', fontSize: 12, fontWeight: '900' }, deviceDetail: { color: '#6e867a', fontSize: 11, lineHeight: 13, marginTop: 4 }, refreshed: { color: '#929c96', fontSize: 11, textAlign: 'center', marginTop: 12 }, signout: { height: 43, borderWidth: 1, borderColor: '#eedcd8', backgroundColor: '#fff8f6', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 20 }, signoutText: { color: '#99554d', fontSize: 12, fontWeight: '800' }, version: { textAlign: 'center', marginTop: 15, color: '#a5aca6', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
})
