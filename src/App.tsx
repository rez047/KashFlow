import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Bell, BookOpen,
  BriefcaseBusiness, Building2, CalendarDays, Check, ChevronRight, CircleHelp,
  FileText, Filter, Gauge, Landmark, LayoutDashboard,
  LifeBuoy, LogOut, Menu, MoreHorizontal, Package, Plus, Search, Settings2,
  ShieldCheck, ShoppingBag, Users, Wallet, X,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import './App.css'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
function nairobiDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}
const today = nairobiDate()
const groups = [
  { title: 'WORKSPACE', items: [['Overview', LayoutDashboard], ['Banking', Landmark], ['Sales', ArrowUpRight], ['Expenses', ArrowDownLeft], ['Payroll', Users]] },
  { title: 'MANAGE', items: [['Customers', Users], ['Suppliers', ShoppingBag], ['Inventory', Package], ['Projects', BriefcaseBusiness], ['Accounting', BookOpen]] },
  { title: 'INSIGHTS & COMPLIANCE', items: [['Reports', Activity], ['Kenya compliance', ShieldCheck], ['Documents', FileText]] },
] as const
const descriptions: Record<string, string> = {
  Banking: 'Bank feeds are not configured. Manually entered records remain available in the workspace ledger.',
  Sales: 'Create and track internal invoices saved in your workspace.',
  Expenses: 'Record and review expenses entered in your workspace.',
  Payroll: 'Payroll records and statutory calculations are not configured.',
  Customers: 'Customer details are recorded as part of invoices.',
  Suppliers: 'Supplier management has not been configured yet.',
  Inventory: 'Inventory management has not been configured yet.',
  Projects: 'Project tracking has not been configured yet.',
  Accounting: 'Double-entry accounting and financial statements are not implemented yet.',
  Reports: 'Overview values are calculated from the records saved in this workspace.',
  'Kenya compliance': 'Government and statutory integrations are inactive. Confirm current filing requirements with approved providers and qualified advisers.',
  Documents: 'Document storage is not configured yet.',
}

type Transaction = {
  id: string; description: string; amount: string; direction: 'income' | 'expense'; account: string; transaction_date: string
}
type Dashboard = {
  workspaceName: string
  totals: { monthIncome: string; monthExpenses: string; monthNet: string }
  transactions: Transaction[]
  cashflow: Array<{ date: string; income: string; expense: string }>
  invoices: { count: number; unpaid_amount: string }
}
type Account = { user: { email: string }; workspace: { id: string; name: string } }
type Modal = 'invoice' | 'transaction' | null

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || `Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function money(value: string | number) {
  const amount = Number(value)
  return `KSh ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Brand() {
  return <div className="brand-row">
    <div className="brand-mark">K</div>
    <div className="brand-name">Kash<span>Flow</span><small>BUSINESS SUITE</small></div>
  </div>
}

