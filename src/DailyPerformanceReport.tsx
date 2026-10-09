import { useCallback, useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, RefreshCw } from 'lucide-react'

// This is the functional Reports replica of the landing page "Today's performance" card.
// Unlike the marketing card, every figure here is computed from recorded ledger activity,
// so the percentage change genuinely compares today with yesterday.
type DailyPerformance = {
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
  const [data, setData] = useState<DailyPerformance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch(`${apiBase}/v1/reports/daily-performance`, { credentials: 'include' })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || `Could not load today's performance (${response.status}).`)
      }
      setData(await response.json() as DailyPerformance)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load today's performance.")
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { void load() }, [load])

  if (loading) return <article className="module-card"><h2>Today&apos;s performance</h2><p className="dialog-note">Loading recorded figures…</p></article>
  if (error) return <article className="module-card"><h2>Today&apos;s performance</h2><p className="form-error" role="alert">{error}</p><button type="button" className="button button-secondary" onClick={() => void load()}>Try again</button></article>
  if (!data) return null

  const trend = data.percentChange
  const trendTone = trend === null ? 'flat' : trend >= 0 ? 'up' : 'down'
  const peak = Math.max(1, ...data.days.map((day) => Number(day.income)), Number(data.todayIncome))

  return <article className="module-card">
    <div className="panel-header">
      <div>
        <h2>Today&apos;s performance</h2>
        <p>Recorded income for {data.today}, compared with {data.yesterday}. The same view shown on the homepage, calculated from your saved ledger.</p>
      </div>
      <button type="button" className="button button-small" disabled={loading} onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
    </div>
    <div className="report-performance">
      <div className="report-performance-stat">
        <small>Income today</small>
        <strong>{money(data.todayIncome)}</strong>
        <span className={`hero-trend report-trend report-trend-${trendTone}`}>
          {trendTone === 'up' && <ArrowUpRight size={13} />}
          {trendTone === 'down' && <ArrowDownRight size={13} />}
          {trend === null ? 'No income recorded yesterday to compare' : `${trend}% vs yesterday`}
        </span>
        <p className="dialog-note">
          Expenses today {money(data.todayExpense)} · net {money(data.todayNet)}<br />
          Yesterday: income {money(data.yesterdayIncome)} · expenses {money(data.yesterdayExpense)}
        </p>
      </div>
      <div className="report-performance-bars" role="img" aria-label={`Recorded income for the last seven days ending ${data.today}`}>
        {data.days.length ? data.days.map((day) => {
          const value = Number(day.income)
          const height = Math.max(3, Math.round((value / peak) * 100))
          const isToday = day.date === data.today
          return <div key={day.date} title={`${day.date}: ${money(value)}`}>
            <i className={isToday ? 'is-today' : ''} style={{ height: `${height}%` }} />
            <span>{shortDate(day.date)}</span>
          </div>
        }) : <p className="dialog-note">No income recorded in the last seven days.</p>}
      </div>
    </div>
    <div className="transaction-row"><span>Income this week (last 7 days)</span><strong>{money(data.weekIncome)}</strong></div>
    <div className="transaction-row"><span>Stock value at recorded unit cost</span><strong>{compactMoney(data.stockValue)}</strong></div>
    <p className="dialog-note">The homepage card uses sample marketing numbers. This panel is the live version. Values come from recorded transactions and posted invoices; they are management figures, not audited statements.</p>
    {search && <p className="dialog-note">Filtered by “{search}”.</p>}
  </article>
}
