import {
  Activity, ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCircle2,
  ChevronDown, ChevronRight, CircleAlert, Cloud, CloudOff, CloudUpload,
  Home, Layers3, LockKeyhole, LogOut, Minus, Package, Plus, RefreshCw, Search, Settings2,
  ShieldCheck, Sparkles, Store, Wifi, WifiOff,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

type Page = 'home' | 'inventory' | 'count' | 'sync' | 'settings'
type Item = DesktopVault['items'][number]
type Count = DesktopVault['counts'][number]
const emptyVault: DesktopVault = { token: '', userEmail: '', workspaceId: '', workspaceName: '', refreshedAt: '', items: [], locations: [], stock: [], counts: [] }
const todayNairobi = () => {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
const compactQty = (value: number) => value.toLocaleString('en-KE', { maximumFractionDigits: 3 })

export default function App() {
  const [vault, setVault] = useState<DesktopVault>(emptyVault)
  const [loaded, setLoaded] = useState(false)
  const [vaultError, setVaultError] = useState('')
  const [online, setOnline] = useState(false)
  const onlineState = useRef(false)
  const promptedForQueue = useRef(false)
  const [page, setPage] = useState<Page>('home')
  const [toast, setToast] = useState('')
  const toastAction = useRef<(() => void) | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [locationFilter, setLocationFilter] = useState('all')
  const [itemId, setItemId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [countedQuantity, setCountedQuantity] = useState('')
  const [countReference, setCountReference] = useState('')
  const [supersedesKey, setSupersedesKey] = useState('')
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [twoFactorChallenge, setTwoFactorChallenge] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [loginError, setLoginError] = useState('')
  const [appVersion, setAppVersion] = useState('1.0.0')

  const currentItem = vault.items.find((item) => item.id === itemId)
  const activeLocations = vault.locations.filter((location) => location.active)
  const currentLocationId = locationId || activeLocations.find((location) => location.is_default)?.id || activeLocations[0]?.id || ''
  const currentBalance = Number(vault.stock.find((row) => row.item_id === itemId && row.location_id === currentLocationId)?.quantity ?? 0)
  const pendingCount = vault.counts.filter((count) => count.state === 'pending').length
  const conflictCount = vault.counts.filter((count) => count.state === 'conflict').length
  const itemTotal = (item: Item, filter = 'all') => filter === 'all'
    ? vault.stock.filter((row) => row.item_id === item.id).reduce((sum, row) => sum + row.quantity, 0)
    : Number(vault.stock.find((row) => row.item_id === item.id && row.location_id === filter)?.quantity ?? 0)
  const visibleItems = useMemo(() => vault.items.filter((item) => {
    const term = query.trim().toLowerCase()
    const matches = !term || [item.name, item.sku, item.category].some((value) => value.toLowerCase().includes(term))
    const inLocation = locationFilter === 'all' || vault.stock.some((row) => row.item_id === item.id && row.location_id === locationFilter)
    return matches && inLocation
  }), [vault.items, vault.stock, query, locationFilter])

  const notify = useCallback((message: string, action?: () => void) => {
    setToast(message); toastAction.current = action ?? null
    window.setTimeout(() => { setToast(''); toastAction.current = null }, 6500)
  }, [])
  const persistVault = useCallback(async (next: DesktopVault) => {
    await window.kashflowDesktop.saveVault(next)
    setVault(next)
  }, [])

  const refreshCatalog = useCallback(async (token = vault.token, userEmail = vault.userEmail, baseVault = vault) => {
    if (!token) return
    const call = async <T,>(path: string) => {
      const response = await window.kashflowDesktop.request(path, token)
      if (!response.ok) throw new Error(typeof response.data.error === 'string' ? response.data.error : `Request failed (${response.status}).`)
      return response.data as T
    }
    const [me, recordResult, locationsResult, stockResult] = await Promise.all([
      call<{ workspace: { id: string; name: string } }>('/v1/auth/me'),
      call<{ records: Array<{ id: string; data: Record<string, unknown> }> }>('/v1/records/inventory'),
      call<{ locations: DesktopVault['locations'] }>('/v1/inventory/locations'),
      call<{ stock: Array<{ item_id: string; location_id: string; quantity: string }> }>('/v1/inventory/location-stock'),
    ])
    const next: DesktopVault = {
      ...baseVault,
      token,
      userEmail,
      workspaceId: me.workspace.id,
      workspaceName: me.workspace.name,
      refreshedAt: new Date().toISOString(),
      items: recordResult.records.map(({ id, data }) => ({ id, name: String(data.name ?? data.description ?? 'Untitled item'), sku: String(data.sku ?? ''), category: String(data.category ?? ''), unit: String(data.unit ?? 'units'), cost: Number(data.cost ?? 0), quantity: Number(data.quantity ?? 0) })),
      locations: locationsResult.locations,
      stock: stockResult.stock.map((row) => ({ ...row, quantity: Number(row.quantity) })),
    }
    await persistVault(next)
    return next
  }, [persistVault, vault])

  const syncCounts = useCallback(async (showToast = true) => {
    if (!vault.token) { notify('Sign in again while connected to sync this device.'); return }
    if (!online) { notify('Still offline. Your counts remain encrypted on this computer.'); return }
    const queue = vault.counts.filter((count) => count.state === 'pending')
    if (!queue.length) { notify('No counts are waiting to sync.'); return }
    setBusy(true)
    let synced = 0, conflicts = 0, failed = 0
    let current = vault
    try {
      for (const count of queue) {
        const response = await window.kashflowDesktop.request('/v1/inventory/counts', vault.token, { method: 'POST', body: { itemId: count.itemId, locationId: count.locationId, countedQuantity: count.countedQuantity, expectedQuantity: count.expectedQuantity, idempotencyKey: count.idempotencyKey, date: count.date, reference: count.reference } })
        if (response.ok) {
          current = { ...current, counts: current.counts.map((item) => item.idempotencyKey === count.idempotencyKey ? { ...item, state: 'synced', message: '', serverQuantity: null } : item) }
          synced += 1
        } else if (response.status === 409 && response.data.conflict === true) {
          current = { ...current, counts: current.counts.map((item) => item.idempotencyKey === count.idempotencyKey ? { ...item, state: 'conflict', serverQuantity: typeof response.data.serverQuantity === 'number' ? response.data.serverQuantity : null, message: typeof response.data.error === 'string' ? response.data.error : 'Stock changed after this count began.' } : item) }
          conflicts += 1
        } else failed += 1
        await window.kashflowDesktop.saveVault(current)
      }
      setVault(current)
      try { await refreshCatalog(current.token, current.userEmail, current) } catch (error) { if (error instanceof Error && error.message.includes('Authentication')) notify('Reconnect and sign in again to refresh. Your unsynced counts are still saved.') }
      if (showToast) notify(`${synced} count${synced === 1 ? '' : 's'} synced${conflicts ? ` · ${conflicts} need review` : ''}${failed ? ` · ${failed} still pending` : ''}.`)
    } catch (error) {
      if (showToast) notify(error instanceof Error ? `${error.message}. Keep this app open and retry when online.` : 'Sync was interrupted. Your unsynced counts remain saved.')
    } finally { setBusy(false) }
  }, [notify, online, refreshCatalog, vault])

  useEffect(() => {
    let mounted = true
    void window.kashflowDesktop.loadVault().then((saved) => {
      if (!mounted) return
      if (saved && typeof saved === 'object') setVault({ ...emptyVault, ...saved })
      setLoaded(true)
    }).catch((error: unknown) => {
      if (mounted) { setVaultError(error instanceof Error ? error.message : 'The encrypted business vault could not be opened.'); setLoaded(true) }
    })
    void window.kashflowDesktop.ping().then((connected) => { if (mounted) { onlineState.current = connected; setOnline(connected) } })
    void window.kashflowDesktop.version().then(setAppVersion).catch(() => undefined)
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const goOnline = () => { void window.kashflowDesktop.ping().then((connected) => { onlineState.current = connected; setOnline(connected) }) }
    const goOffline = () => { onlineState.current = false; promptedForQueue.current = false; setOnline(false); notify('You are offline. Counting and saving remain available.') }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    const interval = window.setInterval(goOnline, 30000)
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); window.clearInterval(interval) }
  }, [notify])

  useEffect(() => {
    if (!loaded || !online || !vault.token) { if (!online) promptedForQueue.current = false; return }
    if (pendingCount > 0 && !promptedForQueue.current) {
      promptedForQueue.current = true
      notify(`${pendingCount} saved count${pendingCount === 1 ? '' : 's'} can sync.`, () => { void syncCounts() })
    } else if (pendingCount === 0) promptedForQueue.current = false
  }, [loaded, online, pendingCount, notify, syncCounts, vault.token])

  useEffect(() => {
    const handlePop = () => {
      const requested = location.hash.replace('#', '') as Page
      setPage(['home', 'inventory', 'count', 'sync', 'settings'].includes(requested) ? requested : 'home')
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.altKey && event.key === 'ArrowLeft' || event.key === 'Escape') && page !== 'home' && loaded && vault.token) window.history.back()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [loaded, page, vault.token])

  function navigate(next: Page) {
    if (next === page) return
    window.history.pushState({ page: next }, '', `#${next}`)
    setPage(next)
  }

  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setLoginError('')
    try {
      if (twoFactorChallenge) {
        const response = await window.kashflowDesktop.request('/v1/auth/two-factor/verify-login', undefined, { method: 'POST', body: { challengeToken: twoFactorChallenge, code: twoFactorCode } })
        if (!response.ok) throw new Error(typeof response.data.error === 'string' ? response.data.error : 'Could not verify this sign-in.')
        await finishLogin(response.data)
        return
      }
      const response = await window.kashflowDesktop.request('/v1/auth/login', undefined, { method: 'POST', body: { identifier: loginIdentifier.trim(), password: loginPassword } })
      if (!response.ok) throw new Error(typeof response.data.error === 'string' ? response.data.error : 'Could not sign in.')
      if (response.data.twoFactorRequired === true && typeof response.data.challengeToken === 'string') { setTwoFactorChallenge(response.data.challengeToken); setLoginError('Enter your authenticator or recovery code to finish.'); return }
      await finishLogin(response.data)
    } catch (error) { setLoginError(error instanceof Error ? error.message : 'Could not sign in. Check your connection and try again.') }
    finally { setBusy(false) }
  }

  async function finishLogin(data: Record<string, unknown>) {
    const token = typeof data.accessToken === 'string' ? data.accessToken : ''
    const userEmail = (data.user as { email?: string } | undefined)?.email ?? loginIdentifier.trim()
    const workspace = data.workspace as { id?: string; name?: string } | undefined
    if (!token) throw new Error('The secure sign-in response was incomplete. Try again.')
    const next = { ...emptyVault, token, userEmail, workspaceId: workspace?.id ?? '', workspaceName: workspace?.name ?? '' }
    await persistVault(next)
    try { await refreshCatalog(token, userEmail) } catch (error) { notify(error instanceof Error ? `Signed in, but the first inventory sync failed: ${error.message}` : 'Signed in. Connect to download the inventory snapshot.') }
    navigate('home')
  }

  async function refreshAndNotify() {
    if (!online) { notify('Reconnect to refresh the business inventory.'); return }
    if (!vault.token) { notify('Sign in while online to load your business.'); return }
    setBusy(true)
    try { const next = await refreshCatalog(); notify(`${next?.items.length ?? 0} items refreshed for ${next?.workspaceName ?? vault.workspaceName}.`) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not refresh inventory.') }
    finally { setBusy(false) }
  }

  async function savePhysicalCount(event: FormEvent) {
    event.preventDefault()
    if (!currentItem || !currentLocationId || countedQuantity.trim() === '' || !Number.isFinite(Number(countedQuantity)) || Number(countedQuantity) < 0) { notify('Choose a product, location, and non-negative physical count.'); return }
    const count: Count = {
      idempotencyKey: crypto.randomUUID(), itemId: currentItem.id, itemName: currentItem.name,
      locationId: currentLocationId, locationName: activeLocations.find((location) => location.id === currentLocationId)?.name ?? 'Location',
      countedQuantity: Number(Number(countedQuantity).toFixed(3)), expectedQuantity: currentBalance,
      date: todayNairobi(), reference: countReference.trim().slice(0, 200), state: 'pending', serverQuantity: null, message: '', createdAt: new Date().toISOString(),
    }
    const next = { ...vault, counts: [count, ...vault.counts] }
    setBusy(true)
    try {
      await persistVault(next)
      if (supersedesKey) {
        const updated = { ...next, counts: next.counts.map((row) => row.idempotencyKey === supersedesKey ? { ...row, state: 'superseded' as const, message: 'Replaced by a new physical count after the stock change.' } : row) }
        await persistVault(updated)
      }
      setCountedQuantity(''); setCountReference(''); setQuery(''); setSupersedesKey('')
      notify(online ? 'Count encrypted and saved. Ready to sync.' : 'Count encrypted and saved on this computer.', online ? () => { void syncCounts() } : undefined)
      navigate('sync')
    } catch (error) { notify(error instanceof Error ? error.message : 'The count could not be saved. Check local storage and retry.') }
    finally { setBusy(false) }
  }

  function startRecount(count: Count) {
    setItemId(count.itemId); setLocationId(count.locationId); setCountedQuantity(''); setCountReference(''); setSupersedesKey(count.idempotencyKey); setQuery('')
    navigate('count')
  }

  async function clearLocalData() {
    const clean = { ...emptyVault }
    await persistVault(clean)
    setPage('home'); window.history.replaceState({ page: 'home' }, '', '#home')
    notify('This computer’s encrypted business data has been cleared.')
  }

  if (!loaded) return <div className="loading-screen"><div className="brand-mark"><Layers3 size={20} /></div><span>Opening your secure workspace…</span></div>
  if (vaultError) return <div className="error-screen"><div className="error-mark"><LockKeyhole size={23} /></div><h1>Secure storage unavailable</h1><p>{vaultError}</p><small>KashFlow won’t fall back to saving business data in plain text.</small></div>
  if (!vault.token) return <LoginPage identifier={loginIdentifier} setIdentifier={setLoginIdentifier} password={loginPassword} setPassword={setLoginPassword} challenge={twoFactorChallenge} code={twoFactorCode} setCode={setTwoFactorCode} error={loginError} busy={busy} onSubmit={signIn} onCancelChallenge={() => { setTwoFactorChallenge(''); setTwoFactorCode(''); setLoginError('') }} online={online} />

  const title = page === 'home' ? 'Today' : page === 'inventory' ? 'Inventory' : page === 'count' ? 'Stock count' : page === 'sync' ? 'Sync & review' : 'Settings'

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="side-brand"><div className="brand-mark"><Layers3 size={19} strokeWidth={2.3} /></div><div><strong>KashFlow<span>.</span></strong><small>FIELD EDITION</small></div></div>
      <div className="workspace-switch"><div className="workspace-monogram">{vault.workspaceName.slice(0, 1).toUpperCase() || 'K'}</div><div className="workspace-info"><span>WORKING IN</span><strong title={vault.workspaceName}>{vault.workspaceName || 'Your business'}</strong></div><ChevronDown size={14} /></div>
      <div className="side-section-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Workspace pages">
        <NavButton page="home" active={page === 'home'} icon={<Home size={17} />} label="Overview" onClick={navigate} />
        <NavButton page="inventory" active={page === 'inventory'} icon={<Package size={17} />} label="Inventory" onClick={navigate} />
        <NavButton page="count" active={page === 'count'} icon={<Layers3 size={17} />} label="Stock count" onClick={navigate} />
        <NavButton page="sync" active={page === 'sync'} icon={<RefreshCw size={17} />} label="Sync & review" onClick={navigate} badge={pendingCount + conflictCount || undefined} />
      </nav>
      <div className="sidebar-grow" />
      <div className="side-status"><span className={`side-status-dot ${online ? 'connected' : ''}`} /><span>{online ? 'Connected to KashFlow' : 'Working offline'}</span><Wifi size={14} /></div>
      <button type="button" className={`nav-button ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={17} /><span>Settings</span></button>
      <div className="profile-row"><div className="profile-avatar">{vault.userEmail.slice(0, 1).toUpperCase() || 'K'}</div><div className="profile-copy"><strong>{vault.userEmail || 'KashFlow user'}</strong><span>{vault.workspaceName || 'Business workspace'}</span></div><button type="button" title="Sign out and clear device" onClick={() => void clearLocalData()} className="logout-button"><LogOut size={15} /></button></div>
      <div className="sidebar-version">SECURE OFFLINE WORKSPACE · 1.0</div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="crumb">{page !== 'home' && <button type="button" className="back-button" aria-label="Go to previous screen" title="Go back (Alt + ←)" onClick={() => window.history.back()}><ArrowLeft size={16} /></button>}<span>Workspace</span><ChevronRight size={13} /><strong>{title}</strong></div><div className="topbar-actions"><span className={`connection-chip ${online ? 'is-online' : 'is-offline'}`}>{online ? <Wifi size={13} /> : <WifiOff size={13} />}{online ? 'Online' : 'Offline'}</span><button type="button" className="toolbar-button" title="Refresh business data" onClick={() => void refreshAndNotify()} disabled={busy}>{busy ? <span className="mini-spinner" /> : <RefreshCw size={15} />}</button><button type="button" className="toolbar-profile" onClick={() => navigate('settings')} title="Account settings">{vault.userEmail.slice(0, 1).toUpperCase() || 'K'}</button></div></header>
      {!online && <div className="offline-ribbon"><CloudOff size={15} /><span>Offline mode</span><span className="offline-ribbon-copy">Counts are encrypted and saved on this computer. Live stock may have changed.</span><button type="button" onClick={() => void refreshAndNotify()}>Try again <ArrowRight size={13} /></button></div>}

      <div className="page-content">
        {page === 'home' && <Dashboard vault={vault} online={online} pending={pendingCount} conflicts={conflictCount} onNavigate={navigate} onSync={() => void syncCounts()} onRefresh={() => void refreshAndNotify()} busy={busy} />}
        {page === 'inventory' && <InventoryPage items={visibleItems} total={vault.items.length} locations={activeLocations} locationFilter={locationFilter} onLocation={setLocationFilter} query={query} onQuery={setQuery} getQty={(item) => itemTotal(item, locationFilter)} onCount={(item) => { setItemId(item.id); setCountedQuantity(''); setLocationId(''); navigate('count') }} />}
        {page === 'count' && <CountPage items={vault.items} locations={activeLocations} itemId={itemId} setItemId={setItemId} locationId={currentLocationId} setLocationId={setLocationId} quantity={countedQuantity} setQuantity={setCountedQuantity} reference={countReference} setReference={setCountReference} currentBalance={currentBalance} query={query} setQuery={setQuery} selectedItem={currentItem} online={online} busy={busy} onSave={savePhysicalCount} />}
        {page === 'sync' && <SyncPage counts={vault.counts} online={online} busy={busy} onSync={() => void syncCounts()} onRecount={startRecount} />}
        {page === 'settings' && <SettingsPage vault={vault} online={online} onClear={() => void clearLocalData()} version={appVersion} />}
      </div>
      <footer className="main-footer"><span><LockKeyhole size={12} /> Local inventory vault encrypted by this computer</span><span>KashFlow Field</span></footer>
    </main>
    {toast && <div className="toast"><span className="toast-icon"><Check size={15} /></span><span className="toast-message">{toast}</span>{toastAction.current && <button type="button" className="toast-action" onClick={() => { toastAction.current?.(); setToast(''); toastAction.current = null }}>Sync now <ArrowRight size={13} /></button>}<button type="button" aria-label="Dismiss" className="toast-dismiss" onClick={() => { setToast(''); toastAction.current = null }}>×</button></div>}
  </div>
}

function NavButton({ page, active, icon, label, onClick, badge }: { page: Page; active: boolean; icon: ReactNode; label: string; onClick: (page: Page) => void; badge?: number }) {
  return <button type="button" className={`nav-button ${active ? 'active' : ''}`} onClick={() => onClick(page)}>{icon}<span>{label}</span>{badge ? <b className="nav-badge">{badge}</b> : null}</button>
}

function Dashboard({ vault, online, pending, conflicts, onNavigate, onSync, onRefresh, busy }: { vault: DesktopVault; online: boolean; pending: number; conflicts: number; onNavigate: (page: Page) => void; onSync: () => void; onRefresh: () => void; busy: boolean }) {
  const totalUnits = vault.stock.reduce((sum, row) => sum + row.quantity, 0)
  const today = new Intl.DateTimeFormat('en-KE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi' }).format(new Date())
  const recent = vault.counts.slice(0, 4)
  return <div className="dashboard-page">
    <div className="welcome-line"><div><div className="eyebrow">YOUR FIELD DESK <span className="eyebrow-dot" /> {today.toUpperCase()}</div><h1>Welcome back<span className="heading-dot">.</span></h1><p className="page-subtitle">A clear view of what’s moving across {vault.workspaceName || 'your business'}.</p></div><button type="button" onClick={onRefresh} className="button button-outline" disabled={busy}><RefreshCw size={14} /> Refresh workspace</button></div>

    {conflicts > 0 && <button type="button" onClick={() => onNavigate('sync')} className="review-callout"><span className="review-callout-icon"><CircleAlert size={17} /></span><span><strong>{conflicts} count{conflicts === 1 ? '' : 's'} need your review</strong><small>Stock changed at the business after these counts started.</small></span><ArrowRight size={16} /></button>}

    <section className="hero-panel"><div className="hero-copy"><div className="hero-kicker"><span /> INVENTORY AT A GLANCE</div><h2>Your shelves.<br /><em>Your call.</em></h2><p>Take a count anywhere. KashFlow keeps it safe until the business connection is ready.</p><button type="button" className="hero-button" onClick={() => onNavigate('count')}>Start a stock count <ArrowUpRight size={15} /></button></div><div className="hero-illustration" aria-hidden="true"><div className="ring ring-one"/><div className="ring ring-two"/><div className="hero-box"><Layers3 size={29} /><span className="hero-box-dot" /></div><div className="floating-pill"><span /> COUNTING READY</div></div><div className="hero-side-note"><span className={`live-state-dot ${online ? 'connected' : ''}`} />{online ? 'LIVE WORKSPACE' : 'LOCAL SNAPSHOT'}<small>{online ? 'Changes checked before posting' : 'Last saved inventory'}</small></div></section>

    <div className="stats-grid">
      <StatCard label="PRODUCTS TRACKED" value={vault.items.length.toLocaleString()} detail="In your saved catalog" icon={<Package size={17} />} tone="mint" />
      <StatCard label="UNITS ON HAND" value={totalUnits.toLocaleString('en-KE', { maximumFractionDigits: 0 })} detail="Across active locations" icon={<Layers3 size={17} />} tone="slate" />
      <StatCard label="LOCATIONS" value={vault.locations.filter((location) => location.active).length.toLocaleString()} detail="Branches and stock rooms" icon={<Store size={17} />} tone="sand" />
      <StatCard label="READY TO SYNC" value={pending.toLocaleString()} detail={conflicts ? `${conflicts} also need a review` : 'Encrypted on this computer'} icon={<CloudUpload size={17} />} tone="violet" />
    </div>

    <div className="dashboard-columns"><section className="panel action-panel"><div className="panel-head"><div><span className="panel-kicker">FAST PATH</span><h3>What do you need?</h3></div><Sparkles size={16} /></div><button type="button" className="action-row" onClick={() => onNavigate('count')}><span className="action-row-icon teal"><Layers3 size={17} /></span><span><strong>Count physical stock</strong><small>Save a count, online or offline</small></span><ArrowRight size={15} /></button><button type="button" className="action-row" onClick={() => onNavigate('inventory')}><span className="action-row-icon blue"><Search size={17} /></span><span><strong>Find an item</strong><small>Search your saved catalog</small></span><ArrowRight size={15} /></button><button type="button" className="action-row" onClick={onSync}><span className="action-row-icon amber"><RefreshCw size={16} /></span><span><strong>Review activity</strong><small>Sync and resolve count changes</small></span><ArrowRight size={15} /></button></section>
      <section className="panel activity-panel"><div className="panel-head"><div><span className="panel-kicker">YOUR WORK</span><h3>Recent count activity</h3></div><button type="button" className="text-link" onClick={() => onNavigate('sync')}>See all <ArrowRight size={13} /></button></div>{recent.length ? recent.map((count) => <ActivityRow key={count.idempotencyKey} count={count} />) : <div className="quiet-empty"><div className="empty-mark"><Activity size={19} /></div><strong>Your next count starts here</strong><span>Saved counts and sync status will appear here.</span><button type="button" onClick={() => onNavigate('count')}>Start counting <ArrowRight size={13} /></button></div>}</section></div>

    <section className={`offline-card ${online ? 'online-card' : ''}`}><span className="offline-icon">{online ? <Cloud size={18} /> : <CloudOff size={18} />}</span><span className="offline-card-copy"><strong>{online ? 'Your workspace is within reach' : 'The network can wait.'}</strong><small>{online ? `${vault.refreshedAt ? `Last refresh ${new Date(vault.refreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'Connected.'} Sync your latest counts when ready.` : 'Count now, keep working, and sync when you’re back online.'}</small></span>{pending > 0 ? <button type="button" className="offline-card-button" onClick={onSync} disabled={!online || busy}>{busy ? 'Syncing…' : online ? `Sync ${pending} count${pending === 1 ? '' : 's'}` : `${pending} saved`}{online && <ArrowRight size={13} />}</button> : <span className="quiet-sync">{online ? <><CheckCircle2 size={14} /> Up to date</> : 'Available offline'}</span>}</section>
  </div>
}

function StatCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: ReactNode; tone: string }) {
  return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div></article>
}

