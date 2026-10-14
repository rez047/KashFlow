import { Ionicons } from '@expo/vector-icons'
import * as FileSystem from 'expo-file-system/legacy'
import * as Print from 'expo-print'
import * as SecureStore from 'expo-secure-store'
import * as Sharing from 'expo-sharing'
import { zipSync } from 'fflate'
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, type WebViewNavigation } from 'react-native-webview'
import { useEffect, useRef, useState } from 'react'
import { useKashFlow } from '../../src/components/KashFlowProvider'

const WORKSPACE_URL = (process.env.EXPO_PUBLIC_WORKSPACE_URL || 'https://kashflow-frontend.onrender.com').replace(/\/$/, '')
const WORKSPACE_ORIGIN = new URL(WORKSPACE_URL).origin
const WORKSPACE_PROTOCOL = new URL(WORKSPACE_URL).protocol
const WEBVIEW_BRIDGE = `(function(){if(window.__kashflowMobileBridgeInstalled)return true;window.__kashflowMobileExports=new Map();const create=URL.createObjectURL.bind(URL);URL.createObjectURL=function(blob){const url=create(blob);window.__kashflowMobileExports.set(url,blob);return url};document.addEventListener('click',function(event){const link=event.target instanceof Element?event.target.closest('a[download]'):null;if(!link||!link.href.startsWith('blob:'))return;const blob=window.__kashflowMobileExports.get(link.href);if(!blob)return;event.preventDefault();const reader=new FileReader();reader.onloadend=function(){const data=String(reader.result||'');const base64=data.slice(data.indexOf(',')+1);const size=32768;const total=Math.max(1,Math.ceil(base64.length/size));for(let index=0;index<total;index++){window.ReactNativeWebView.postMessage(JSON.stringify({type:'workspace-export-chunk',name:link.download||'kashflow-export.csv',index,total,chunk:base64.slice(index*size,(index+1)*size)}))}};reader.readAsDataURL(blob)},true);window.print=function(){window.ReactNativeWebView.postMessage(JSON.stringify({type:'workspace-print',html:document.documentElement.outerHTML,title:document.title}))};window.__kashflowMobileBridgeInstalled=true})();true;`
const OFFLINE_SHELL_CHECK = `(async function(){const finish=function(ready){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'workspace-offline-shell-status',ready:Boolean(ready)}))}catch(_){}};const timeout=function(){return new Promise(function(_,reject){setTimeout(function(){reject(new Error('offline-shell-timeout'))},45000)})};try{if(!('serviceWorker'in navigator)||!('caches'in window)){finish(false);return}await Promise.race([navigator.serviceWorker.ready,timeout()]);if(!navigator.serviceWorker.controller){await Promise.race([new Promise(function(resolve){navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true})}),timeout()])}const appShell=await caches.match(new URL('/index.html',location.origin).href);const assets=Array.from(document.querySelectorAll('script[src],link[rel~="stylesheet"],link[rel~="modulepreload"]')).map(function(node){return node.src||node.href}).filter(function(url){return url&&new URL(url).origin===location.origin});const cachedAssets=await Promise.all(assets.map(function(url){return caches.match(url)}));finish(Boolean(appShell&&navigator.serviceWorker.controller&&cachedAssets.every(Boolean)))}catch(_){finish(false)}})();true;`

function bytesToBase64(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    output += alphabet[first >> 2]
    output += alphabet[((first & 3) << 4) | (second === undefined ? 0 : second >> 4)]
    output += second === undefined ? '==' : third === undefined ? `${alphabet[(second & 15) << 2]}=` : `${alphabet[((second & 15) << 2) | (third >> 6)]}${alphabet[third & 63]}`
  }
  return output
}

function base64ToBytes(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const output = new Uint8Array(Math.floor(value.length * 3 / 4))
  let buffer = 0
  let bits = 0
  let offset = 0
  for (const character of value) {
    if (character === '=') break
    const digit = alphabet.indexOf(character)
    if (digit < 0) continue
    buffer = (buffer << 6) | digit
    bits += 6
    if (bits >= 8) {
      bits -= 8
      output[offset++] = (buffer >> bits) & 255
    }
  }
  return output.subarray(0, offset)
}

