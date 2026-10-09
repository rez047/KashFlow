import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type CashflowPoint = { date: string; income: number; expense: number }
type MoneyFormatter = (value: string | number) => string

export function OverviewCashflowChart({ data, money }: { data: CashflowPoint[]; money: MoneyFormatter }) {
  return <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={data} margin={{ top: 10, right: 5, left: -24, bottom: 0 }}>
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
  </ResponsiveContainer>
}

export function ReportCharts({
  data,
  monthlyIncome,
  monthlyExpenses,
  rangeLabel,
  money,
}: {
  data: CashflowPoint[]
  monthlyIncome: number
  monthlyExpenses: number
  rangeLabel: string
  money: MoneyFormatter
}) {
  const mix = [
    { name: 'Income', value: monthlyIncome, color: '#7256df' },
    { name: 'Expenses', value: monthlyExpenses, color: '#48b99e' },
  ].filter((item) => item.value > 0)

  return <div className="dashboard-grid">
    <article className="module-card report-chart">
      <h2>Income vs expenses · {rangeLabel}</h2>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data}>
          <CartesianGrid vertical={false} stroke="#eff0f4" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip formatter={(value) => money(Number(value))} />
          <Legend />
          <Bar dataKey="income" fill="#7256df" radius={[5, 5, 0, 0]} />
          <Bar dataKey="expense" fill="#48b99e" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </article>
    <article className="module-card report-chart">
      <h2>Recorded cash flow mix</h2>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={mix} dataKey="value" nameKey="name" outerRadius={85} label>
            {mix.map((item) => <Cell key={item.name} fill={item.color} />)}
          </Pie>
          <Tooltip formatter={(value) => money(Number(value))} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
      {monthlyIncome + monthlyExpenses === 0 && <div className="empty-state">Add transactions to populate this chart.</div>}
    </article>
  </div>
}