function ActivityRow({ count }: { count: Count }) {
  const stateLabel = count.state === 'synced' ? 'SYNCED' : count.state === 'conflict' ? 'REVIEW' : count.state === 'superseded' ? 'RECOUNTED' : 'PENDING'
  return <div className="activity-list-row"><span className={`activity-check ${count.state}`}><Activity size={14} /></span><span className="activity-main"><strong>{count.itemName}</strong><small>{count.locationName} · {new Date(count.createdAt).toLocaleDateString()}</small></span><span className="activity-quantity">{compactQty(count.countedQuantity)}</span><span className={`state-label ${count.state}`}>{stateLabel}</span></div>
}

function InventoryPage({ items, total, locations, locationFilter, onLocation, query, onQuery, getQty, onCount }: { items: Item[]; total: number; locations: DesktopVault['locations']; locationFilter: string; onLocation: (id: string) => void; query: string; onQuery: (value: string) => void; getQty: (item: Item) => number; onCount: (item: Item) => void }) {
  return <div className="detail-page"><PageTitle eyebrow="PRODUCTS & STOCK" title="Inventory" sub="Find any item and see the last known quantity at each location." />
    <div className="inventory-toolbar"><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search name, SKU or category" /><kbd>⌘ K</kbd></label><div className="location-select"><Store size={14} /><select value={locationFilter} onChange={(event) => onLocation(event.target.value)}><option value="all">All locations</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select><ChevronDown size={14} /></div></div>
    <div className="inventory-meta"><span>{items.length} of {total} products</span><span className="saved-meta"><span /> Saved {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on this device</span></div>
    <div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU / CATEGORY</th><th>LAST KNOWN STOCK</th><th>UNIT</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><span className="table-product"><span className="product-avatar">{item.name.slice(0, 1).toUpperCase()}</span><strong>{item.name}</strong></span></td><td><span className="table-secondary">{item.sku || item.category || '—'}</span></td><td><span className={`table-qty ${getQty(item) <= 0 ? 'low' : ''}`}>{compactQty(getQty(item))}</span></td><td><span className="table-secondary">{item.unit || 'units'}</span></td><td><button type="button" className="table-count" onClick={() => onCount(item)}>Count <ArrowUpRight size={13} /></button></td></tr>)}</tbody></table>{items.length === 0 && <EmptyState icon={<Search size={19} />} title={total ? 'No matching products' : 'No saved products yet'} detail={total ? 'Try another product name or SKU.' : 'Connect to KashFlow to download your inventory.'} />}</div>
  </div>
}

