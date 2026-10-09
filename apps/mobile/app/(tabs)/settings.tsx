import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { clearOfflineVault } from '../../src/lib/offline'
import { useKashFlow } from '../../src/components/KashFlowProvider'

export default function SettingsScreen() {
  const { online, snapshot } = useKashFlow()
  const [busy, setBusy] = useState(false)
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
  eyebrow: { color: '#128b72', fontSize: 8, letterSpacing: 1.5, fontWeight: '900' }, title: { color: '#1a292e', fontSize: 24, fontWeight: '800', letterSpacing: -0.8, marginTop: 5 }, intro: { color: '#818d87', fontSize: 10, lineHeight: 16, marginTop: 7 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6e9e2', borderRadius: 16, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 19 }, businessIcon: { width: 37, height: 37, borderRadius: 13, backgroundColor: '#e6f4ed', alignItems: 'center', justifyContent: 'center' }, businessBody: { flex: 1 }, cardEyebrow: { color: '#929d96', fontSize: 7, fontWeight: '900', letterSpacing: 1.1 }, businessName: { color: '#253639', fontSize: 11, fontWeight: '800', marginTop: 3 }, email: { color: '#89958f', fontSize: 8, marginTop: 3 }, connection: { width: 9, height: 9, borderRadius: 5 }, connectionOnline: { backgroundColor: '#36ae82' }, connectionOffline: { backgroundColor: '#d39a4d' },
  section: { color: '#929d97', fontSize: 7, letterSpacing: 1.4, fontWeight: '900', marginTop: 22, marginBottom: 8 }, capabilities: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7e9e3', borderRadius: 15, paddingHorizontal: 12 }, capability: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderBottomColor: '#f0f1ed' }, capabilityCopy: { flex: 1 }, capabilityTitle: { color: '#33413e', fontSize: 9, fontWeight: '800' }, capabilityDetail: { color: '#8c9791', fontSize: 8, lineHeight: 12, marginTop: 3 },
  deviceCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 13, backgroundColor: '#e8f4ed', marginTop: 17 }, deviceCopy: { flex: 1 }, deviceTitle: { color: '#315f51', fontSize: 9, fontWeight: '900' }, deviceDetail: { color: '#6e867a', fontSize: 8, lineHeight: 13, marginTop: 4 }, refreshed: { color: '#929c96', fontSize: 8, textAlign: 'center', marginTop: 12 }, signout: { height: 43, borderWidth: 1, borderColor: '#eedcd8', backgroundColor: '#fff8f6', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 20 }, signoutText: { color: '#99554d', fontSize: 9, fontWeight: '800' }, version: { textAlign: 'center', marginTop: 15, color: '#a5aca6', fontSize: 7, fontWeight: '800', letterSpacing: 1.2 },
})