export default function WorkspaceScreen() {
  const { online, token, updateSessionToken } = useKashFlow()
  const webView = useRef<WebView>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [offlineShellReady, setOfflineShellReady] = useState(false)
  const [offlineShellChecked, setOfflineShellChecked] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [currentUrl, setCurrentUrl] = useState(WORKSPACE_URL)
  const [sharingExport, setSharingExport] = useState(false)
  const exportFiles = useRef(new Map<string, string>())
  const pendingExportChunks = useRef(new Map<string, { chunks: string[]; received: number }>())
  const expectedExports = useRef<number | null>(null)
  const exportTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync('kashflow.workspace.offline-shell-ready').then((value) => {
      if (active && value === 'true') setOfflineShellReady(true)
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    const nextToken = token ?? ''
    const script = `(function(){var nextToken=${JSON.stringify(nextToken)};if(window.__kashflowNativeToken!==nextToken){window.__kashflowNativeToken=nextToken;window.location.reload();}})();true;`
    webView.current?.injectJavaScript(script)
  }, [token])

  function handleNavigation(state: WebViewNavigation) {
    setCanGoBack(state.canGoBack)
    setCurrentUrl(state.url)
  }

  function openInBrowser() {
    const url = currentUrl.startsWith(WORKSPACE_ORIGIN) ? currentUrl : WORKSPACE_URL
    void Linking.openURL(url).catch(() => undefined)
  }

  function allowNavigation(url: string) {
    try {
      const target = new URL(url)
      if (target.origin === WORKSPACE_ORIGIN) return true
      if (target.protocol === 'https:' || target.protocol === 'mailto:') void Linking.openURL(url).catch(() => undefined)
    } catch { /* Reject malformed and unsupported navigation targets. */ }
    return false
  }

  function scheduleWorkspaceShare() {
    if (expectedExports.current === null) return
    if (exportTimer.current) clearTimeout(exportTimer.current)
    const complete = exportFiles.current.size >= expectedExports.current && pendingExportChunks.current.size === 0
    exportTimer.current = setTimeout(() => {
      exportTimer.current = null
      expectedExports.current = null
      void shareWorkspaceExports(!complete)
    }, complete ? 120 : 10000)
  }

  function handleWebMessage(message: string) {
    try {
      const payload = JSON.parse(message) as { type?: string; accessToken?: string; name?: string; index?: number; total?: number; chunk?: string; expected?: number; html?: string; ready?: boolean }
      if (payload.type === 'session-token' && typeof payload.accessToken === 'string') {
        void updateSessionToken(payload.accessToken).catch(() => Alert.alert('Session update failed', 'The device could not save the workspace session securely. Sign in again or check device storage.'))
      } else if (payload.type === 'workspace-offline-shell-status' && typeof payload.ready === 'boolean') {
        setOfflineShellChecked(true)
        setOfflineShellReady(payload.ready)
        void SecureStore.setItemAsync('kashflow.workspace.offline-shell-ready', String(payload.ready)).catch(() => undefined)
      } else if (payload.type === 'workspace-export-chunk' && typeof payload.name === 'string' && typeof payload.index === 'number' && typeof payload.total === 'number' && typeof payload.chunk === 'string') {
        const name = payload.name.replace(/[^a-zA-Z0-9._-]/g, '-')
        const part = pendingExportChunks.current.get(name) ?? { chunks: Array.from({ length: payload.total }, () => ''), received: 0 }
        if (payload.total === part.chunks.length && payload.index >= 0 && payload.index < payload.total && !part.chunks[payload.index]) {
          part.chunks[payload.index] = payload.chunk
          part.received += 1
          pendingExportChunks.current.set(name, part)
          if (part.received === part.chunks.length) {
            pendingExportChunks.current.delete(name)
            exportFiles.current.set(name, part.chunks.join(''))
            scheduleWorkspaceShare()
          }
        }
      } else if (payload.type === 'workspace-export-finished' && typeof payload.expected === 'number') {
        expectedExports.current = Math.max(0, payload.expected)
        if (expectedExports.current === 0) Alert.alert('No exports received', 'The workspace could not download any CSV files. Check the workspace message and try again.')
        else scheduleWorkspaceShare()
      } else if (payload.type === 'workspace-print' && typeof payload.html === 'string') {
        const cleanHtml = payload.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        const html = cleanHtml.replace(/<head([^>]*)>/i, `<head$1><base href="${WORKSPACE_URL}/">`)
        void Print.printAsync({ html }).catch(() => Alert.alert('Print unavailable', 'Open the full workspace in your browser to print this page.'))
      }
    } catch { /* Ignore malformed messages from the workspace page. */ }
  }

  async function shareWorkspaceExports(partial = false) {
    const files = Array.from(exportFiles.current.entries())
    exportFiles.current.clear()
    pendingExportChunks.current.clear()
    exportTimer.current = null
    if (!files.length) {
      Alert.alert('Export unavailable', 'No workspace files arrived to share. Try the export again.')
      return
    }
    setSharingExport(true)
    try {
      const contents = Object.fromEntries(files.map(([name, base64]) => [name, base64ToBytes(base64)]))
      const allExports = files.length > 1
      const data = allExports ? zipSync(Object.fromEntries(Object.entries(contents).map(([name, bytes]) => [name, bytes]))) : contents[files[0][0]]
      const fileName = allExports ? `kashflow-export-${Date.now()}.zip` : files[0][0]
      const mimeType = allExports ? 'application/zip' : 'text/csv'
      const directory = FileSystem.cacheDirectory
      if (!directory) throw new Error('The device did not provide temporary storage for this export.')
      const uri = `${directory}${fileName}`
      await FileSystem.writeAsStringAsync(uri, bytesToBase64(data), { encoding: FileSystem.EncodingType.Base64 })
      if (!await Sharing.isAvailableAsync()) throw new Error('The device share sheet is unavailable. Open the full workspace in your browser to download the files.')
      await Sharing.shareAsync(uri, { mimeType, dialogTitle: allExports ? 'Share all workspace exports' : 'Share workspace export' })
    } catch (reason) {
      Alert.alert('Export could not be shared', reason instanceof Error ? reason.message : 'Open the full workspace in your browser to download the files.')
    } finally {
      setSharingExport(false)
      if (partial) Alert.alert('Some exports are still missing', 'The workspace did not finish sending every CSV. The files received so far were shared.')
    }
  }

  return <SafeAreaView style={styles.safe} edges={['top']}>
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <View style={styles.heading}>
          <Text style={styles.kicker}>KASHFLOW</Text>
          <Text style={styles.title}>Full business suite</Text>
        </View>
        <View style={styles.controls}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back in workspace" disabled={!canGoBack} onPress={() => webView.current?.goBack()} style={[styles.control, !canGoBack && styles.controlDisabled]}><Ionicons name="arrow-back" size={17} color={canGoBack ? '#32413e' : '#a7b0aa'} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Reload workspace" onPress={() => { setLoadError(false); webView.current?.reload() }} style={styles.control}><Ionicons name="refresh" size={17} color="#32413e" /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open in browser for printing and downloads" onPress={openInBrowser} style={styles.control}><Ionicons name="open-outline" size={17} color="#16866e" /></Pressable>
        </View>
      </View>

      {online && <View style={styles.shellStatus}><Ionicons name={offlineShellReady ? 'checkmark-circle' : offlineShellChecked ? 'cloud-download-outline' : 'time-outline'} size={14} color={offlineShellReady ? '#14866b' : '#a87532'} /><Text style={styles.shellStatusText}>{offlineShellReady ? 'Offline workspace saved on this phone' : offlineShellChecked ? 'Offline cache not ready. Reconnect and reload this tab.' : 'Saving the mobile workspace for offline use…'}</Text></View>}

      {!online && <View style={styles.offlineCard}>
        <View style={styles.offlineIcon}><Ionicons name="cloud-offline-outline" size={19} color="#a87532" /></View>
        <View style={styles.offlineCopy}><Text style={styles.offlineTitle}>{offlineShellReady ? 'Saved full workspace ready' : 'Offline field tools available'}</Text>
          <Text style={styles.offlineBody}>{offlineShellReady ? 'Opening this phone’s saved workspace. Changes will sync when you reconnect.' : offlineShellChecked ? 'This phone has no confirmed saved suite yet. Reconnect and open this tab once to cache it.' : 'Checking this phone’s saved suite. Inventory and count tools remain available.'}</Text></View>
      </View>}
      <View style={styles.webArea}>
        <WebView
          ref={webView}
          source={{ uri: WORKSPACE_URL }}
          injectedJavaScriptBeforeContentLoaded={`window.__kashflowNativeToken = ${JSON.stringify(token ?? '')}; true;`}
          injectedJavaScript={WEBVIEW_BRIDGE}
          originWhitelist={[`${WORKSPACE_PROTOCOL}//*`]}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          setSupportMultipleWindows={false}
          mixedContentMode="never"
          onNavigationStateChange={handleNavigation}
          onMessage={(event) => handleWebMessage(event.nativeEvent.data)}
          onShouldStartLoadWithRequest={(request) => allowNavigation(request.url)}
          onLoadStart={() => { setLoading(true); setLoadError(false) }}
          onLoadEnd={() => { setLoading(false); webView.current?.injectJavaScript(OFFLINE_SHELL_CHECK) }}
          onError={() => { setLoading(false); setLoadError(true); setOfflineShellChecked(true); setOfflineShellReady(false); void SecureStore.setItemAsync('kashflow.workspace.offline-shell-ready', 'false').catch(() => undefined) }}
          onHttpError={(event) => { if (event.nativeEvent.statusCode >= 500) { setLoadError(true); setOfflineShellChecked(true); setOfflineShellReady(false); void SecureStore.setItemAsync('kashflow.workspace.offline-shell-ready', 'false').catch(() => undefined) } }}
          onFileDownload={({ nativeEvent }) => { void Linking.openURL(nativeEvent.downloadUrl).catch(() => setLoadError(true)) }}
          style={styles.webView}
        />
        {loadError && <View style={styles.errorOverlay}>
          <View style={styles.errorIcon}><Ionicons name="cloud-offline-outline" size={22} color="#b04c40" /></View>
          <Text style={styles.errorTitle}>Workspace could not load</Text>
          <Text style={styles.errorBody}>{offlineShellReady ? 'This phone has cached the suite, but the last load failed. Retry it; your offline inventory and counts remain available in the other tabs.' : 'The full suite has not been confirmed in this phone’s offline cache. Reconnect and open it once; your offline inventory and counts remain available in the other tabs.'}</Text>
          <Pressable accessibilityRole="button" onPress={() => { setLoadError(false); webView.current?.reload() }} style={styles.retryButton}><Ionicons name="refresh" size={15} color="#fff" /><Text style={styles.retryText}>Try again</Text></Pressable>
        </View>}
        {loading && !loadError && <View pointerEvents="none" style={styles.loadingOverlay}><View style={styles.loadingMark}><Ionicons name="layers" size={20} color="#fff" /></View><Text style={styles.loadingText}>Opening your business workspace…</Text></View>}
      </View>
      <Text style={styles.footnote}>{sharingExport ? 'Preparing your workspace export…' : 'Complete KashFlow business suite · printing and exports use the device share sheets.'}</Text>
    </View>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f6f5f1' },
  screen: { flex: 1, backgroundColor: '#f6f5f1' },
  toolbar: { minHeight: 58, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#e6e8e2', backgroundColor: '#fff' },
  shellStatus: { minHeight: 29, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f0f7f2' }, shellStatusText: { color: '#71827a', fontSize: 10, fontWeight: '700' },
  heading: { flex: 1 }, kicker: { color: '#14876d', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 }, title: { color: '#1d2b30', fontSize: 17, fontWeight: '800', marginTop: 2 },
  controls: { flexDirection: 'row', gap: 7 }, control: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#f2f5f1', borderWidth: 1, borderColor: '#e5e9e2', alignItems: 'center', justifyContent: 'center' }, controlDisabled: { backgroundColor: '#f8f9f7' },
  webArea: { flex: 1, backgroundColor: '#fff' }, webView: { flex: 1, backgroundColor: '#fff' },
  footnote: { color: '#7f8c86', backgroundColor: '#fff', fontSize: 10, lineHeight: 13, textAlign: 'center', paddingHorizontal: 12, paddingTop: 7, paddingBottom: 8 },
  loadingOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: '#f8faf7' }, loadingMark: { width: 41, height: 41, borderRadius: 14, backgroundColor: '#128d71', alignItems: 'center', justifyContent: 'center' }, loadingText: { color: '#74827a', fontSize: 12, fontWeight: '700' },
  errorOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, backgroundColor: '#f8faf7' }, errorIcon: { width: 45, height: 45, borderRadius: 15, backgroundColor: '#fff0ec', alignItems: 'center', justifyContent: 'center' }, errorTitle: { color: '#283b3d', fontSize: 16, fontWeight: '800', marginTop: 13 }, errorBody: { color: '#7f8c86', fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 6, maxWidth: 290 }, retryButton: { height: 39, paddingHorizontal: 15, borderRadius: 11, backgroundColor: '#128d71', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 14 }, retryText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  offlineCard: { marginHorizontal: 10, marginTop: 7, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff8eb', borderWidth: 1, borderColor: '#f0e3ca', borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 9 }, offlineIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#fff0d8', alignItems: 'center', justifyContent: 'center' }, offlineCopy: { flex: 1 }, offlineTitle: { color: '#6f542d', fontSize: 12, fontWeight: '800' }, offlineBody: { color: '#8c7857', fontSize: 10, lineHeight: 14, marginTop: 2 },
})