function CountPage({ items, locations, itemId, setItemId, locationId, setLocationId, quantity, setQuantity, reference, setReference, currentBalance, query, setQuery, selectedItem, online, busy, onSave }: { items: Item[]; locations: DesktopVault['locations']; itemId: string; setItemId: (id: string) => void; locationId: string; setLocationId: (id: string) => void; quantity: string; setQuantity: (value: string) => void; reference: string; setReference: (value: string) => void; currentBalance: number; query: string; setQuery: (value: string) => void; selectedItem: Item | undefined; online: boolean; busy: boolean; onSave: (event: FormEvent) => void }) {
  const filtered = items.filter((item) => !query || [item.name, item.sku, item.category].some((text) => text.toLowerCase().includes(query.toLowerCase()))).slice(0, 5)
  return <div className="detail-page count-detail"><PageTitle eyebrow="COUNT SESSION" title="Count what’s there." sub="Your count saves to this computer first. Live stock is checked before the adjustment posts." />
    <div className="count-layout"><form className="count-form-card" onSubmit={onSave}><div className="count-steps"><span className="step-active"><b>01</b> PRODUCT</span><i /><span className={itemId ? 'step-active' : ''}><b>02</b> LOCATION</span><i /><span className={quantity ? 'step-active' : ''}><b>03</b> COUNT</span></div>
      <label className="form-label">PRODUCT</label>{selectedItem ? <div className="selected-product"><span className="product-avatar large">{selectedItem.name.slice(0, 1).toUpperCase()}</span><span><strong>{selectedItem.name}</strong><small>{selectedItem.sku ? `SKU ${selectedItem.sku}` : selectedItem.category || 'Inventory item'}</small></span><button type="button" onClick={() => { setItemId(''); setQuery('') }}>Change</button></div> : <><div className="search-box product-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved inventory" /></div><div className="product-picks">{filtered.slice(0, query ? 5 : 3).map((item) => <button type="button" key={item.id} onClick={() => { setItemId(item.id); setQuery(item.name) }}><span className="product-avatar">{item.name.slice(0, 1).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.sku || item.category || 'Product'}</small></span><ChevronRight size={14} /></button>)}{!filtered.length && <p>No matching item in this saved catalog.</p>}</div></>}
      {itemId && <><label className="form-label form-label-gap">LOCATION</label><div className="location-pills">{locations.map((location) => <button type="button" key={location.id} onClick={() => setLocationId(location.id)} className={location.id === locationId ? 'selected' : ''}><Store size={13} />{location.name}</button>)}</div>
        <div className="quantity-heading"><div><label className="form-label">PHYSICAL QUANTITY</label><small>Count the units you can see and touch.</small></div><span className="baseline-pill">BASELINE <b>{compactQty(currentBalance)}</b></span></div><div className="count-input-wrap"><button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(String(Math.max(0, (Number(quantity) || 0) - 1)))}><Minus size={17} /></button><input value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))} placeholder="0" inputMode="decimal" /><button type="button" aria-label="Increase quantity" onClick={() => setQuantity(String((Number(quantity) || 0) + 1))}><Plus size={17} /></button></div>
        <label className="form-label form-label-gap">NOTE <span>(OPTIONAL)</span></label><input className="text-input" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={200} placeholder="Morning shelf check" />
        <div className="baseline-note"><CircleAlert size={15} /><span>Stock is compared with this saved baseline when you sync. If it changed, KashFlow asks you to recount before posting.</span></div>
        <button type="submit" disabled={busy || !quantity || !Number.isFinite(Number(quantity)) || Number(quantity) < 0} className="button button-primary save-count-button">{busy ? <><span className="mini-spinner white" /> Saving securely…</> : online ? 'Save count & sync' : 'Save count offline'}<ArrowRight size={15} /></button>
      </>}
    </form>
    <aside className="count-aside"><div className="aside-illustration"><div className="aisle aisle-one"/><div className="aisle aisle-two"/><div className="aisle aisle-three"/><div className="count-orbit"><Layers3 size={26} /></div></div><div className="aside-copy"><span className="panel-kicker">COUNT WITH CARE</span><h3>More certainty.<br />Less second guessing.</h3><p>Counts are saved to an encrypted local vault. When you reconnect, KashFlow checks each one against the latest movement history before changing your stock.</p></div><div className="aside-points"><span><CheckCircle2 size={14} /> Works without a signal</span><span><ShieldCheck size={14} /> Safe to retry after interruption</span><span><Activity size={14} /> Change review before posting</span></div></aside></div>
  </div>
}

