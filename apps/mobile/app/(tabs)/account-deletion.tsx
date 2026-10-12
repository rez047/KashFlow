import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useKashFlow } from '../../src/components/KashFlowProvider'
import { archiveWorkspaceForAccountDeletion, deleteAccount, getAccountDeletionPreview, type AccountDeletionPreview } from '../../src/lib/api'
import { clearOfflineVault } from '../../src/lib/offline'

export default function AccountDeletionScreen() {
  const { token, online, snapshot, updateSessionToken } = useKashFlow()
  const [preview, setPreview] = useState<AccountDeletionPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')

  const loadPreview = useCallback(async () => {
    if (!token) return
    try { setPreview(await getAccountDeletionPreview(token)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load your businesses.') }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    getAccountDeletionPreview(token)
      .then((value) => { if (!cancelled) setPreview(value) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load your businesses.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  const needsArchive = preview?.workspaces.filter((workspace) => workspace.soleAdmin && !workspace.archivedAt) ?? []
  const pendingCounts = snapshot?.counts.filter((count) => count.state === 'pending' || count.state === 'conflict').length ?? 0
  const canDelete = Boolean(token && online && preview && !loading && needsArchive.length === 0 && currentPassword.length > 0 && confirmation === 'DELETE' && !busy)

  function confirmArchive(workspace: AccountDeletionPreview['workspaces'][number]) {
    if (!currentPassword) { setError('Enter your current password before archiving a business.'); return }
    Alert.alert(
      `Archive ${workspace.name}?`,
      'This business will become read-only. Its shared business records will remain stored for the workspace retention review.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive business', style: 'destructive', onPress: () => { void archiveWorkspace(workspace) } },
      ],
    )
  }

  async function archiveWorkspace(workspace: AccountDeletionPreview['workspaces'][number]) {
    if (!token || busy) return
    setBusy(true)
    setError('')
    try {
      await archiveWorkspaceForAccountDeletion(token, workspace.id, currentPassword, workspace.name)
      setLoading(true)
      await loadPreview()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The business could not be archived.') }
    finally { setBusy(false) }
  }

  function confirmDelete() {
    if (!canDelete || !token) return
    Alert.alert(
      'Delete this account?',
      `This removes your sign-in and access to every business, then clears this device${pendingCounts ? `, including ${pendingCounts} unsynced or conflicted count${pendingCounts === 1 ? '' : 's'}` : ''}. Shared business records will be retained. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => { void performDelete() } },
      ],
    )
  }

  async function performDelete() {
    if (!token || busy || confirmation !== 'DELETE') return
    setBusy(true)
    setError('')
    try {
      await deleteAccount(token, currentPassword)
      let localClearFailed = false
      try { await clearOfflineVault() } catch { localClearFailed = true }
      try { await updateSessionToken(null) } catch { localClearFailed = true }
      router.replace('/')
      if (localClearFailed) Alert.alert('Account deleted', 'Your account is deleted. Clear this app’s storage from device settings before sharing the device.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The account could not be deleted.')
    } finally { setBusy(false) }
  }

  return <View style={styles.screen}><ScrollView contentContainerStyle={styles.page}>
    <View style={styles.nav}>
      <Pressable accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={19} color="#283a3c" /></Pressable>
      <Text style={styles.navTitle}>Delete account</Text><View style={{ width: 38 }} />
    </View>
    <Text style={styles.eyebrow}>ACCOUNT AND DATA</Text>
    <Text style={styles.title}>Remove your sign-in</Text>
    <Text style={styles.intro}>Your authentication details and access to all businesses will be deleted. Shared business records stay with their workspaces and remain subject to a separate retention review.</Text>

    <View style={styles.notice}><Ionicons name="information-circle-outline" size={19} color="#99743c" /><Text style={styles.noticeText}>Sync pending counts and export anything you need first. Deleting your account clears saved inventory and unsynced counts from this device.</Text></View>

    <Text style={styles.section}>BUSINESSES YOU ADMINISTER</Text>
    {loading && token ? <View style={styles.loading}><ActivityIndicator color="#11876e" /><Text style={styles.loadingText}>Reviewing your businesses…</Text></View> : preview?.workspaces.length ? preview.workspaces.map((workspace) => <View key={workspace.id} style={styles.workspace}>
      <View style={styles.workspaceCopy}><Text style={styles.workspaceName}>{workspace.name}</Text><Text style={styles.workspaceRole}>{workspace.role.replaceAll('_', ' ').toUpperCase()}{workspace.archivedAt ? ' · ARCHIVED, READ ONLY' : ''} · {workspace.otherMemberCount} other member{workspace.otherMemberCount === 1 ? '' : 's'}</Text></View>
      {workspace.soleAdmin && !workspace.archivedAt ? <Pressable disabled={!online || busy || !currentPassword} onPress={() => confirmArchive(workspace)} style={[styles.archiveButton, (!online || busy || !currentPassword) && styles.disabled]}><Text style={styles.archiveText}>{busy ? 'Working…' : 'Archive'}</Text></Pressable> : null}
    </View>) : <Text style={styles.helper}>{preview ? 'No business memberships were found for this account.' : 'Business review is unavailable until you reconnect and sign in.'}</Text>}
    {needsArchive.length > 0 && <Text style={styles.helper}>As the sole administrator, archive each listed business before deleting your account. Archived businesses remain read-only and have no administrator after deletion; email ezrasimiyu777@gmail.com if a business must remain active.</Text>}
    {preview?.workspaces.some((workspace) => workspace.soleAdmin && workspace.archivedAt) && <Text style={styles.helper}>These archived businesses will have no administrator after deletion. Other members may view retained records but cannot make changes; email ezrasimiyu777@gmail.com if a business must remain active.</Text>}
    {preview?.workspaces.some((workspace) => workspace.otherMemberCount === 0) && <Text style={styles.helper}>Any listed business with no other members will stay stored but have no user access after deletion. Email ezrasimiyu777@gmail.com if you need help restoring access later.</Text>}

    <Text style={styles.section}>CONFIRM DELETION</Text>
    <Text style={styles.label}>Current password</Text>
    <TextInput value={currentPassword} onChangeText={setCurrentPassword} placeholder="Enter your password" placeholderTextColor="#9aa49e" secureTextEntry autoCapitalize="none" autoCorrect={false} style={styles.input} textContentType="password" />
    <Text style={styles.label}>Type DELETE to confirm</Text>
    <TextInput value={confirmation} onChangeText={(value) => setConfirmation(value.toUpperCase())} placeholder="DELETE" placeholderTextColor="#9aa49e" autoCapitalize="characters" autoCorrect={false} style={styles.input} />
    {!online && <Text style={styles.helper}>Connect to the internet to review and delete your account.</Text>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={!canDelete} onPress={confirmDelete} style={[styles.deleteButton, !canDelete && styles.disabled]}><Ionicons name="trash-outline" size={16} color="#fff" /><Text style={styles.deleteText}>{busy ? 'Please wait…' : 'Delete account and clear device'}</Text></Pressable>
    <Text style={styles.footer}>Deleting access preserves shared records. Workspace retention periods are being reviewed separately.</Text>
  </ScrollView></View>
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f5f1' }, page: { paddingHorizontal: 20, paddingTop: 19, paddingBottom: 38, maxWidth: 620, width: '100%', alignSelf: 'center' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }, back: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6e8e2' }, navTitle: { color: '#29383a', fontSize: 12, fontWeight: '800' },
  eyebrow: { color: '#128b72', fontSize: 11, letterSpacing: 1.5, fontWeight: '900' }, title: { color: '#1a292e', fontSize: 24, fontWeight: '800', letterSpacing: -0.8, marginTop: 5 }, intro: { color: '#74817b', fontSize: 13, lineHeight: 19, marginTop: 8 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 13, backgroundColor: '#fff6e5', marginTop: 17 }, noticeText: { flex: 1, color: '#796942', fontSize: 11, lineHeight: 16 }, section: { color: '#929d97', fontSize: 10, letterSpacing: 1.4, fontWeight: '900', marginTop: 22, marginBottom: 8 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 }, loadingText: { color: '#75847d', fontSize: 12 }, workspace: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7e9e3', borderRadius: 13, marginBottom: 7 }, workspaceCopy: { flex: 1 }, workspaceName: { color: '#33413e', fontSize: 12, fontWeight: '800' }, workspaceRole: { color: '#929d97', fontSize: 9, fontWeight: '900', letterSpacing: 0.7, marginTop: 4 }, archiveButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#fff2ef', borderWidth: 1, borderColor: '#eedcd8' }, archiveText: { color: '#99554d', fontSize: 11, fontWeight: '800' },
  label: { color: '#586761', fontSize: 11, fontWeight: '800', marginTop: 10, marginBottom: 5 }, input: { minHeight: 46, paddingHorizontal: 12, color: '#253639', fontSize: 13, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e4e8e1', borderRadius: 12 }, helper: { color: '#8a9590', fontSize: 11, lineHeight: 15, marginTop: 8 }, error: { color: '#a24138', fontSize: 12, lineHeight: 17, marginTop: 12 }, deleteButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#a6443d', borderRadius: 12, marginTop: 16 }, deleteText: { color: '#fff', fontSize: 12, fontWeight: '900' }, disabled: { opacity: 0.45 }, footer: { color: '#929c96', fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 12 },
})
