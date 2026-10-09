import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useMemo } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useKashFlow } from './_layout'

function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

export default function HomeScreen() {
  const { online, loading, syncing, snapshot, refresh, syncNow } = useKashFlow()
  const queued = snapshot?.counts.filter((count) => count.state === 'pending').length ?? 0
  const conflicts = snapshot?.counts.filter((count) => count.state === 'conflict').length ?? 0
  const itemCount = snapshot?.items.length ?? 0
  const locationCount = snapshot?.locations.filter((location) => location.active).length ?? 0
  const recentCounts = useMemo(() => snapshot?.counts.slice(0, 3) ?? [], [snapshot?.counts])

  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.brand}><View style={styles.mark}><Ionicons name="layers" size={18} color="#fff" /></View><Text style={styles.brandText}>KashFlow<Text style={styles.brandAccent}>.</Text></Text></View>
        <Pressable accessibilityLabel="Open business settings" style={styles.avatar} onPress={() => router.push('/(tabs)/settings')}><Text style={styles.avatarText}>{(snapshot?.userEmail?.[0] ?? 'K').toUpperCase()}</Text></Pressable>
      </View>
      <View style={styles.welcomeRow}><View><Text style={styles.greeting}>{greeting()}</Text><Text style={styles.workspace}>{snapshot?.workspaceName ?? 'Your business'}</Text></View><View style={[styles.onlinePill, online ? styles.online : styles.offline]}><View style={[styles.statusDot, online ? styles.dotLive : styles.dotOffline]} /><Text style={[styles.onlineText, online ? styles.textLive : styles.textOffline]}>{online ? 'LIVE' : 'OFFLINE'}</Text></View></View>

      <View style={styles.hero}>
        <View style={styles.heroTop}><View style={styles.heroLabel}><View style={styles.heroDot} /><Text style={styles.heroEyebrow}>INVENTORY OVERVIEW</Text></View><Ionicons name="scan-outline" size={21} color="#66d8b2" /></View>
        <Text style={styles.heroTitle}>Everything in{ '\n' }its right place.</Text>
        <Text style={styles.heroBody}>A clear view of what’s on your shelves, wherever the work takes you.</Text>
        <View style={styles.metrics}>
          <View style={styles.metric}><Text style={styles.metricValue}>{itemCount}</Text><Text style={styles.metricLabel}>ITEMS</Text></View>
          <View style={styles.metricDivider} />
          <View style={styles.metric}><Text style={styles.metricValue}>{locationCount}</Text><Text style={styles.metricLabel}>LOCATIONS</Text></View>
          <View style={styles.metricDivider} />
          <View style={styles.metric}><Text style={[styles.metricValue, queued > 0 && { color: '#65dfb8' }]}>{queued}</Text><Text style={styles.metricLabel}>TO SYNC</Text></View>
        </View>
        <View style={styles.heroArtwork} pointerEvents="none"><View style={styles.artCircle} /><View style={styles.artCircleInner} /></View>
      </View>

      <Pressable style={[styles.connectCard, online ? styles.connectOnline : styles.connectOffline]} onPress={() => online ? void refresh() : void syncNow()}>
        <View style={[styles.connectIcon, online ? styles.connectIconOnline : styles.connectIconOffline]}><Ionicons name={online ? 'cloud-done-outline' : 'cloud-offline-outline'} size={19} color={online ? '#14866b' : '#bc7b28'} /></View>
        <View style={styles.connectCopy}><Text style={styles.connectTitle}>{online ? 'Your workspace is connected' : 'You’re ready to keep counting'}</Text><Text style={styles.connectSub}>{online ? `Last refresh ${snapshot?.refreshedAt ? new Date(snapshot.refreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'not yet'}` : 'Counts save on this device until you reconnect.'}</Text></View>
        {loading || syncing ? <ActivityIndicator size="small" color={online ? '#14866b' : '#bc7b28'} /> : <Ionicons name="chevron-forward" size={17} color="#8c9891" />}
      </Pressable>

      <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Make a move</Text><Text style={styles.sectionSub}>The essentials, one tap away.</Text></View><Text style={styles.sectionKicker}>QUICK ACTIONS</Text></View>
      <View style={styles.actionRow}>
        <Pressable style={[styles.actionCard, styles.primaryAction]} onPress={() => router.push('/(tabs)/count')}><View style={styles.actionIconLight}><Ionicons name="scan-outline" size={21} color="#0d9174" /></View><Text style={styles.actionTitleLight}>Start a count</Text><Text style={styles.actionCaptionLight}>Count the shelf, not the signal.</Text><View style={styles.actionArrowLight}><Ionicons name="arrow-up-right-box" size={17} color="#104f45" /></View></Pressable>
        <Pressable style={styles.actionCard} onPress={() => router.push('/(tabs)/stock')}><View style={styles.actionIcon}><Ionicons name="cube-outline" size={21} color="#0d9174" /></View><Text style={styles.actionTitle}>Browse stock</Text><Text style={styles.actionCaption}>Find an item, check a location.</Text><View style={styles.actionArrow}><Ionicons name="arrow-up-right-box" size={17} color="#60716f" /></View></Pressable>
      </View>

      {(conflicts > 0 || recentCounts.length > 0) && <View style={styles.recentSection}>
        <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>{conflicts > 0 ? 'Needs a closer look' : 'Recent counts'}</Text><Text style={styles.sectionSub}>{conflicts > 0 ? `${conflicts} count${conflicts === 1 ? '' : 's'} changed elsewhere` : 'Your latest inventory activity.'}</Text></View><Pressable onPress={() => router.push('/(tabs)/sync')}><Text style={styles.viewAll}>View all</Text></Pressable></View>
        <View style={styles.activityCard}>{recentCounts.map((count, index) => <View key={count.idempotencyKey} style={[styles.activityRow, index > 0 && styles.activityBorder]}><View style={[styles.activitySymbol, count.state === 'conflict' ? styles.symbolWarning : count.state === 'synced' ? styles.symbolSynced : styles.symbolPending]}><Ionicons name={count.state === 'conflict' ? 'alert-outline' : count.state === 'synced' ? 'checkmark' : 'time-outline'} size={16} color={count.state === 'conflict' ? '#b27b34' : count.state === 'synced' ? '#14866b' : '#5d7883'} /></View><View style={styles.activityCopy}><Text style={styles.activityTitle}>{count.itemName}</Text><Text style={styles.activityCaption}>{count.locationName} · {new Date(count.createdAt).toLocaleDateString()}</Text></View><View style={styles.activityRight}><Text style={styles.activityQuantity}>{count.countedQuantity}</Text><Text style={[styles.activityState, count.state === 'conflict' && styles.stateConflict]}>{count.state === 'synced' ? 'SYNCED' : count.state === 'conflict' ? 'REVIEW' : 'PENDING'}</Text></View></View>)}</View>
      </View>}

      {!snapshot && !loading && <View style={styles.emptyCard}><Ionicons name="cloud-download-outline" size={24} color="#128b70" /><Text style={styles.emptyTitle}>Start with a fresh snapshot</Text><Text style={styles.emptyBody}>Connect to the internet to load your items, branches, and current stock. After that, counting works offline too.</Text><Pressable onPress={() => void refresh()} style={styles.emptyButton}><Text style={styles.emptyButtonText}>Load my inventory</Text><Ionicons name="arrow-forward" size={16} color="#fff" /></Pressable></View>}

      <View style={styles.footerNote}><Ionicons name="lock-closed-outline" size={13} color="#89958f" /><Text style={styles.footerText}>Your inventory vault is encrypted on this device.</Text></View>
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f5f1' },
  content: { paddingHorizontal: 21, paddingTop: 15, paddingBottom: 28, maxWidth: 650, width: '100%', alignSelf: 'center' },
  header: { height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mark: { width: 31, height: 31, borderRadius: 10, backgroundColor: '#118c71', alignItems: 'center', justifyContent: 'center' },
  brandText: { color: '#19272d', fontSize: 17, fontWeight: '800', letterSpacing: -0.7 },
  brandAccent: { color: '#0d9b7b' },
  avatar: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#e7ece6', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#37524c', fontSize: 12, fontWeight: '800' },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 17 },
  greeting: { color: '#7c8982', fontSize: 11, fontWeight: '600' },
  workspace: { color: '#18272d', fontSize: 20, fontWeight: '800', letterSpacing: -0.6, marginTop: 2 },
  onlinePill: { borderRadius: 18, paddingHorizontal: 10, height: 27, flexDirection: 'row', gap: 6, alignItems: 'center' },
  online: { backgroundColor: '#e2f3ed' }, offline: { backgroundColor: '#fff1dc' },
  statusDot: { width: 6, height: 6, borderRadius: 4 }, dotLive: { backgroundColor: '#1caa81' }, dotOffline: { backgroundColor: '#c68b38' },
  onlineText: { fontSize: 8, fontWeight: '900', letterSpacing: 1.2 }, textLive: { color: '#14846b' }, textOffline: { color: '#a7732c' },
  hero: { minHeight: 273, borderRadius: 22, backgroundColor: '#132a34', padding: 21, overflow: 'hidden', justifyContent: 'space-between' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroDot: { backgroundColor: '#5ddbb0', width: 6, height: 6, borderRadius: 5 },
  heroEyebrow: { color: '#b0c9c5', fontWeight: '800', fontSize: 8, letterSpacing: 1.5 },
  heroTitle: { color: '#fff', fontSize: 27, lineHeight: 30, fontWeight: '800', letterSpacing: -0.8, marginTop: 20 },
  heroBody: { color: '#bbceca', fontSize: 11, lineHeight: 16, maxWidth: 245, marginTop: 5 },
  metrics: { flexDirection: 'row', alignItems: 'center', marginTop: 24, paddingTop: 15, borderTopColor: '#ffffff22', borderTopWidth: 1 },
  metric: { flex: 1 }, metricValue: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.4 }, metricLabel: { color: '#91aca8', fontSize: 7, fontWeight: '800', letterSpacing: 1.3, marginTop: 3 },
  metricDivider: { width: 1, height: 29, backgroundColor: '#ffffff1f', marginHorizontal: 12 },
  heroArtwork: { position: 'absolute', right: -52, top: 73, width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  artCircle: { width: 176, height: 176, borderRadius: 90, borderWidth: 1, borderColor: '#68dab027' }, artCircleInner: { position: 'absolute', width: 130, height: 130, borderRadius: 70, borderWidth: 1, borderColor: '#68dab019' },
  connectCard: { borderRadius: 15, padding: 13, flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 11, borderWidth: 1 },
  connectOnline: { backgroundColor: '#edf7f2', borderColor: '#dcece4' }, connectOffline: { backgroundColor: '#fff8ec', borderColor: '#f2e6d0' },
  connectIcon: { width: 35, height: 35, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, connectIconOnline: { backgroundColor: '#dcefe6' }, connectIconOffline: { backgroundColor: '#f9ebd3' },
  connectCopy: { flex: 1 }, connectTitle: { color: '#31423f', fontSize: 10, fontWeight: '800' }, connectSub: { color: '#788681', fontSize: 9, marginTop: 3 },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 23, marginBottom: 11 },
  sectionTitle: { color: '#1b282d', fontSize: 16, fontWeight: '800', letterSpacing: -0.35 }, sectionSub: { color: '#85918b', fontSize: 10, marginTop: 4 },
  sectionKicker: { color: '#91a09b', fontSize: 7, fontWeight: '900', letterSpacing: 1.4, marginBottom: 2 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionCard: { flex: 1, minHeight: 149, padding: 13, borderRadius: 17, borderWidth: 1, borderColor: '#e5e6e1', backgroundColor: '#fff' },
  primaryAction: { backgroundColor: '#dff3eb', borderColor: '#ceeadd' },
  actionIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#e7f4ee', alignItems: 'center', justifyContent: 'center' }, actionIconLight: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  actionTitle: { color: '#1b2c30', fontSize: 12, fontWeight: '800', marginTop: 12 }, actionTitleLight: { color: '#143d34', fontSize: 12, fontWeight: '800', marginTop: 12 },
  actionCaption: { color: '#788682', fontSize: 9, lineHeight: 14, marginTop: 4, maxWidth: 120 }, actionCaptionLight: { color: '#577d72', fontSize: 9, lineHeight: 14, marginTop: 4, maxWidth: 120 },
  actionArrow: { position: 'absolute', right: 12, top: 13 }, actionArrowLight: { position: 'absolute', right: 12, top: 13 },
  recentSection: { marginTop: 1 }, viewAll: { color: '#12896f', fontWeight: '800', fontSize: 10, paddingBottom: 2 },
  activityCard: { backgroundColor: '#fff', borderRadius: 16, borderColor: '#e9eae5', borderWidth: 1, paddingHorizontal: 12 },
  activityRow: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 9 }, activityBorder: { borderTopWidth: 1, borderTopColor: '#eef0eb' },
  activitySymbol: { width: 29, height: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, symbolWarning: { backgroundColor: '#fff3df' }, symbolSynced: { backgroundColor: '#e6f3ed' }, symbolPending: { backgroundColor: '#ebf1f3' },
  activityCopy: { flex: 1 }, activityTitle: { color: '#263439', fontSize: 10, fontWeight: '800' }, activityCaption: { color: '#8c9792', fontSize: 8, marginTop: 3 },
  activityRight: { alignItems: 'flex-end' }, activityQuantity: { color: '#26363a', fontSize: 12, fontWeight: '800' }, activityState: { color: '#74857e', fontSize: 7, fontWeight: '900', letterSpacing: 0.9, marginTop: 3 }, stateConflict: { color: '#aa722c' },
  emptyCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e8e0', borderRadius: 17, padding: 17, marginTop: 15 }, emptyTitle: { color: '#1b2c30', fontSize: 13, fontWeight: '800', marginTop: 8 }, emptyBody: { color: '#76857f', fontSize: 10, lineHeight: 16, marginTop: 6 }, emptyButton: { height: 41, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#128d71', borderRadius: 12, marginTop: 14, alignSelf: 'flex-start' }, emptyButtonText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  footerNote: { flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center', marginTop: 23 }, footerText: { color: '#89948d', fontSize: 9 },
})