function SyncPage({ counts, online, busy, onSync, onRecount }: { counts: Count[]; online: boolean; busy: boolean; onSync: () => void; onRecount: (count: Count) => void }) {
  const pending = counts.filter((count) => count.state === 'pending').length
  const conflicts = counts.filter((count) => count.state === 'conflict').length
  return <div className="detail-page"><PageTitle eyebrow="LOCAL ACTIVITY" title="Sync & review" sub="Each saved count is checked against the live stock balance before it posts." />
    <div className="sync-summary"><div><span>WAITING</span><strong className={pending ? 'pending' : ''}>{pending}</strong></div><div><span>NEEDS REVIEW</span><strong className={conflicts ? 'conflict' : ''}>{conflicts}</strong></div><div><span>SYNCED</span><strong>{counts.filter((count) => count.state === 'synced').length}</strong></div><button className="button button-primary" onClick={onSync} disabled={!online || busy || pending === 0}>{busy ? <><span className="mini-spinner white" /> Syncing</> : <><RefreshCw size={14} /> Sync pending</>}</button></div>
    {!online && pending > 0 && <div className="sync-offline-note"><CloudOff size={16} /><span>These counts stay encrypted on this computer until the business API is reachable again.</span></div>}
    <div className="sync-list">{counts.length ? counts.map((count) => <article key={count.idempotencyKey} className={`sync-item ${count.state}`}><span className={`sync-item-icon ${count.state}`}>{count.state === 'synced' || count.state === 'superseded' ? <Check size={17} /> : count.state === 'conflict' ? <CircleAlert size={17} /> : <RefreshCw size={16} />}</span><div className="sync-item-main"><div className="sync-item-head"><strong>{count.itemName}</strong><span className={`state-label ${count.state}`}>{count.state === 'synced' ? 'SYNCED' : count.state === 'conflict' ? 'REVIEW REQUIRED' : count.state === 'superseded' ? 'RECOUNTED' : 'PENDING'}</span></div><small>{count.locationName} · {new Date(count.createdAt).toLocaleString()}</small><div className="sync-quantities"><span>Counted <b>{compactQty(count.countedQuantity)}</b></span><span>Baseline <b>{compactQty(count.expectedQuantity)}</b></span>{count.serverQuantity !== null && <span>Current <b>{compactQty(count.serverQuantity)}</b></span>}</div>{count.state === 'conflict' && <><p className="conflict-detail">{count.message || 'Stock changed after this count began.'} Check the shelf again before replacing this count.</p><button type="button" disabled={!online} className="recount-button" onClick={() => onRecount(count)}><RefreshCw size={13} /> Recount this location</button></>}{count.state === 'pending' && <p className="pending-detail">{online ? 'Ready to sync. The server will check this baseline first.' : 'Waiting for a connection. Safe to retry when back online.'}</p>}{count.state === 'superseded' && <p className="synced-detail">The newer physical count is queued for sync.</p>}</div></article>) : <EmptyState icon={<CloudUpload size={20} />} title="Nothing waiting here" detail="Counts from your field sessions will appear in this activity list." />}</div>
  </div>
}

