import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, RefreshCw } from 'lucide-react'

// This is the functional Reports replica of the landing page "Today's performance" card.
// Unlike the marketing card, every figure here is computed from recorded ledger activity,
// so the percentage change genuinely compares today with yesterday.
type DailyPerformance = {
  from: string
  to: string
  previousFrom: string
  previousTo: string
  today: string
  yesterday: string
  todayIncome: string
  todayExpense: string
  yesterdayIncome: string
  yesterdayExpense: string
  todayNet: string
  percentChange: number | null
  weekIncome: string
  stockValue: string
  days: Array<{ date: string; income: string; expense: string }>
}

function money(value: string | number) {
  const amount = Number(value)
  return `KSh ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function compactMoney(value: string | number) {
  const amount = Number(value)
  if (Math.abs(amount) >= 1_000_000) return `KSh ${(amount / 1_000_000).toFixed(1)}M`
  if (Math.abs(amount) >= 1_000) return `KSh ${(amount / 1_000).toFixed(0)}K`
  return money(amount)
}

function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-KE', { weekday: 'short' })
}

export function DailyPerformanceReport({ apiBase, search }: { apiBase: string; search?: string }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
  const [range, setRange] = useState<'today' | 'last_7' | 'last_30' | 'mtd' | 'ytd' | 'custom'>('today')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [data, setData] = useState<DailyPerformance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Resolve the selected preset into concrete dates so any range, including custom, uses the
  // same request path and the comparison baseline stays correct.
  const resolved = useMemo(() => {
    const shift = (days: number) => {
      const base = new Date(`${today}T00:00:00Z`)
      base.setUTCDate(base.getUTCDate() + days)
      return base.toISOString().slice(0, 10)
    }
    if (range === 'today') return { from: today, to: today }
    if (range === 'last_7') return { from: shift(-6), to: today }
    if (range === 'last_30') return { from: shift(-29), to: today }
    if (range === 'mtd') return { from: `${today.slice(0, 7)}-01`, to: today }
    if (range === 'ytd') return { from: `${today.slice(0, 4)}-01-01`, to: today }
    return { from, to }
  }, [range, from, to, today])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const query = new URLSearchParams(resolved)
      const response = await fetch(`${apiBase}/v1/reports/daily-performance?${query}`, { credentials: 'include' })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || `Could not load performance (${response.status}).`)
      }
      setData(await response.json() as DailyPerformance)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load performance.')
    } finally {
      setLoading(false)
    }
  }, [apiBase, resolved])

  useEffect(() => { void load() }, [load])

  if (loading) return <article className="module-card"><h2>Today&apos;s performance</h2><p className="dialog-note">Loading recorded figures…</p></article>
  if (error) return <article className="module-card"><h2>Today&apos;s performance</h2><p className="form-error" role="alert">{error}</p><button type="button" className="button button-secondary" onClick={() => void load()}>Try again</button></article>
  if (!data) return null

  const trend = data.percentChange
  const trendTone = trend === null ? 'flat' : trend >= 0 ? 'up' : 'down'
  // One scale for both series so income and expenses are directly comparable.
  const peak = Math.max(1, ...data.days.flatMap((day) => [Number(day.income), Number(day.expense)]))

  return <article className="module-card">
    <div className="panel-header">
      <div>
        <h2>Performance and cash flow</h2>
        <p>Recorded income and expenses for {data.from} to {data.to}, compared with the equal-length period before it ({data.previousFrom} to {data.previousTo}).</p>
      </div>
      <button type="button" className="button button-small" disabled={loading} onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
    </div>
    <div className="overview-period-toolbar">
      <label className="field-label">Period
        <select value={range} onChange={(event) => setRange(event.target.value as typeof range)}>
          <option value="today">Today</option>
          <option value="last_7">Last 7 days</option>
          <option value="last_30">Last 30 days</option>
          <option value="mtd">Month to date</option>
          <option value="ytd">Year to date</option>
          <option value="custom">Custom dates</option>
        </select>
      </label>
      {range === 'custom' && <>
        <label className="field-label">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field-label">To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
      </>}
      <span className="overview-period-caption">{data.from} – {data.to}</span>
    </div>
    <div className="chart-legend"><span><i className="legend-income" /> Income</span><span><i className="legend-expense" /> Expenses</span></div>
    <div className="report-performance">
      <div className="report-performance-stat">
        <small>Income · selected period</small>
        <strong>{money(data.todayIncome)}</strong>
        <span className={`report-trend report-trend-${trendTone}`}>
          {trendTone === 'up' && <ArrowUpRight size={13} />}
          {trendTone === 'down' && <ArrowDownRight size={13} />}
          {trend === null ? 'No income in the previous period to compare' : `${trend}% vs previous period`}
        </span>
        <p className="dialog-note">
          Expenses {money(data.todayExpense)} · net {money(data.todayNet)}<br />
          Previous period: income {money(data.yesterdayIncome)} · expenses {money(data.yesterdayExpense)}
        </p>
      </div>
      <div className="report-performance-bars" role="img" aria-label={`Recorded income and expenses from ${data.from} to ${data.to}`}>
        {data.days.length ? data.days.map((day) => {
          const income = Number(day.income)
          const expense = Number(day.expense)
          const incomeHeight = Math.max(2, Math.round((income / peak) * 100))
          const expenseHeight = Math.max(2, Math.round((expense / peak) * 100))
          return <div key={day.date} title={`${day.date}: income ${money(income)} · expenses ${money(expense)}`}>
            <i className="is-income" style={{ height: `${incomeHeight}%` }} />
            <i className="is-expense" style={{ height: `${expenseHeight}%` }} />
            <span>{shortDate(day.date)}</span>
          </div>
        }) : <p className="dialog-note">Nothing recorded in this period.</p>}
      </div>
    </div>
    <div className="transaction-row"><span>Income in the selected period</span><strong>{money(data.todayIncome)}</strong></div>
    <div className="transaction-row"><span>Expenses in the selected period</span><strong>{money(data.todayExpense)}</strong></div>
    <div className="transaction-row"><span>Net for the selected period</span><strong>{money(data.todayNet)}</strong></div>
    <div className="transaction-row"><span>Stock value at recorded unit cost</span><strong>{compactMoney(data.stockValue)}</strong></div>
    <p className="dialog-note">Values come from recorded transactions and posted invoices; they are management figures, not audited statements.</p>
    {search && <p className="dialog-note">Filtered by “{search}”.</p>}
  </article>
}
