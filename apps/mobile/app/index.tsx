import { Ionicons } from '@expo/vector-icons'
import * as SecureStore from 'expo-secure-store'
import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { API_BASE, api, ApiError } from '../src/lib/api'
import { getOfflineSnapshot } from '../src/lib/offline'

export default function SignInScreen() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [challengeToken, setChallengeToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void Promise.all([SecureStore.getItemAsync('kashflow.access-token'), getOfflineSnapshot()]).then(([token]) => {
      if (token) router.replace('/(tabs)/home')
    }).catch(() => undefined)
  }, [])

  async function signIn() {
    if (!identifier.trim() || !password) { setError('Enter your email or phone number and password.'); return }
    setBusy(true); setError('')
    try {
      if (challengeToken) {
        const verified = await api<{ accessToken: string }>('/v1/auth/two-factor/verify-login', undefined, { method: 'POST', body: { challengeToken, code } })
        if (!verified.accessToken) throw new Error('The secure sign-in response was incomplete. Try again.')
        await SecureStore.setItemAsync('kashflow.access-token', verified.accessToken, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
        router.replace('/(tabs)/home')
        return
      }
      const result = await api<{ accessToken?: string; twoFactorRequired?: boolean; challengeToken?: string }>('/v1/auth/login', undefined, { method: 'POST', body: { identifier: identifier.trim(), password } })
      if (result.twoFactorRequired && result.challengeToken) {
        setChallengeToken(result.challengeToken)
        setError('Enter the current authenticator code or a recovery code to finish signing in.')
        return
      }
      if (!result.accessToken) throw new Error('The secure sign-in response was incomplete. Try again.')
      await SecureStore.setItemAsync('kashflow.access-token', result.accessToken, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
      router.replace('/(tabs)/home')
    } catch (reason) {
      setError(reason instanceof ApiError || reason instanceof Error ? reason.message : 'Could not sign in. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  return <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.topline}><View style={styles.brand}>
        <LinearGradient colors={['#2ec7a0', '#0c9879']} style={styles.logo}><Ionicons name="layers" size={21} color="#fff" /></LinearGradient>
        <Text style={styles.brandName}>KashFlow<Text style={styles.brandDot}>.</Text></Text>
      </View><Text style={styles.topTag}>FIELD EDITION</Text></View>

      <LinearGradient colors={['#122a35', '#0f202b']} style={styles.hero}>
        <View style={styles.heroGlow} />
        <View style={styles.heroBadge}><View style={styles.greenDot} /><Text style={styles.heroBadgeText}>BUILT FOR THE SHOP FLOOR</Text></View>
        <Text style={styles.heroTitle}>Count with{ '\n' }<Text style={styles.heroAccent}>confidence.</Text></Text>
        <Text style={styles.heroBody}>Your business, one tap away. Keep stock moving even when the network doesn&apos;t.</Text>
        <View style={styles.heroFoot}><View style={styles.heroLine} /><Text style={styles.heroFootText}>OFFLINE READY · KENYA FIRST</Text></View>
      </LinearGradient>

      <View style={styles.formHeader}><View><Text style={styles.eyebrow}>WELCOME BACK</Text><Text style={styles.formTitle}>{challengeToken ? 'Verify it’s you' : 'Sign in to KashFlow'}</Text></View><View style={styles.lockIcon}><Ionicons name="lock-closed-outline" size={17} color="#14866e" /></View></View>
      <Text style={styles.formSub}>{challengeToken ? 'Use your authenticator app or a one-time recovery code.' : 'Your saved stock and counts stay on this device when you’re offline.'}</Text>
      {!challengeToken && <>
        <Text style={styles.label}>EMAIL OR PHONE</Text>
        <TextInput autoCapitalize="none" autoComplete="username" keyboardType="email-address" placeholder="you@business.co.ke" placeholderTextColor="#9aa4a7" style={styles.input} value={identifier} onChangeText={setIdentifier} returnKeyType="next" />
        <Text style={[styles.label, styles.passwordLabel]}>PASSWORD</Text>
        <TextInput secureTextEntry autoComplete="current-password" placeholder="Your password" placeholderTextColor="#9aa4a7" style={styles.input} value={password} onChangeText={setPassword} onSubmitEditing={() => void signIn()} returnKeyType="go" />
      </>}
      {challengeToken && <><Text style={styles.label}>AUTHENTICATOR OR RECOVERY CODE</Text><TextInput autoCapitalize="characters" keyboardType="number-pad" placeholder="6 digit code" placeholderTextColor="#9aa4a7" style={styles.input} value={code} onChangeText={setCode} onSubmitEditing={() => void signIn()} returnKeyType="go" /></>}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable onPress={() => void signIn()} disabled={busy} style={({ pressed }) => [styles.submit, pressed && styles.pressed, busy && styles.disabled]}>
        {busy ? <ActivityIndicator color="#fff" /> : <><Text style={styles.submitText}>{challengeToken ? 'Verify & continue' : 'Continue to your business'}</Text><Ionicons name="arrow-forward" size={18} color="#fff" /></>}
      </Pressable>
      {challengeToken && <Pressable style={styles.backLink} onPress={() => { setChallengeToken(''); setCode(''); setError('') }}><Text style={styles.backLinkText}>Use a different account</Text></Pressable>}

      <View style={styles.secureNote}><Ionicons name="shield-checkmark-outline" size={17} color="#13876e" /><Text style={styles.secureText}>Encrypted offline storage · Secure sign-in · Built for low-connectivity work</Text></View>
      <Text style={styles.apiFoot}>Service: {API_BASE.replace(/^https:\/\//, '')}</Text>
    </ScrollView>
  </KeyboardAvoidingView>
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#f6f5f1' },
  page: { flexGrow: 1, paddingHorizontal: 23, paddingTop: 18, paddingBottom: 28, maxWidth: 560, width: '100%', alignSelf: 'center' },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  brand: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  logo: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 19, letterSpacing: -0.8, color: '#18242b', fontWeight: '800' },
  brandDot: { color: '#14a180' },
  topTag: { color: '#81908f', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  hero: { borderRadius: 23, padding: 24, minHeight: 224, overflow: 'hidden', justifyContent: 'space-between' },
  heroGlow: { position: 'absolute', width: 230, height: 230, borderRadius: 120, borderWidth: 1, borderColor: '#4ec7a22a', right: -100, top: 8 },
  heroBadge: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  greenDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#45d3a6' },
  heroBadgeText: { color: '#bad2ce', fontWeight: '800', fontSize: 12, letterSpacing: 1.5 },
  heroTitle: { color: '#fff', fontWeight: '700', fontSize: 36, lineHeight: 39, letterSpacing: -1.5, marginTop: 18 },
  heroAccent: { color: '#69e0b8' },
  heroBody: { color: '#bfd0d0', fontSize: 13, lineHeight: 19, maxWidth: 300, marginTop: 8 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 21 },
  heroLine: { width: 22, height: 1, backgroundColor: '#5cd0aa' },
  heroFootText: { color: '#88aaa6', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28 },
  eyebrow: { color: '#0b9879', fontWeight: '800', fontSize: 12, letterSpacing: 1.7, marginBottom: 5 },
  formTitle: { color: '#19262c', fontWeight: '800', fontSize: 22, letterSpacing: -0.6 },
  lockIcon: { width: 36, height: 36, borderRadius: 13, backgroundColor: '#e7f3ee', alignItems: 'center', justifyContent: 'center' },
  formSub: { marginTop: 7, marginBottom: 20, color: '#788581', fontSize: 12, lineHeight: 18 },
  label: { color: '#62716e', fontSize: 12, fontWeight: '800', letterSpacing: 1.3, marginBottom: 8 },
  passwordLabel: { marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#e2e5df', backgroundColor: '#fff', color: '#17252b', borderRadius: 13, paddingHorizontal: 15, height: 51, fontSize: 14 },
  error: { color: '#b3443f', fontSize: 12, lineHeight: 18, marginTop: 12 },
  submit: { height: 53, borderRadius: 14, marginTop: 20, backgroundColor: '#108c70', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, shadowColor: '#0b684f', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  submitText: { fontSize: 13, color: '#fff', fontWeight: '800' },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.65 },
  backLink: { alignSelf: 'center', paddingVertical: 14 },
  backLinkText: { color: '#0d8a6f', fontSize: 12, fontWeight: '700' },
  secureNote: { flexDirection: 'row', gap: 9, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#e7e8e3', paddingTop: 16, marginTop: 22 },
  secureText: { flex: 1, color: '#7c8985', fontSize: 13, lineHeight: 15 },
  apiFoot: { color: '#a4aaa5', fontSize: 12, textAlign: 'center', marginTop: 12 },
})