function SettingsPage({ vault, online, onClear, version }: { vault: DesktopVault; online: boolean; onClear: () => void; version: string }) {
  return <div className="detail-page"><PageTitle eyebrow="DEVICE & ACCOUNT" title="Settings" sub="Your workspace and offline storage on this computer." />
    <section className="settings-card"><div className="settings-avatar">{vault.workspaceName.slice(0, 1).toUpperCase() || 'K'}</div><div className="settings-info"><span>ACTIVE BUSINESS</span><strong>{vault.workspaceName || 'Your business'}</strong><small>{vault.userEmail}</small></div><span className={`connection-chip ${online ? 'is-online' : 'is-offline'}`}>{online ? <Wifi size={13} /> : <WifiOff size={13} />}{online ? 'Connected' : 'Offline'}</span></section>
    <section className="settings-section"><div className="settings-section-head"><div><span className="panel-kicker">OFFLINE CAPABILITIES</span><h3>Available on this device</h3></div><span className="settings-badge">3 READY</span></div><SettingsRow icon={<CheckCircle2 size={16} />} title="Physical inventory counts" detail="Create count sessions with the latest saved catalog and location balances." good /><SettingsRow icon={<CheckCircle2 size={16} />} title="Durable pending sync" detail="Count activity survives app restarts and is encrypted by the operating system." good /><SettingsRow icon={<CheckCircle2 size={16} />} title="Conflict review" detail="Stock changes on another device stop the automatic adjustment and ask for a fresh count." good /></section>
    <section className="settings-section"><div className="settings-section-head"><div><span className="panel-kicker">ONLINE SERVICES</span><h3>Resume with a connection</h3></div></div><SettingsRow icon={<Cloud size={16} />} title="M-Pesa, eTIMS and bank feeds" detail="These provider services pause offline and resume when connected." /><SettingsRow icon={<Cloud size={16} />} title="Live catalog and business updates" detail="Inventory reflects this computer’s last saved snapshot until it refreshes." /></section>
    <section className="device-security"><div className="device-security-icon"><LockKeyhole size={18} /></div><div><strong>Protected by this computer</strong><p>The local vault uses OS-backed encryption. KashFlow refuses to save business data in plain text if secure storage is unavailable.</p><small>Last catalog refresh · {vault.refreshedAt ? new Date(vault.refreshedAt).toLocaleString() : 'not yet synced'} · v{version}</small></div></section>
    <button type="button" className="clear-device" onClick={onClear}><LogOut size={15} /> Sign out and clear this computer</button>
  </div>
}