function App() {
  const [page, setPage] = useState('Overview')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [toast, setToast] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [account, setAccount] = useState<Account | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false)
  const [starting, setStarting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [credentials, setCredentials] = useState({ email: '', password: '', businessName: '' })
  const [transaction, setTransaction] = useState({ description: '', amount: '', direction: 'expense', account: '', date: today })
  const [invoice, setInvoice] = useState({ customer: '', description: '', amount: '', dueDate: '' })

  const refresh = useCallback(async () => setDashboard(await request<Dashboard>('/v1/dashboard')), [])

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const status = await request<{ bootstrapAvailable: boolean }>('/v1/auth/status')
        if (!active) return
        setBootstrapAvailable(status.bootstrapAvailable)
        try {
          const signedIn = await request<Account>('/v1/auth/me')
          if (!active) return
          setAccount(signedIn)
          const data = await request<Dashboard>('/v1/dashboard')
          if (active) setDashboard(data)
        } catch (authError) {
          if (authError instanceof TypeError) throw authError
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error && !(reason instanceof TypeError) ? reason.message : `Could not reach the KashFlow API at ${API_BASE}. Check the API deployment and VITE_API_BASE_URL.`)
      } finally {
        if (active) setStarting(false)
      }
    }
    void initialize()
    return () => { active = false }
  }, [])

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3000)
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const route = bootstrapAvailable ? '/v1/auth/bootstrap' : '/v1/auth/login'
      const body = bootstrapAvailable ? credentials : { email: credentials.email, password: credentials.password }
      const signedIn = await request<Account>(route, { method: 'POST', body: JSON.stringify(body) })
      setAccount(signedIn); setBootstrapAvailable(false); await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign in.')
    } finally { setBusy(false) }
  }

  async function logout() {
    try { await request('/v1/auth/logout', { method: 'POST' }) } catch { /* Discard an expired local session. */ }
    setAccount(null); setDashboard(null); setPage('Overview')
  }

  async function saveTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request('/v1/transactions', { method: 'POST', body: JSON.stringify({ ...transaction, amount: Number(transaction.amount) }) })
      setModal(null); setTransaction({ description: '', amount: '', direction: 'expense', account: '', date: today })
      await refresh(); notify('Transaction saved to this workspace')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save transaction.')
    } finally { setBusy(false) }
  }

  async function saveInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request('/v1/invoices', { method: 'POST', body: JSON.stringify({ ...invoice, amount: Number(invoice.amount) }) })
      setModal(null); setInvoice({ customer: '', description: '', amount: '', dueDate: '' })
      await refresh(); notify('Invoice saved to this workspace')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save invoice.')
    } finally { setBusy(false) }
  }

  const filtered = useMemo(() => (dashboard?.transactions ?? []).filter((row) =>
    `${row.description} ${row.account} ${row.direction}`.toLowerCase().includes(search.toLowerCase())), [dashboard, search])
  const chart = useMemo(() => (dashboard?.cashflow ?? []).map((row) => ({
    date: new Date(`${row.date}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }),
    income: Number(row.income), expense: Number(row.expense),
  })), [dashboard])

  if (starting) return <div className="auth-screen"><div className="auth-card"><Brand /><p>Connecting securely to your workspace…</p></div></div>

  if (!account) return <div className="auth-screen">
    <form className="auth-card" onSubmit={submitAuth}>
      <Brand />
      <p className="auth-intro">{bootstrapAvailable ? 'Create the first workspace account.' : 'Sign in to your business workspace.'}</p>
      {bootstrapAvailable && <label className="field-label">Business name
        <input required maxLength={120} value={credentials.businessName} onChange={(event) => setCredentials({ ...credentials, businessName: event.target.value })} />
      </label>}
      <label className="field-label">Admin email
        <input type="email" required autoComplete="username" value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} />
      </label>
      <label className="field-label">Password
        <input type="password" required minLength={bootstrapAvailable ? 12 : 1} autoComplete={bootstrapAvailable ? 'new-password' : 'current-password'} value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} />
        {bootstrapAvailable && <small>Use at least 12 characters.</small>}
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : bootstrapAvailable ? 'Create workspace' : 'Sign in'}</button>
      <p className="auth-note">Your records are stored in your connected database. No external provider connections are enabled.</p>
    </form>
  </div>

  const metricCards = [
    { title: 'Income this month', value: dashboard?.totals.monthIncome ?? '0', Icon: ArrowDownLeft, tone: 'purple-icon' },
    { title: 'Expenses this month', value: dashboard?.totals.monthExpenses ?? '0', Icon: ArrowUpRight, tone: 'peach-icon' },
    { title: 'Net movement', value: dashboard?.totals.monthNet ?? '0', Icon: Gauge, tone: 'blue-icon' },
    { title: 'Unpaid invoices', value: dashboard?.invoices.unpaid_amount ?? '0', Icon: Wallet, tone: 'mint-icon' },
  ]

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="brand-row"><div className="brand-mark">K</div><div className="brand-name">Kash<span>Flow</span><small>BUSINESS SUITE</small></div>
        <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={18} /></button>
      </div>
      <div className="company-switcher"><span className="company-avatar">{dashboard?.workspaceName.slice(0, 1).toUpperCase()}</span>
        <span className="company-copy"><strong>{dashboard?.workspaceName}</strong><small>Private workspace</small></span>
      </div>
      <nav className="side-nav" aria-label="Main navigation">
        {groups.map((group) => <div className="nav-group" key={group.title}><p className="nav-heading">{group.title}</p>
          {group.items.map(([name, Icon]) => <button key={name} className={`nav-link ${page === name ? 'active' : ''}`} onClick={() => { setPage(name); setSidebarOpen(false) }}>
            <Icon size={18} strokeWidth={1.8} /><span>{name}</span>
          </button>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="help-card"><div className="help-icon"><ShieldCheck size={16} /></div><strong>Private workspace</strong><p>Records you enter are saved to your account database.</p></div>
        <button className="nav-link bottom-link" onClick={() => notify('Workspace settings are not implemented yet')}><Settings2 size={18} /> Settings</button>
        <button className="nav-link bottom-link" onClick={() => notify('Help centre is not configured yet')}><LifeBuoy size={18} /> Help & support</button>
        <div className="profile-row"><div className="profile-avatar">{account.user.email.slice(0, 1).toUpperCase()}</div>
          <div className="profile-copy"><strong>{account.user.email}</strong><small>Workspace admin</small></div>
          <button className="icon-button" onClick={() => void logout()} aria-label="Sign out"><LogOut size={16} /></button>
        </div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
        <div className="breadcrumbs"><span>{dashboard?.workspaceName}</span><ChevronRight size={14} /><strong>{page}</strong><span className="demo-tag">SAVED WORKSPACE DATA</span></div>
        <div className="topbar-actions">
          <label className="search-box"><Search size={16} /><input aria-label="Search saved transactions" placeholder="Search your records..." value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
          <button className="icon-button notification-button" aria-label="Workspace status" onClick={() => setStatusOpen((open) => !open)}><Bell size={18} /></button>
          <button className="top-help" onClick={() => notify('Help centre is not configured yet')}><CircleHelp size={17} /><span>Help</span></button>
        </div>
        {statusOpen && <div className="notification-popover"><strong>No external services connected</strong><p>Saved records are available in this workspace. Bank, payment, and government integrations still require approved providers.</p><button onClick={() => setStatusOpen(false)}>Close</button></div>}
      </header>

      <div className="content-wrap">
        {page === 'Overview' ? <>
          <section className="welcome-row"><div><div className="eyebrow"><span className="live-dot" /> PRIVATE WORKSPACE</div>
            <h1>{dashboard?.workspaceName}</h1><p className="welcome-subtitle">Your saved records for this month.</p>
          </div><div className="welcome-actions">
            <button className="button button-secondary" onClick={() => { setError(''); setModal('transaction') }}><Plus size={16} /> Add transaction</button>
            <button className="button button-primary" onClick={() => { setError(''); setModal('invoice') }}><Plus size={17} /> Create invoice</button>
          </div></section>

          <section className="metric-grid" aria-label="Saved business totals">
            {metricCards.map(({ title, value, Icon, tone }) => <article className="metric-card" key={title}>
              <div className="metric-top"><span>{title}</span><span className={`metric-icon ${tone}`}><Icon size={17} /></span></div>
              <div className="metric-value">{money(value)}</div><div className="metric-foot"><span>Calculated from saved records</span></div>
            </article>)}
          </section>

          <section className="dashboard-grid">
            <article className="panel cashflow-panel">
              <div className="panel-header"><div><h2>Recorded cash flow</h2><p>Daily income and expenses entered in this workspace</p></div>
                <span className="period-select"><CalendarDays size={14} /> This month</span>
              </div>
              <div className="chart-legend"><span><i className="legend-income" /> Income</span><span><i className="legend-expense" /> Expenses</span></div>
              {chart.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 10, right: 5, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7256df" stopOpacity={0.17} /><stop offset="100%" stopColor="#7256df" stopOpacity={0} /></linearGradient>
                    <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38b99a" stopOpacity={0.13} /><stop offset="100%" stopColor="#38b99a" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#eff0f4" strokeDasharray="4 5" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#9699a5', fontSize: 10 }} dy={9} />
                  <Tooltip formatter={(value) => [money(Number(value)), '']} contentStyle={{ border: '1px solid #eeedf2', borderRadius: 10, fontSize: 12 }} />
                  <Area type="monotone" dataKey="income" stroke="#7256df" strokeWidth={2.5} fill="url(#incomeFill)" />
                  <Area type="monotone" dataKey="expense" stroke="#48b99e" strokeWidth={2.5} fill="url(#expenseFill)" />
                </AreaChart>
              </ResponsiveContainer></div> : <div className="empty-chart">No transactions recorded this month. Add one to see cash flow.</div>}
              <div className="chart-footer"><span><span className="status-dot" /> Database-backed records</span><button onClick={() => setPage('Reports')}>View reports <ArrowRight size={14} /></button></div>
            </article>

            <article className="panel compliance-panel">
              <div className="panel-header"><div><h2>Integrations</h2><p>External services are not connected</p></div>
                <button className="icon-button more-button" aria-label="Integration status" onClick={() => setStatusOpen(true)}><MoreHorizontal size={19} /></button>
              </div>
              <div className="integration-notice"><ShieldCheck size={19} /><div><strong>Setup required</strong><p>KRA/eTIMS, M-Pesa, bank feeds, and statutory filing are inactive. Connect approved providers before relying on sync or submissions.</p></div></div>
              <div className="compliance-list">
                {[
                  ['KRA eTIMS', 'Provider adapter not configured'],
                  ['Safaricom Daraja / M-Pesa', 'Credentials and callbacks not configured'],
                  ['Bank feeds', 'Provider not selected'],
                  ['PAYE · SHIF · NSSF · AHL', 'Calculations and filing routes not implemented'],
                ].map(([name, detail]) => <div className="integration-row" key={name}>
                  <span className="compliance-icon blue"><Building2 size={16} /></span><span className="compliance-copy"><strong>{name}</strong><small>{detail}</small></span><span className="status-pill amber">Inactive</span>
                </div>)}
              </div>
            </article>
          </section>

          <section className="bottom-grid">
            <article className="panel transactions-panel">
              <div className="panel-header"><div><h2>Saved transactions</h2><p>{dashboard?.transactions.length ?? 0} recent records</p></div>
                <button className="button button-small" onClick={() => { setError(''); setModal('transaction') }}><Plus size={14} /> Add transaction</button>
              </div>
              <div className="table-tools"><span>{search ? `Results for “${search}”` : 'Records from your workspace database'}</span><button onClick={() => setSearch('')}><Filter size={14} /> Clear search</button></div>
              <div className="transaction-table"><div className="table-head"><span>DESCRIPTION</span><span>DATE</span><span>AMOUNT</span><span>TYPE</span></div>
                {filtered.map((item) => <div className="transaction-row" key={item.id}>
                  <div className="transaction-name"><span className={`merchant-avatar ${item.direction === 'income' ? 'mint' : 'peach'}`}>{item.direction === 'income' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span>
                    <span><strong>{item.description}</strong><small>{item.account}</small></span></div>
                  <span className="transaction-date">{item.transaction_date}</span>
                  <strong className={`transaction-amount ${item.direction === 'income' ? 'amount-in' : ''}`}>{item.direction === 'income' ? '+' : '−'} {money(item.amount)}</strong>
                  <span className="transaction-status">{item.direction}</span>
                </div>)}
                {filtered.length === 0 && <div className="empty-state">{search ? 'No saved transactions match your search.' : 'No transactions yet. Add an income or expense record to get started.'}</div>}
              </div>
            </article>
            <article className="panel tasks-panel"><div className="panel-header"><div><h2>Invoices</h2><p>Totals from saved records</p></div><span className="task-count">{dashboard?.invoices.count ?? 0}</span></div>
              <div className="invoice-summary"><span>Unpaid invoice value</span><strong>{money(dashboard?.invoices.unpaid_amount ?? '0')}</strong><p>{dashboard?.invoices.count ?? 0} total invoices recorded</p></div>
              <button className="task-footer" onClick={() => { setError(''); setModal('invoice') }}>Create invoice <ArrowRight size={14} /></button>
            </article>
          </section>
          <footer className="page-footer"><span>© 2026 KashFlow Technologies</span><span><i className="secure-dot" /> Private workspace</span><button onClick={() => void logout()}>Sign out</button></footer>
        </> : <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> WORKSPACE</div><h1>{page}</h1><p className="welcome-subtitle">{descriptions[page] ?? 'This module is not configured yet.'}</p>
          <div className="module-card"><div className="module-icon"><ShieldCheck size={23} /></div>
            <h2>{page === 'Kenya compliance' ? 'Integrations are inactive' : `${page} is not implemented yet`}</h2>
            <p>{page === 'Kenya compliance' ? 'No KRA/eTIMS, bank, M-Pesa, or statutory filing provider is connected. Saved manual records remain available in your workspace.' : 'This area does not yet have live functionality. Use the overview to add a transaction or invoice to your workspace database.'}</p>
            <div className="module-actions"><button className="button button-secondary" onClick={() => setPage('Overview')}>Back to overview</button></div>
          </div>
          <div className="module-footnote"><ShieldCheck size={16} /> Only records you or an authorized integration save to this workspace are displayed.</div>
        </section>}
      </div>
    </main>

    {modal && <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !busy) setModal(null) }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-head"><div><div className="eyebrow">{dashboard?.workspaceName}</div><h2 id="dialog-title">{modal === 'invoice' ? 'Create an invoice' : 'Add a transaction'}</h2></div>
          <button className="icon-button" aria-label="Close dialog" onClick={() => setModal(null)}><X size={19} /></button>
        </div>
        {modal === 'invoice' ? <form onSubmit={saveInvoice}>
          <label className="field-label">Customer<input required maxLength={160} value={invoice.customer} onChange={(event) => setInvoice({ ...invoice, customer: event.target.value })} /></label>
          <label className="field-label">Description<input required maxLength={240} value={invoice.description} onChange={(event) => setInvoice({ ...invoice, description: event.target.value })} /></label>
          <div className="field-row"><label className="field-label">Amount (KSh)<input required min="0.01" step="0.01" type="number" value={invoice.amount} onChange={(event) => setInvoice({ ...invoice, amount: event.target.value })} /></label>
            <label className="field-label">Due date<input required type="date" value={invoice.dueDate} onChange={(event) => setInvoice({ ...invoice, dueDate: event.target.value })} /></label>
          </div>
          <p className="dialog-note"><ShieldCheck size={15} /> Internal record only. Not sent to the customer and not a KRA/eTIMS tax invoice.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save invoice'}</button></div>
        </form> : <form onSubmit={saveTransaction}>
          <label className="field-label">Description<input required maxLength={240} value={transaction.description} onChange={(event) => setTransaction({ ...transaction, description: event.target.value })} /></label>
          <div className="field-row"><label className="field-label">Amount (KSh)<input required min="0.01" step="0.01" type="number" value={transaction.amount} onChange={(event) => setTransaction({ ...transaction, amount: event.target.value })} /></label>
            <label className="field-label">Type<select value={transaction.direction} onChange={(event) => setTransaction({ ...transaction, direction: event.target.value })}><option value="expense">Expense</option><option value="income">Income</option></select></label>
          </div>
          <div className="field-row"><label className="field-label">Account<input required maxLength={80} value={transaction.account} onChange={(event) => setTransaction({ ...transaction, account: event.target.value })} /></label>
            <label className="field-label">Date<input required type="date" value={transaction.date} onChange={(event) => setTransaction({ ...transaction, date: event.target.value })} /></label>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save transaction'}</button></div>
        </form>}
      </div>
    </div>}
    {toast && <div className="toast"><span><Check size={15} /></span>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>
}

export default App