function SettingsRow({ icon, title, detail, good = false }: { icon: ReactNode; title: string; detail: string; good?: boolean }) {
  return <div className="settings-row"><span className={`settings-row-icon ${good ? 'good' : ''}`}>{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={14} /></div>
}

function PageTitle({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return <div className="page-title"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{sub}</p></div>
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="empty-state"><span>{icon}</span><strong>{title}</strong><p>{detail}</p></div>
}

function LoginPage({ identifier, setIdentifier, password, setPassword, challenge, code, setCode, error, busy, onSubmit, onCancelChallenge, online }: { identifier: string; setIdentifier: (value: string) => void; password: string; setPassword: (value: string) => void; challenge: string; code: string; setCode: (value: string) => void; error: string; busy: boolean; onSubmit: (event: FormEvent) => void; onCancelChallenge: () => void; online: boolean }) {
  return <main className="login-shell"><div className="login-brand"><span className="brand-mark"><Layers3 size={19} /></span><span><strong>KashFlow<span>.</span></strong><small>FIELD EDITION</small></span></div><div className="login-grid"><section className="login-story"><div className="story-kicker"><span /> BUILT FOR THE SHOP FLOOR</div><h1>Count with<br /><em>confidence.</em></h1><p>Your business, one tap away. Keep stock moving even when the network doesn’t.</p><div className="story-art"><div className="story-orbit story-orbit-one" /><div className="story-orbit story-orbit-two" /><div className="story-cube"><Layers3 size={32} /></div><div className="story-tag"><CheckCircle2 size={14} /> FIELD READY</div><div className="story-tag second"><LockKeyhole size={13} /> ENCRYPTED</div></div><div className="story-bottom"><span>01</span> OFFLINE INVENTORY <i /> KENYA FIRST</div></section><section className="login-card"><span className="login-eyebrow">WELCOME BACK</span><h2>{challenge ? 'Verify it’s you' : 'Sign in to KashFlow'}</h2><p>{challenge ? 'Use your authenticator app or a recovery code to continue.' : 'Your saved stock and counts stay on this computer when you’re offline.'}</p><form onSubmit={onSubmit}>{!challenge ? <><label>Email or phone number<input autoComplete="username" autoCapitalize="none" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="you@business.co.ke" required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" required /></label></> : <label>Authenticator or recovery code<input autoCapitalize="characters" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Enter your code" required /></label>}{error && <div className="login-error">{error}</div>}<button className="button button-primary login-submit" disabled={busy}>{busy ? <><span className="mini-spinner white" /> Please wait…</> : <>{challenge ? 'Verify & continue' : 'Continue to your business'} <ArrowRight size={15} /></>}</button></form>{challenge && <button type="button" onClick={onCancelChallenge} className="cancel-challenge">Use a different account</button>}<div className="login-security"><ShieldCheck size={16} /><span>OS-encrypted local vault · Secure sign-in · Offline ready</span></div><div className="login-connect"><span className={`side-status-dot ${online ? 'connected' : ''}`} />{online ? 'KashFlow service is reachable' : 'Connect to sign in; saved workspace data remains available offline'}</div></section></div><footer className="login-footer"><span><LockKeyhole size={12} /> Secure offline workspace</span><span>KashFlow Field · Desktop</span></footer></main>
}
