import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { OnlineStoreApp } from './OnlineStore'
import { languages, useTranslation, type LanguageCode } from './i18n'
import {
  Activity, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Banknote, Bell, BookOpen,
  BriefcaseBusiness, CalendarDays, Check, ChevronRight, CircleHelp,
  FileText, Filter, Gauge, Landmark, LayoutDashboard,
  LifeBuoy, LogOut, Menu, Minus, Package, Plus, Printer,
  Search, Settings2, ShieldCheck, ShoppingBag, Smartphone, Trash2, Users, Wallet, X,
} from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './App.css'
import './Sidebar.css'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
function nairobiDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}
const today = nairobiDate()
const yearStart = `${today.slice(0, 4)}-01-01`
type OverviewRange = 'today' | 'last_week' | 'last_30_days' | 'mtd' | 'ytd' | 'custom'
const overviewRangeNames: Record<OverviewRange, string> = {
  today: 'Today',
  last_week: 'Last week',
  last_30_days: 'Last 30 days',
  mtd: 'Month to date',
  ytd: 'Year to date',
  custom: 'Custom dates',
}
function shiftDate(date: string, days: number) {
  const [year = 2000, month = 1, day = 1] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}
function overviewPeriod(range: OverviewRange, from: string, to: string) {
  if (range === 'custom') return { from, to }
  if (range === 'today') return { from: today, to: today }
  if (range === 'last_30_days') return { from: shiftDate(today, -29), to: today }
  if (range === 'mtd') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (range === 'ytd') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  const daysSinceMonday = (weekday + 6) % 7
  const thisWeekMonday = shiftDate(today, -daysSinceMonday)
  return { from: shiftDate(thisWeekMonday, -7), to: shiftDate(thisWeekMonday, -1) }
}
const groups = [
  { title: 'WORKSPACE', items: [['Overview', LayoutDashboard], ['Point of sale', ShoppingBag], ['Banking', Landmark], ['Sales', ArrowUpRight], ['Expenses', ArrowDownLeft], ['Payroll', Users]] },
  { title: 'MANAGE', items: [['Customers', Users], ['Suppliers', ShoppingBag], ['Inventory', Package], ['Projects', BriefcaseBusiness], ['Accounting', BookOpen]] },
  { title: 'INSIGHTS', items: [['Reports', Activity], ['Documents', FileText]] },
] as const
const descriptions: Record<string, string> = {
  Banking: 'Bank feeds are not configured. Manually entered records remain available in the workspace ledger.',
  Sales: 'Create and track internal invoices saved in your workspace.',
  Expenses: 'Record and review expenses entered in your workspace.',
  Payroll: 'Manage encrypted employee records, prepare reviewed monthly payroll drafts, view payslips, post journals, and track external remittance references. Statutory filing is not connected.',
  Customers: 'Customer details are recorded as part of invoices.',
  Suppliers: 'Create, edit, and maintain workspace supplier contact records.',
  Inventory: 'Maintain item and service records, quantities, unit costs, and selling prices.',
  Projects: 'Track project status, dates, customer, notes, and budget.',
  Accounting: 'View the chart of accounts, double-entry journals, trial balance, and manage monthly period close.',
  Reports: 'Overview values are calculated from the records saved in this workspace.',
  'Kenya compliance': 'Government and statutory integrations are inactive. Confirm current filing requirements with approved providers and qualified advisers.',
  Documents: 'Upload, download, and delete private workspace documents stored in the database.',
}

type Transaction = {
  id: string; description: string; amount: string; direction: 'income' | 'expense'; account: string; transaction_date: string
}
type Dashboard = {
  workspaceName: string
  period: { from: string; to: string }
  totals: { income: string; expenses: string; net: string; monthIncome: string; monthExpenses: string }
  transactions: Transaction[]
  cashflow: Array<{ date: string; income: string; expense: string }>
  invoices: { count: number; unpaid_amount: string }
}
type Account = { user: { email: string }; workspace: { id: string; name: string }; workspaces?: Array<{ id: string; name: string; role: string }> }
type IntegrationReadiness = { integrations: Array<{ id: string; status: string }> }
type PayrollEstimate = {
  ruleSet: string; effectiveFrom: string; reviewRequired: true; grossMonthlyPay: number
  nssfEmployee: number; shifEmployee: number; housingLevyEmployee: number; taxablePayEstimate: number
  payeEstimate: number; netPayEstimate: number; nssfEmployer: number; housingLevyEmployer: number
  employerPayrollCostEstimate: number; assumptions: string[]
}
type Employee = { id: string; employeeNumber: string; fullName: string; email?: string; phone?: string; bankName?: string; bankAccountName?: string; bankAccountNumber?: string; grossMonthlyPay: number; otherTaxableDeductions?: number; otherTaxReliefs?: number; deductions?: Array<{ name: string; kind: 'taxable_base' | 'tax_relief' | 'post_tax'; amount: number }>; active: boolean }
type PayrollRun = { id: string; period: string; status: 'draft' | 'posted' | 'partially_paid' | 'paid'; rule_set: string; employee_count: number; gross_total: string; net_total: string; paid_total?: string; outstanding_total?: string; paye_total: string; shif_total: string }
type Remittance = { id: string; remittance_type: string; amount: string; status: string; payment_reference?: string; payroll_run_id: string }
type InvoiceRecord = { id: string; customer: string; customer_email?: string; description: string; amount: string; amount_paid?: string; amount_due?: string; due_date: string; status: string }
type InvoiceMpesaPayment = { id: string; status: string; amount: string; result_description?: string | null; mpesa_receipt_number?: string | null; created_at: string }
type PosCartLine = { itemId: string; description: string; quantity: number; unitPrice: number; onHand: number }
type PosReceipt = { invoiceId: string; customer: string; amount: number; paymentMethod: 'cash' | 'mpesa'; status: string; lines: PosCartLine[] }
type OfflinePosDraft = { id: string; workspaceId: string; createdAt: string; idempotencyKey: string; customer: string; customerEmail: string; locationId: string; amount: number; lines: PosCartLine[] }
type EstimateRecord = { id: string; customer: string; customer_email: string; description: string; amount: string; valid_until: string; status: string; invoice_id?: string | null }
type VendorBill = { id: string; supplier: string; description: string; amount: string; amount_paid?: string; amount_due?: string; bill_date: string; due_date: string; status: string; approval_status?: string }
type DraftLine = { itemId?: string; description: string; quantity: string; unitPrice: string; discountAmount: string; taxAmount: string; recoverableTaxAmount?: string }
type PurchaseOrder = { id: string; supplier: string; status: string; order_date: string; expected_date?: string; lines: Array<{ id: string; item_id: string; item_name: string; quantity: string; received_quantity: string; unit_cost: string }> }
type InventoryLocation = { id: string; name: string; code: string; is_default: boolean; active: boolean }
type InventoryLocationStock = { location_id: string; item_id: string; quantity: string; location_name: string }
type SalesOrder = { id: string; estimate_id: string; invoice_id?: string | null; status: 'confirmed' | 'fulfilled' | 'cancelled'; customer: string; description: string; amount: string }
type RetailReport = { locations: InventoryLocation[]; stockLevels: Array<{ itemId: string; locationId: string; location: string; name: string; quantity: number; unit: string; unitCost: number; valuation: number; reorderPoint: number; needsReorder: boolean }>; reorderAlerts: Array<{ itemId: string; locationId: string; location: string; name: string; quantity: number; unit: string; reorderPoint: number }>; totalValuation: number; bestSellers: Array<{ itemId: string; name: string; quantitySold: number; revenue: number; cost: number; grossProfit: number }> }
type OnlineStoreConfig = { slug: string; title: string; description: string; enabled: boolean }
type StoreOrder = { id: string; status: string; source: string; external_order_id?: string | null; customer_name: string; customer_email: string; customer_phone: string; total: string; invoice_id?: string | null; created_at: string }
type WooConnection = { store_url: string; enabled: boolean; last_synced_at?: string | null; credentialsConfigured: boolean }
type MemberPermission = 'operations.write' | 'sales.write' | 'inventory.write' | 'accounting.write' | 'banking.write' | 'payroll.manage' | 'integrations.manage' | 'workspace.manage' | 'team.manage' | 'store.manage'
type WorkspaceMember = { userId: string; role: string; email: string; phone: string; permissions: MemberPermission[] | null; defaultPermissions: MemberPermission[] }
type CustomRole = { id: string; roleKey: string; roleName: string; permissions: MemberPermission[] }
type TimeEntry = { id: string; description: string; work_date: string; hours: string; hourly_cost: string; billable: boolean; status: string }
type AgingReport = { asOf: string; receivables: { items: Array<{ id: string; counterparty: string; amount: string; amount_paid: string; due_date: string; days_overdue: number }>; buckets: Record<string, string> }; payables: { items: Array<{ id: string; counterparty: string; amount: string; amount_paid: string; due_date: string; days_overdue: number }>; buckets: Record<string, string> } }
type BudgetLine = { id: string; account_code: string; account_name: string; period: string; budget: string; actual: string; variance: string }
type RecurringTemplate = { id: string; template_type: 'invoice' | 'expense'; description: string; counterparty: string; amount: string; frequency: string; next_date: string; active: boolean }
type Reconciliation = { id: string; account_label: string; period_start: string; period_end: string; opening_balance: string; statement_ending_balance: string; status: string; matched_count: number }
type ReconciliationDetail = { reconciliation: Reconciliation; transactions: Array<{ id: string; description: string; amount: string; direction: 'income' | 'expense'; account: string; transaction_date: string; matched: boolean }>; matchedNet: string; calculatedEndingBalance: string; difference: string }
type WorkspaceRecord = { id: string; data: Record<string, string | number>; created_at: string; updated_at: string }
type StoredDocument = { id: string; file_name: string; mime_type: string; file_size: number; created_at: string }
type ComplianceDraft = { id: string; integration_type: 'kra_etims' | 'statutory_filing'; source_type: 'invoice' | 'payroll_run'; source_id: string; payload_version: string; draft_payload: Record<string, unknown>; workflow_status: 'draft' | 'reviewed' | 'cancelled'; provider_status: string; external_invoice_number?: string; fiscal_receipt_signature?: string; reviewer_name?: string; reviewer_qualification?: string; reviewer_registration?: string; reviewer_reference?: string; created_at: string }
type OnboardingMilestone = { integration_type: 'kra_etims' | 'bank_feeds' | 'statutory_filing'; milestone: string; self_reported_note: string; details?: Record<string, string | boolean>; updated_at: string }
type KraEtimsConfig = { configured: boolean; environment: 'sandbox' | 'production'; liveSubmissionsEnabled: boolean; initialized: boolean; device: { deviceId: string | null; sdcId: string | null; mrcNo: string | null; initializedAt: string } | null; credentialsEncryptionReady: boolean; apiBase: string }
type MonoBankConfig = { enabled: boolean; publicKey: string | null; provider: string; countryCoverage: string; setupRequired: string[] }
type ConnectedBankAccount = { id: string; provider: string; account_name: string; account_number_masked: string; institution_name: string; currency: string; account_type: string; data_status: string; connection_status: string; last_synced_at: string | null }
type BankFeedTransaction = { id: string; connected_account_id: string; transaction_date: string; narration: string; amount: string; direction: 'income' | 'expense'; currency: string; review_status: 'needs_review' | 'ignored' | 'posted'; institution_name: string; account_name: string }
type AccountSummary = { code: string; name: string; type: string; debit: string; credit: string; balance: string }
type StatementLine = { code: string; name: string; amount: number }
type FinancialStatements = {
  from: string
  to: string
  incomeStatement: { income: StatementLine[]; expenses: StatementLine[]; totalIncome: number; totalExpenses: number; netIncome: number }
  balanceSheet: { asOf: string; assets: StatementLine[]; liabilities: StatementLine[]; equity: StatementLine[]; accumulatedEarnings: number; totalAssets: number; totalLiabilities: number; totalEquity: number; liabilitiesAndEquity: number; difference: number }
}
type Modal = 'invoice' | 'transaction' | 'business' | 'invite' | 'return' | null
type ReturnLine = { id: string; item_id?: string | null; description: string; quantity: string; returned_quantity: string; unit_price: string; discount_amount: string; tax_amount: string }
type AccountingPeriod = { period: string; status: 'open' | 'closed'; closed_at?: string }
type AuditEvent = { id: string; actor_user_id?: string | null; event_type: string; entity_type: string; entity_id?: string | null; event_data: Record<string, unknown>; created_at: string }
type DatabaseBackup = { key: string; lastModified: string | null; size: number }
type ImportType = 'customers' | 'suppliers' | 'inventory' | 'projects'
type RecordImportPreview = { type: ImportType; totalRows: number; wouldImport: number; duplicateRows: number[] }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (response.status === 401 && !path.startsWith('/v1/auth/')) {
      const message = 'Your session expired or is no longer valid. Please sign in again; your saved records are unchanged.'
      window.dispatchEvent(new CustomEvent('kashflow:session-expired', { detail: message }))
      throw new Error(message)
    }
    throw new Error(payload.error || `Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function money(value: string | number) {
  const amount = Number(value)
  return `KSh ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function parseCsvRow(line: string) {
  const cells: string[] = []
  let value = ''; let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1 }
    else if (character === '"') quoted = !quoted
    else if (character === ',' && !quoted) { cells.push(value.trim()); value = '' }
    else value += character
  }
  cells.push(value.trim())
  return cells
}

function Brand() {
  return <div className="brand-row">
    <div className="brand-mark">K</div>
    <div className="brand-name">Kash<span>Flow</span><small>BUSINESS SUITE</small></div>
  </div>
}

function DraftLineEditor({ lines, onChange, onAdd, onRemove, includeRecoverableTax = false, inventoryItems = [] }: {
  lines: DraftLine[]
  onChange: (index: number, key: keyof DraftLine, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
  includeRecoverableTax?: boolean
  inventoryItems?: WorkspaceRecord[]
}) {
  return <div className="draft-lines">
    <p className="dialog-note">Enter any tax amounts confirmed by your qualified adviser. These are user-provided bookkeeping amounts, not tax calculations or fiscal invoices.</p>
    {lines.map((line, index) => <fieldset className="draft-line" key={index}>
      <legend>Line {index + 1}</legend>
      {inventoryItems.length > 0 && <label className="field-label">Inventory item (optional; stock is deducted when invoiced)<select value={line.itemId ?? ''} onChange={(event) => onChange(index, 'itemId', event.target.value)}><option value="">No stock tracking</option>{inventoryItems.map((item) => <option key={item.id} value={item.id}>{String(item.data.name ?? 'Inventory item')} · {Number(item.data.quantity ?? 0)} available</option>)}</select></label>}
      <label className="field-label">Description<input required maxLength={240} value={line.description} onChange={(event) => onChange(index, 'description', event.target.value)} /></label>
      <div className="field-row">
        <label className="field-label">Quantity<input required min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => onChange(index, 'quantity', event.target.value)} /></label>
        <label className="field-label">Unit price (KSh)<input required min="0" step="0.01" type="number" value={line.unitPrice} onChange={(event) => onChange(index, 'unitPrice', event.target.value)} /></label>
      </div>
      <div className="field-row">
        <label className="field-label">Discount (KSh)<input min="0" step="0.01" type="number" value={line.discountAmount} onChange={(event) => onChange(index, 'discountAmount', event.target.value)} /></label>
        <label className="field-label">Tax amount (KSh)<input min="0" step="0.01" type="number" value={line.taxAmount} onChange={(event) => onChange(index, 'taxAmount', event.target.value)} /></label>
      </div>
      {includeRecoverableTax && <label className="field-label">Recoverable tax (qualified review required)<input min="0" step="0.01" type="number" value={line.recoverableTaxAmount ?? '0'} onChange={(event) => onChange(index, 'recoverableTaxAmount', event.target.value)} /></label>}
      {lines.length > 1 && <button type="button" className="button button-small" onClick={() => onRemove(index)}>Remove line</button>}
    </fieldset>)}
    <button type="button" className="button button-secondary" onClick={onAdd}>Add another line</button>
  </div>
}

function draftDocumentTotal(lines: DraftLine[]) {
  return lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) * Number(line.unitPrice) - Number(line.discountAmount || 0) + Number(line.taxAmount || 0)), 0)
}

function App() {
  const { language, setLanguage, t } = useTranslation()
  const [page, setPage] = useState('Overview')
  const [pageHistory, setPageHistory] = useState<string[]>([])
  const teamPermissionsScrollPending = useRef(false)
  const [overviewRange, setOverviewRange] = useState<OverviewRange>('mtd')
  const [overviewFrom, setOverviewFrom] = useState(`${today.slice(0, 7)}-01`)
  const [overviewTo, setOverviewTo] = useState(today)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [toast, setToast] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [account, setAccount] = useState<Account | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [integrationReadiness, setIntegrationReadiness] = useState<IntegrationReadiness | null>(null)
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false)
  const [showSetupFlow, setShowSetupFlow] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [invite, setInvite] = useState({ email: '', role: 'viewer' })
  const [inviteLink, setInviteLink] = useState('')
  const [inviteScope, setInviteScope] = useState<'single' | 'all_owned'>('single')
  const [starting, setStarting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [credentials, setCredentials] = useState({ identifier: '', password: '', businessName: '' })
  const [transaction, setTransaction] = useState({ description: '', amount: '', direction: 'expense', account: '', date: today })
  const [invoice, setInvoice] = useState({ customer: '', customerEmail: '', description: '', amount: '', dueDate: '' })
  const [invoiceLocationId, setInvoiceLocationId] = useState('')
  const [invoiceLines, setInvoiceLines] = useState<DraftLine[]>([{ description: '', quantity: '1', unitPrice: '', discountAmount: '0', taxAmount: '0' }])
  const [estimateLines, setEstimateLines] = useState<DraftLine[]>([{ description: '', quantity: '1', unitPrice: '', discountAmount: '0', taxAmount: '0' }])
  const [billLines, setBillLines] = useState<DraftLine[]>([{ description: '', quantity: '1', unitPrice: '', discountAmount: '0', taxAmount: '0', recoverableTaxAmount: '0' }])
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({})
  const [invoiceMpesaPhones, setInvoiceMpesaPhones] = useState<Record<string, string>>({})
  const [invoiceMpesaPayments, setInvoiceMpesaPayments] = useState<Record<string, InvoiceMpesaPayment[]>>({})
  const [mpesaPromptInvoiceId, setMpesaPromptInvoiceId] = useState<string | null>(null)
  const [mpesaPromptSubmitting, setMpesaPromptSubmitting] = useState(false)
  const [posSearch, setPosSearch] = useState('')
  const [posLocationId, setPosLocationId] = useState('')
  const [posCart, setPosCart] = useState<PosCartLine[]>([])
  const [posCustomer, setPosCustomer] = useState('')
  const [posCustomerType, setPosCustomerType] = useState<'walk_in' | 'remote'>('walk_in')
  const [posCustomerEmail, setPosCustomerEmail] = useState('')
  const [posPaymentMethod, setPosPaymentMethod] = useState<'cash' | 'mpesa'>('cash')
  const [posPaymentPhone, setPosPaymentPhone] = useState('')
  const [posReceipt, setPosReceipt] = useState<PosReceipt | null>(null)
  const [posIdempotencyKey, setPosIdempotencyKey] = useState(() => crypto.randomUUID())
  const [offlinePosDrafts, setOfflinePosDrafts] = useState<OfflinePosDraft[]>([])
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const offlinePosWorkspaceLoaded = useRef<string | null>(null)
  const posCatalogWorkspaceLoaded = useRef<string | null>(null)
  const [estimateInput, setEstimateInput] = useState({ customer: '', customerEmail: '', description: '', amount: '', validUntil: today })
  const [billInput, setBillInput] = useState({ supplier: '', description: '', amount: '', billDate: today, dueDate: today, requiresApproval: false })
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [purchaseOrderInput, setPurchaseOrderInput] = useState({ supplier: '', orderDate: today, dueDate: today, expectedDate: today, locationId: '', itemId: '', quantity: '1', unitCost: '0' })
  const [stockMovementInput, setStockMovementInput] = useState({ itemId: '', locationId: '', movementType: 'purchase' as 'purchase' | 'sale' | 'adjustment', adjustmentDirection: 'increase' as 'increase' | 'decrease', quantity: '1', unitCost: '0', reference: '', date: today })
  const [inventoryLocations, setInventoryLocations] = useState<InventoryLocation[]>([])
  const [inventoryLocationStock, setInventoryLocationStock] = useState<InventoryLocationStock[]>([])
  const [locationInput, setLocationInput] = useState({ name: '', code: '' })
  const [transferInput, setTransferInput] = useState({ itemId: '', fromLocationId: '', toLocationId: '', quantity: '1' })
  const [countInput, setCountInput] = useState({ itemId: '', locationId: '', countedQuantity: '0' })
  const [inventoryWriteOffInput, setInventoryWriteOffInput] = useState({ itemId: '', locationId: '', reason: 'damaged' as 'damaged' | 'expired' | 'custom', customReason: '', quantity: '1', date: today, notes: '' })
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([])
  const [retailReport, setRetailReport] = useState<RetailReport | null>(null)
  const [storeConfig, setStoreConfig] = useState<OnlineStoreConfig>({ slug: '', title: '', description: '', enabled: false })
  const [storeOrders, setStoreOrders] = useState<StoreOrder[]>([])
  const [wooConnection, setWooConnection] = useState<WooConnection | null>(null)
  const [wooEncryptionReady, setWooEncryptionReady] = useState(false)
  const [wooCredentials, setWooCredentials] = useState({ storeUrl: '', consumerKey: '', consumerSecret: '' })
  const [teamMembers, setTeamMembers] = useState<WorkspaceMember[]>([])
  const [memberPermissionDrafts, setMemberPermissionDrafts] = useState<Record<string, MemberPermission[]>>({})
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, string>>({})
  const [memberPermissionOverrides, setMemberPermissionOverrides] = useState<Record<string, boolean>>({})
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([])
  const [customRoleDraft, setCustomRoleDraft] = useState({ name: '', permissions: [] as MemberPermission[] })
  const [editingCustomRoleKey, setEditingCustomRoleKey] = useState('')
  const [supplierItemIds, setSupplierItemIds] = useState<string[]>([''])
  const [posBridgeStatus, setPosBridgeStatus] = useState('')
  const [posBridgeBusy, setPosBridgeBusy] = useState(false)
  const [posBridgeAddress, setPosBridgeAddress] = useState(() => localStorage.getItem('kashflow-pos-bridge') || 'http://127.0.0.1:17371')
  const [timeInput, setTimeInput] = useState({ projectId: '', description: '', workDate: today, hours: '', hourlyCost: '', billable: false })
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [projectSummary, setProjectSummary] = useState<Record<string, string> | null>(null)
  const [budgetInput, setBudgetInput] = useState({ accountCode: '', period: today.slice(0, 7), amount: '' })
  const [budgets, setBudgets] = useState<BudgetLine[]>([])
  const [forecast, setForecast] = useState<Array<{ period: string; income: number; expenses: number; source: string }>>([])
  const [agingReport, setAgingReport] = useState<AgingReport | null>(null)
  const [reconciliationInput, setReconciliationInput] = useState({ accountLabel: 'Imported bank statement', periodStart: today.slice(0, 7) + '-01', periodEnd: today, openingBalance: '0', statementEndingBalance: '0' })
  const [paymentPhone, setPaymentPhone] = useState('')
  const [payrollInput, setPayrollInput] = useState({ grossMonthlyPay: '', otherTaxableDeductions: '0', otherTaxReliefs: '0' })
  const [payrollEstimate, setPayrollEstimate] = useState<PayrollEstimate | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([])
  const [remittances, setRemittances] = useState<Remittance[]>([])
  const [invoicesList, setInvoicesList] = useState<InvoiceRecord[]>([])
  const [estimates, setEstimates] = useState<EstimateRecord[]>([])
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTemplate[]>([])
  const [recurringInput, setRecurringInput] = useState({ type: 'invoice' as 'invoice' | 'expense', description: '', counterparty: '', amount: '', frequency: 'monthly' as 'monthly' | 'quarterly' | 'annually', nextDate: today })
  const [bills, setBills] = useState<VendorBill[]>([])
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([])
  const [reconciliationDetail, setReconciliationDetail] = useState<ReconciliationDetail | null>(null)
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [financialStatements, setFinancialStatements] = useState<FinancialStatements | null>(null)
  const [reportFrom, setReportFrom] = useState(yearStart)
  const [reportTo, setReportTo] = useState(today)
  const [journalEntries, setJournalEntries] = useState<Array<{ id: string; entry_date: string; description: string; source_type?: string; reversal_of?: string | null; reversed_by?: string | null; correction_reason?: string | null; lines: Array<{ code: string; debit: string; credit: string }> }>>([])
  const [trialTotals, setTrialTotals] = useState({ debit: '0', credit: '0' })
  const [accountingPeriods, setAccountingPeriods] = useState<AccountingPeriod[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [backupOperatorToken, setBackupOperatorToken] = useState('')
  const [databaseBackups, setDatabaseBackups] = useState<DatabaseBackup[]>([])
  const [restoreBackupKey, setRestoreBackupKey] = useState('')
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [backupStatus, setBackupStatus] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [recordImportType, setRecordImportType] = useState<ImportType>('customers')
  const [recordImportRows, setRecordImportRows] = useState<Array<Record<string, string>>>([])
  const [recordImportPreview, setRecordImportPreview] = useState<RecordImportPreview | null>(null)
  const [employeeInput, setEmployeeInput] = useState({ employeeNumber: '', fullName: '', email: '', phone: '', bankName: '', bankAccountName: '', bankAccountNumber: '', grossMonthlyPay: '', otherTaxableDeductions: '0', otherTaxReliefs: '0', deductions: [] as Array<{ name: string; kind: 'taxable_base' | 'tax_relief' | 'post_tax'; amount: string }> })
  const [editingEmployeeId, setEditingEmployeeId] = useState('')
  const [payrollPeriod, setPayrollPeriod] = useState(today.slice(0, 7))
  const [payrollIncludedEmployeeIds, setPayrollIncludedEmployeeIds] = useState<string[]>([])
  const [payrollBonuses, setPayrollBonuses] = useState<Record<string, string>>({})
  const [payrollPaymentInputs, setPayrollPaymentInputs] = useState<Record<string, { amount: string; paymentReference: string }>>({})
  const [payslips, setPayslips] = useState<Array<{ id: string; period: string; employee: Omit<Employee, 'active'>; bonusAmount?: number; estimate: PayrollEstimate }>>([])
  const [records, setRecords] = useState<Record<string, WorkspaceRecord[]>>({ customers: [], suppliers: [], inventory: [], projects: [] })
  const [recordForm, setRecordForm] = useState<Record<string, string>>({})
  const [editingRecordId, setEditingRecordId] = useState('')
  const [storedDocuments, setStoredDocuments] = useState<StoredDocument[]>([])
  const [bankImportRows, setBankImportRows] = useState<Array<{ date: string; description: string; amount: string; direction: 'income' | 'expense' }>>([])
  const [invoicePreview, setInvoicePreview] = useState<InvoiceRecord | null>(null)
  const [returnInvoice, setReturnInvoice] = useState<InvoiceRecord | null>(null)
  const [returnLines, setReturnLines] = useState<ReturnLine[]>([])
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({})
  const [returnInput, setReturnInput] = useState({ reason: '', refundAmount: '0', restock: true })
  const [complianceDrafts, setComplianceDrafts] = useState<ComplianceDraft[]>([])
  const [onboarding, setOnboarding] = useState<Record<string, { milestone: string; note: string; details: Record<string, string | boolean> }>>({})
  const [reviewerDetails] = useState({ name: '', qualification: '', registration: '', reference: '' })
  const [kraEtimsConfig, setKraEtimsConfig] = useState<KraEtimsConfig | null>(null)
  const [kraDeviceInput, setKraDeviceInput] = useState({ taxpayerPin: '', branchId: '00', deviceSerial: '' })
  const [kraCodes, setKraCodes] = useState<Record<string, unknown> | null>(null)
  const [kraPayloadEditors, setKraPayloadEditors] = useState<Record<string, string>>({})
  const [monoConfig, setMonoConfig] = useState<MonoBankConfig | null>(null)
  const [connectedBankAccounts, setConnectedBankAccounts] = useState<ConnectedBankAccount[]>([])
  const [bankFeedTransactions, setBankFeedTransactions] = useState<BankFeedTransaction[]>([])
  const [monoCustomerName, setMonoCustomerName] = useState('')
  const [monoCustomerEmail, setMonoCustomerEmail] = useState('')
  const [helpSearch, setHelpSearch] = useState('')
  const [settings, setSettings] = useState({
    businessName: '',
    currency: 'KES',
    timezone: 'Africa/Nairobi',
    invoiceTerms: 'Net 14',
    emailAlerts: true,
    auditTrail: true,
    twoFactor: false,
    backupSchedule: 'Daily automatic',
    inventoryLowStockThreshold: 5,
    inventoryMediumStockThreshold: 10,
    monoEnabled: false,
    darajaEnabled: false,
    kraEtimsLiveEnabled: false,
    statutoryFilingsEnabled: false,
    shifEnabled: false,
    nssfEnabled: false,
    ahlEnabled: false,
  })

  function navigateTo(nextPage: string) {
    if (nextPage === page) return
    setPageHistory((history) => [...history, page])
    setPage(nextPage)
  }

  function navigateBack() {
    const previous = pageHistory.at(-1)
    if (!previous) { setPage('Overview'); return }
    setPageHistory((history) => history.slice(0, -1))
    setPage(previous)
  }

  useEffect(() => {
    if (page !== 'Settings' || !teamPermissionsScrollPending.current) return
    teamPermissionsScrollPending.current = false
    document.getElementById('team-permissions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [page])

  const refresh = useCallback(async () => {
    const period = overviewPeriod(overviewRange, overviewFrom, overviewTo)
    const query = new URLSearchParams(period)
    setDashboard(await request<Dashboard>(`/v1/dashboard?${query}`))
  }, [overviewFrom, overviewRange, overviewTo])

  async function loadOverviewPeriod(range: OverviewRange, from = overviewFrom, to = overviewTo) {
    const period = overviewPeriod(range, from, to)
    if (!period.from || !period.to || period.from > period.to) {
      setError('Choose a valid overview date range with a start date on or before the end date.')
      return
    }
    setOverviewLoading(true); setError('')
    try {
      const query = new URLSearchParams(period)
      const result = await request<Dashboard>(`/v1/dashboard?${query}`)
      setOverviewRange(range)
      setOverviewFrom(period.from)
      setOverviewTo(period.to)
      setDashboard(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load totals for this overview period.')
    } finally { setOverviewLoading(false) }
  }

  useEffect(() => {
    function handleSessionExpired(event: Event) {
      const message = (event as CustomEvent<string>).detail
      setAccount(null)
      setDashboard(null)
      setShowSetupFlow(false)
      setError(message)
    }
    window.addEventListener('kashflow:session-expired', handleSessionExpired)
    return () => window.removeEventListener('kashflow:session-expired', handleSessionExpired)
  }, [])

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const status = await request<{ bootstrapAvailable: boolean }>('/v1/auth/status')
        if (!active) return
        setBootstrapAvailable(status.bootstrapAvailable)
        setShowSetupFlow(status.bootstrapAvailable)
        try {
          const signedIn = await request<Account>('/v1/auth/me')
          if (!active) return
          setAccount(signedIn)
          await acceptPendingInvitation()
          const data = await request<Dashboard>('/v1/dashboard')
          if (active) setDashboard(data)
          const preferences = await request<{ settings: Partial<typeof settings> }>('/v1/settings')
          if (active) setSettings((current) => ({ ...current, ...preferences.settings, businessName: preferences.settings.businessName ?? data.workspaceName ?? current.businessName }))
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

  useEffect(() => {
    const setOnline = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', setOnline)
    window.addEventListener('offline', setOnline)
    return () => {
      window.removeEventListener('online', setOnline)
      window.removeEventListener('offline', setOnline)
    }
  }, [])

  useEffect(() => {
    const workspaceId = account?.workspace.id
    if (!workspaceId) return
    const storageKey = `kashflow-pos-offline-${workspaceId}`
    try {
      const saved = localStorage.getItem(storageKey)
      const drafts: unknown = saved ? JSON.parse(saved) : []
      if (!Array.isArray(drafts) || drafts.some((item) => !item || typeof item !== 'object' || (item as OfflinePosDraft).workspaceId !== workspaceId || typeof (item as OfflinePosDraft).idempotencyKey !== 'string' || !Array.isArray((item as OfflinePosDraft).lines))) {
        throw new Error('Saved offline POS drafts are invalid; do not discard them until they have been reviewed.')
      }
      setOfflinePosDrafts(drafts as OfflinePosDraft[])
      offlinePosWorkspaceLoaded.current = workspaceId
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load offline POS drafts from this browser.')
    }
    try {
      const catalog = localStorage.getItem(`kashflow-pos-catalog-${workspaceId}`)
      if (catalog) {
        const parsedCatalog: unknown = JSON.parse(catalog)
        if (!parsedCatalog || typeof parsedCatalog !== 'object' || !Array.isArray((parsedCatalog as { inventory?: unknown }).inventory)) throw new Error('Cached POS inventory is invalid.')
        const values = parsedCatalog as { inventory: WorkspaceRecord[]; locations?: InventoryLocation[]; stock?: InventoryLocationStock[] }
        setRecords((current) => ({ ...current, inventory: values.inventory }))
        setInventoryLocations(values.locations ?? [])
        setInventoryLocationStock(values.stock ?? [])
      }
      posCatalogWorkspaceLoaded.current = workspaceId
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load cached POS inventory.')
    }
  }, [account?.workspace.id])

  useEffect(() => {
    const workspaceId = account?.workspace.id
    if (!workspaceId || offlinePosWorkspaceLoaded.current !== workspaceId) return
    try { localStorage.setItem(`kashflow-pos-offline-${workspaceId}`, JSON.stringify(offlinePosDrafts)) }
    catch (reason) { setError(reason instanceof Error ? `Offline POS drafts could not be saved on this device: ${reason.message}` : 'Offline POS drafts could not be saved on this device.') }
  }, [offlinePosDrafts, account?.workspace.id])

  useEffect(() => {
    const workspaceId = account?.workspace.id
    if (!workspaceId || posCatalogWorkspaceLoaded.current !== workspaceId) return
    try {
      localStorage.setItem(`kashflow-pos-catalog-${workspaceId}`, JSON.stringify({ inventory: records.inventory, locations: inventoryLocations, stock: inventoryLocationStock }))
    } catch (reason) { setError(reason instanceof Error ? `POS catalog could not be cached on this device: ${reason.message}` : 'POS catalog could not be cached on this device.') }
  }, [records.inventory, inventoryLocations, inventoryLocationStock, account?.workspace.id])

  useEffect(() => {
    if (!account) return
    void request<IntegrationReadiness>('/v1/integrations/readiness').then(setIntegrationReadiness).catch(() => undefined)
    if (page === 'Payroll') {
      void Promise.all([
        request<{ employees: Employee[] }>('/v1/payroll/employees').then((result) => {
          setEmployees(result.employees)
          setPayrollIncludedEmployeeIds((current) => current.length
            ? current.filter((id) => result.employees.some((employee) => employee.id === id && employee.active))
            : result.employees.filter((employee) => employee.active).map((employee) => employee.id))
        }),
        request<{ runs: PayrollRun[] }>('/v1/payroll/runs').then((result) => setPayrollRuns(result.runs)),
        request<{ remittances: Remittance[] }>('/v1/payroll/remittances').then((result) => setRemittances(result.remittances)),
      ]).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load payroll records.'))
    }
    if (page === 'Accounting') {
      void Promise.all([
        request<{ accounts: AccountSummary[]; totals: { debit: string; credit: string } }>('/v1/accounting/trial-balance').then((result) => { setAccounts(result.accounts); setTrialTotals(result.totals) }),
        request<{ entries: typeof journalEntries }>('/v1/accounting/journals').then((result) => setJournalEntries(result.entries)),
        request<{ periods: AccountingPeriod[] }>('/v1/accounting/periods').then((result) => setAccountingPeriods(result.periods)),
        request<FinancialStatements>(`/v1/accounting/reports/financial-statements?from=${yearStart}&to=${today}`).then(setFinancialStatements),
      ]).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load accounting records.'))
    }
    if (page === 'Sales') {
      void Promise.all([
        request<{ invoices: InvoiceRecord[] }>('/v1/invoices').then((result) => setInvoicesList(result.invoices)),
        request<{ estimates: EstimateRecord[] }>('/v1/estimates').then((result) => setEstimates(result.estimates)),
        request<{ templates: RecurringTemplate[] }>('/v1/recurring').then((result) => setRecurringTemplates(result.templates)),
        request<{ orders: SalesOrder[] }>('/v1/sales-orders').then((result) => setSalesOrders(result.orders)),
        request<{ records: WorkspaceRecord[] }>('/v1/records/inventory').then((result) => setRecords((current) => ({ ...current, inventory: result.records }))),
        request<{ locations: InventoryLocation[]; defaultLocationId: string }>('/v1/inventory/locations').then((result) => { setInventoryLocations(result.locations); setInvoiceLocationId((current) => current || result.defaultLocationId) }),
        request<{ orders: StoreOrder[] }>('/v1/store/orders').then((result) => setStoreOrders(result.orders)),
      ]).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load sales records.'))
    }
    if (page === 'Point of sale') {
      void Promise.all([
        request<{ records: WorkspaceRecord[] }>('/v1/records/inventory').then((result) => setRecords((current) => ({ ...current, inventory: result.records }))),
        request<{ records: WorkspaceRecord[] }>('/v1/records/customers').then((result) => setRecords((current) => ({ ...current, customers: result.records }))),
        request<{ locations: InventoryLocation[]; defaultLocationId: string }>('/v1/inventory/locations').then((result) => { setInventoryLocations(result.locations); setPosLocationId((current) => current || result.defaultLocationId) }),
        request<{ stock: InventoryLocationStock[] }>('/v1/inventory/location-stock').then((result) => setInventoryLocationStock(result.stock)),
      ]).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load point-of-sale items.'))
    }
    if (page === 'Inventory') void Promise.all([
      request<{ records: WorkspaceRecord[] }>('/v1/records/inventory').then((result) => setRecords((current) => ({ ...current, inventory: result.records }))),
      request<{ purchaseOrders: PurchaseOrder[] }>('/v1/purchase-orders').then((result) => setPurchaseOrders(result.purchaseOrders)),
      request<{ locations: InventoryLocation[]; defaultLocationId: string }>('/v1/inventory/locations').then((result) => { setInventoryLocations(result.locations); setStockMovementInput((current) => ({ ...current, locationId: current.locationId || result.defaultLocationId })); setInventoryWriteOffInput((current) => ({ ...current, locationId: current.locationId || result.defaultLocationId })); setPurchaseOrderInput((current) => ({ ...current, locationId: current.locationId || result.defaultLocationId })) }),
      request<{ stock: InventoryLocationStock[] }>('/v1/inventory/location-stock').then((result) => setInventoryLocationStock(result.stock)),
    ]).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load inventory and location records.'))
    if (page === 'Reports') {
      const period = today.slice(0, 7)
      void Promise.all([
        request<{ budgets: BudgetLine[] }>(`/v1/reports/budgets?from=${period}&to=${period}`).then((result) => setBudgets(result.budgets)),
        request<{ forecast: Array<{ period: string; income: number; expenses: number; source: string }> }>('/v1/reports/cash-flow-forecast').then((result) => setForecast(result.forecast)),
        request<AgingReport>(`/v1/reports/aging?asOf=${today}`).then(setAgingReport),
        request<{ accounts: AccountSummary[] }>('/v1/accounting/chart').then((result) => setAccounts(result.accounts)),
        request<RetailReport>('/v1/reports/retail').then(setRetailReport),
      ]).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load management reports.'))
    }
    if (page === 'Banking') {
      void Promise.all([
        request<MonoBankConfig>('/v1/banking/mono/config').then((result) => setMonoConfig(result)),
        request<{ accounts: ConnectedBankAccount[] }>('/v1/banking/accounts').then((result) => setConnectedBankAccounts(result.accounts)),
        request<{ transactions: BankFeedTransaction[] }>('/v1/banking/transactions?status=needs_review').then((result) => setBankFeedTransactions(result.transactions)),
        request<{ reconciliations: Reconciliation[] }>('/v1/accounting/reconciliations').then((result) => setReconciliations(result.reconciliations)),
      ]).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load connected bank feeds.'))
    }
    if (page === 'Kenya compliance') {
      void Promise.all([
        request<{ onboarding: OnboardingMilestone[] }>('/v1/integrations/onboarding').then((result) => setOnboarding(Object.fromEntries(result.onboarding.map((item) => [item.integration_type, { milestone: item.milestone, note: item.self_reported_note, details: item.details ?? {} }])))),
        request<{ drafts: ComplianceDraft[] }>('/v1/integrations/drafts').then((result) => setComplianceDrafts(result.drafts)),
        request<{ invoices: InvoiceRecord[] }>('/v1/invoices').then((result) => setInvoicesList(result.invoices)),
        request<KraEtimsConfig>('/v1/integrations/etims/config').then((result) => setKraEtimsConfig(result)),
      ]).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load integration preparation records.'))
    }
    const recordType = ({ Customers: 'customers', Suppliers: 'suppliers', Inventory: 'inventory', Projects: 'projects' } as Record<string, string>)[page]
    if (recordType) void request<{ records: WorkspaceRecord[] }>(`/v1/records/${recordType}`).then((result) => setRecords((current) => ({ ...current, [recordType]: result.records }))).catch((reason) => setError(reason instanceof Error ? reason.message : `Could not load ${page.toLowerCase()}.`))
    if (page === 'Suppliers') void request<{ bills: VendorBill[] }>('/v1/bills').then((result) => setBills(result.bills)).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load supplier bills.'))
    if (page === 'Documents' || page === 'Overview') void request<{ documents: StoredDocument[] }>('/v1/documents').then((result) => setStoredDocuments(result.documents)).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load stored documents.'))
    if (page === 'Settings') {
      void request<{ settings: Partial<typeof settings> }>('/v1/settings').then((result) => setSettings((current) => ({ ...current, ...result.settings, businessName: result.settings.businessName ?? dashboard?.workspaceName ?? current.businessName }))).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load workspace settings.'))
      void Promise.all([
        request<{ store: OnlineStoreConfig | null }>('/v1/store/settings').then(({ store }) => {
          const slug = dashboard?.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'my-store'
          setStoreConfig(store ?? { slug, title: dashboard?.workspaceName ?? '', description: '', enabled: false })
        }),
        request<{ orders: StoreOrder[] }>('/v1/store/orders').then((result) => setStoreOrders(result.orders)),
        request<{ connection: WooConnection | null; encryptionReady: boolean }>('/v1/integrations/woocommerce').then((result) => {
          setWooConnection(result.connection); setWooEncryptionReady(result.encryptionReady)
          if (result.connection) setWooCredentials((current) => ({ ...current, storeUrl: result.connection!.store_url }))
        }),
        request<{ members: WorkspaceMember[] }>(`/v1/workspaces/${account.workspace.id}/members`).then((result) => {
          setTeamMembers(result.members)
          setMemberPermissionDrafts(Object.fromEntries(result.members.map((member) => [member.userId, member.permissions ?? member.defaultPermissions])))
          setMemberRoleDrafts(Object.fromEntries(result.members.map((member) => [member.userId, member.role])))
          setMemberPermissionOverrides(Object.fromEntries(result.members.map((member) => [member.userId, member.permissions !== null])))
        }),
        request<{ roles: CustomRole[] }>(`/v1/workspaces/${account.workspace.id}/roles`).then((result) => setCustomRoles(result.roles)),
      ]).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load store, WooCommerce, or team settings.'))
    }
    else if (account) void request<{ settings: Partial<typeof settings> }>('/v1/settings').then((result) => setSettings((current) => ({ ...current, ...result.settings, businessName: result.settings.businessName ?? dashboard?.workspaceName ?? current.businessName }))).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load workspace settings.'))
  }, [account, dashboard?.workspaceName, page])

  async function saveStoreSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await request<{ store: OnlineStoreConfig }>('/v1/store/settings', { method: 'PUT', body: JSON.stringify(storeConfig) })
      setStoreConfig(result.store); notify('Online store settings saved.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save online store settings.') }
    finally { setBusy(false) }
  }

  async function updateStoreOrder(order: StoreOrder, status: 'accepted' | 'rejected' | 'fulfilled') {
    setBusy(true); setError('')
    try {
      await request(`/v1/store/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      const result = await request<{ orders: StoreOrder[] }>('/v1/store/orders')
      setStoreOrders(result.orders); notify(`Online order marked ${status}.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update online order.') }
    finally { setBusy(false) }
  }

  async function convertStoreOrder(order: StoreOrder) {
    setBusy(true); setError('')
    try {
      const result = await request<{ invoice: InvoiceRecord }>(`/v1/store/orders/${order.id}/convert`, { method: 'POST', body: JSON.stringify({}) })
      const [orders, invoices, inventory, stock] = await Promise.all([
        request<{ orders: StoreOrder[] }>('/v1/store/orders'),
        request<{ invoices: InvoiceRecord[] }>('/v1/invoices'),
        request<{ records: WorkspaceRecord[] }>('/v1/records/inventory'),
        request<{ stock: InventoryLocationStock[] }>('/v1/inventory/location-stock'),
      ])
      setStoreOrders(orders.orders); setInvoicesList(invoices.invoices); setRecords((current) => ({ ...current, inventory: inventory.records })); setInventoryLocationStock(stock.stock)
      await refresh(); notify(`Order converted to invoice ${result.invoice.id.slice(0, 8)}; check payment and delivery separately.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not convert online order to invoice.') }
    finally { setBusy(false) }
  }

  async function saveWooCommerce(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await request<{ connection: WooConnection }>('/v1/integrations/woocommerce', { method: 'PUT', body: JSON.stringify(wooCredentials) })
      setWooConnection(result.connection); setWooCredentials((current) => ({ ...current, consumerKey: '', consumerSecret: '' })); notify('WooCommerce credentials encrypted and saved for this business.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save WooCommerce credentials.') }
    finally { setBusy(false) }
  }

  async function syncWooCommerce(kind: 'products' | 'orders') {
    setBusy(true); setError('')
    try {
      const result = await request<{ synced?: number; failed?: number; failures?: Array<{ item: string; reason: string }>; imported?: number; skipped?: number; note?: string }>(`/v1/integrations/woocommerce/${kind}/sync`, { method: 'POST', body: '{}' })
      if (kind === 'orders') {
        const orders = await request<{ orders: StoreOrder[] }>('/v1/store/orders')
        setStoreOrders(orders.orders)
        notify(`${result.imported ?? 0} order(s) imported; ${result.skipped ?? 0} skipped for review. ${result.note ?? ''}`)
      } else {
        notify(`${result.synced ?? 0} products synced; ${result.failed ?? 0} failed.${result.failures?.length ? ` ${result.failures.map((failure) => `${failure.item}: ${failure.reason}`).join('; ')}` : ''}`)
      }
      const status = await request<{ connection: WooConnection | null; encryptionReady: boolean }>('/v1/integrations/woocommerce')
      setWooConnection(status.connection); setWooEncryptionReady(status.encryptionReady)
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not synchronize WooCommerce ${kind}.`) }
    finally { setBusy(false) }
  }

  async function saveMemberPermissions(member: WorkspaceMember) {
    setBusy(true); setError('')
    try {
      const role = memberRoleDrafts[member.userId] ?? member.role
      const permissions = memberPermissionOverrides[member.userId]
        ? memberPermissionDrafts[member.userId] ?? member.defaultPermissions
        : null
      const result = await request<{ member: WorkspaceMember }>(`/v1/workspaces/${account?.workspace.id}/members/${member.userId}/permissions`, { method: 'PUT', body: JSON.stringify({ role, permissions }) })
      setTeamMembers((current) => current.map((item) => item.userId === member.userId ? result.member : item))
      setMemberRoleDrafts((current) => ({ ...current, [member.userId]: result.member.role }))
      setMemberPermissionOverrides((current) => ({ ...current, [member.userId]: result.member.permissions !== null }))
      setMemberPermissionDrafts((current) => ({ ...current, [member.userId]: result.member.permissions ?? result.member.defaultPermissions }))
      notify(`Role and permissions saved for ${member.email || member.phone}.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save member permissions.') }
    finally { setBusy(false) }
  }

  function permissionsForRole(role: string) {
    const custom = customRoles.find((item) => item.roleKey === role)
    if (custom) return custom.permissions
    if (role === 'accountant') return ['operations.write', 'sales.write', 'inventory.write', 'accounting.write', 'banking.write'] as MemberPermission[]
    if (role === 'staff') return ['operations.write', 'sales.write', 'inventory.write'] as MemberPermission[]
    return []
  }

  function assignMemberRole(userId: string, role: string) {
    setMemberRoleDrafts((current) => ({ ...current, [userId]: role }))
    setMemberPermissionDrafts((current) => ({ ...current, [userId]: permissionsForRole(role) }))
    setMemberPermissionOverrides((current) => ({ ...current, [userId]: false }))
  }

  async function refreshTeamMembers() {
    const result = await request<{ members: WorkspaceMember[] }>(`/v1/workspaces/${account?.workspace.id}/members`)
    setTeamMembers(result.members)
    setMemberPermissionDrafts(Object.fromEntries(result.members.map((member) => [member.userId, member.permissions ?? member.defaultPermissions])))
    setMemberRoleDrafts(Object.fromEntries(result.members.map((member) => [member.userId, member.role])))
    setMemberPermissionOverrides(Object.fromEntries(result.members.map((member) => [member.userId, member.permissions !== null])))
  }

  function toggleMemberPermission(userId: string, permission: MemberPermission, enabled: boolean) {
    setMemberPermissionDrafts((current) => {
      const active = current[userId] ?? []
      const next = enabled ? [...new Set([...active, permission])] : active.filter((value) => value !== permission)
      return { ...current, [userId]: next }
    })
  }

  function toggleCustomRolePermission(permission: MemberPermission, enabled: boolean) {
    setCustomRoleDraft((current) => ({
      ...current,
      permissions: enabled ? [...new Set([...current.permissions, permission])] : current.permissions.filter((item) => item !== permission),
    }))
  }

  async function saveCustomRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const url = `/v1/workspaces/${account?.workspace.id}/roles${editingCustomRoleKey ? `/${encodeURIComponent(editingCustomRoleKey)}` : ''}`
      const result = await request<{ role: CustomRole }>(url, { method: editingCustomRoleKey ? 'PUT' : 'POST', body: JSON.stringify({ name: customRoleDraft.name, permissions: customRoleDraft.permissions }) })
      setCustomRoles((current) => editingCustomRoleKey ? current.map((role) => role.roleKey === editingCustomRoleKey ? result.role : role) : [...current, result.role])
      await refreshTeamMembers()
      setEditingCustomRoleKey(''); setCustomRoleDraft({ name: '', permissions: [] }); notify('Custom role saved.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save custom role.') }
    finally { setBusy(false) }
  }

  function editCustomRole(role: CustomRole) {
    setEditingCustomRoleKey(role.roleKey)
    setCustomRoleDraft({ name: role.roleName, permissions: [...role.permissions] })
  }

  function cancelCustomRoleEdit() {
    setEditingCustomRoleKey('')
    setCustomRoleDraft({ name: '', permissions: [] })
  }

  function beginInvoiceForCustomer(customer: WorkspaceRecord) {
    setInvoice({ customer: String(customer.data.name ?? ''), customerEmail: String(customer.data.email ?? ''), description: '', amount: '', dueDate: today })
    setInvoiceLines([{ description: '', quantity: '1', unitPrice: '', discountAmount: '0', taxAmount: '0' }])
    setInvoiceLocationId('')
    setInvoicePreview(null)
    setError('')
    setModal('invoice')
  }

  function changePosBridgeAddress(value: string) {
    setPosBridgeAddress(value)
    localStorage.setItem('kashflow-pos-bridge', value)
    setPosBridgeStatus('')
  }

  function validatePosBridgeAddress() {
    const parsed = new URL(posBridgeAddress)
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('The POS bridge must use http://127.0.0.1 or http://localhost on this register.')
    return parsed.origin
  }

  async function testPosBridge() {
    setPosBridgeBusy(true); setPosBridgeStatus('')
    try {
      const origin = validatePosBridgeAddress()
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(3000) })
      if (!response.ok) throw new Error(`Local bridge returned HTTP ${response.status}.`)
      setPosBridgeStatus('Local printer bridge is reachable. Receipt printing requires the configured ESC/POS network printer.')
    } catch (reason) { setPosBridgeStatus(reason instanceof Error ? reason.message : 'Could not reach the local printer bridge.') }
    finally { setPosBridgeBusy(false) }
  }

  async function sendPosHardwareCommand(path: '/receipt' | '/cash-drawer') {
    if (!posReceipt) return
    setPosBridgeBusy(true); setPosBridgeStatus('')
    try {
      const origin = validatePosBridgeAddress()
      const response = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(posReceipt),
        signal: AbortSignal.timeout(10_000),
      })
      const result = await response.json().catch(() => ({})) as { error?: string; status?: string }
      if (!response.ok) throw new Error(result.error || `Local bridge returned HTTP ${response.status}.`)
      setPosBridgeStatus(path === '/receipt' ? 'Receipt sent to the thermal printer.' : 'Cash-drawer pulse sent through the printer.')
    } catch (reason) { setPosBridgeStatus(reason instanceof Error ? reason.message : 'Local POS hardware command failed.') }
    finally { setPosBridgeBusy(false) }
  }

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3000)
  }

  function addAttachmentFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter((file) => file.size > 0)
    if (!files.length) return
    void (async () => {
      for (const file of files) await persistDocument(file)
      const result = await request<{ documents: StoredDocument[] }>('/v1/documents')
      setStoredDocuments(result.documents)
    })().catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not store selected documents.'))
  }

  function formatAttachmentSize(size: number) {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(2)} MB`
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const inviteToken = new URLSearchParams(window.location.search).get('invite')
      if (inviteToken) {
        let existingAccount: Account | null = null
        try {
          existingAccount = await request<Account>('/v1/auth/login', { method: 'POST', body: JSON.stringify({ identifier: credentials.identifier, password: credentials.password }) })
        } catch {
          existingAccount = null
        }
        if (existingAccount) {
          setAccount(existingAccount)
          await acceptPendingInvitation()
        } else {
          await request('/v1/invitations/accept', { method: 'POST', body: JSON.stringify({ token: inviteToken, email: credentials.identifier, password: credentials.password }) })
          const acceptedAccount = await request<Account>('/v1/auth/me')
          setAccount(acceptedAccount)
          clearInvitationFromUrl()
          notify('Account created and invitation accepted.')
        }
        setBootstrapAvailable(false); setShowSetupFlow(false); await refresh()
        return
      }
      const route = showSetupFlow ? '/v1/auth/bootstrap' : '/v1/auth/login'
      const body = showSetupFlow
        ? { identifier: credentials.identifier, password: credentials.password, businessName: credentials.businessName }
        : { identifier: credentials.identifier, password: credentials.password }
      const signedIn = await request<Account>(route, { method: 'POST', body: JSON.stringify(body) })
      setAccount(signedIn); setBootstrapAvailable(false); setShowSetupFlow(false); await refresh()
      await acceptPendingInvitation()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign in.')
    } finally { setBusy(false) }
  }

  async function acceptPendingInvitation() {
    const parameters = new URLSearchParams(window.location.search)
    const token = parameters.get('invite')
    if (!token) return
    try {
      await request('/v1/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) })
      clearInvitationFromUrl()
      const signedIn = await request<Account>('/v1/auth/me')
      setAccount(signedIn)
      await refresh()
      notify('Invitation accepted. You now have access to the business.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not accept invitation.')
    }
  }

  function clearInvitationFromUrl() {
    const parameters = new URLSearchParams(window.location.search)
    parameters.delete('invite')
    const query = parameters.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
  }

  async function logout() {
    try { await request('/v1/auth/logout', { method: 'POST' }) } catch { /* Discard an expired local session. */ }
    setAccount(null); setDashboard(null); setPageHistory([]); setPage('Overview')
  }

  async function createBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const created = await request<{ workspace: { id: string; name: string; role: string } }>('/v1/workspaces', { method: 'POST', body: JSON.stringify({ name: businessName }) })
      const nextAccount = account ? { ...account, workspace: { id: created.workspace.id, name: created.workspace.name }, workspaces: [...(account.workspaces ?? []), { id: created.workspace.id, name: created.workspace.name, role: created.workspace.role }] } : null
      setAccount(nextAccount)
      setDashboard((current) => current ? { ...current, workspaceName: created.workspace.name } : current)
      setBusinessName(''); setModal(null); notify(`Business “${created.workspace.name}” added.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create business.')
    } finally { setBusy(false) }
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await request<{ delivery: string; invitationUrl?: string }>(`/v1/workspaces/${account?.workspace.id}/invitations`, { method: 'POST', body: JSON.stringify({ email: invite.email, role: invite.role, scope: inviteScope }) })
      setInvite({ email: '', role: 'viewer' })
      if (result.delivery === 'manual_link' && result.invitationUrl) {
        setInviteLink(result.invitationUrl)
      } else {
        setModal(null)
        setInviteLink('')
      }
      setInviteScope('single')
      notify(result.delivery === 'manual_link' ? 'Invitation created. Copy and send the secure link manually.' : 'Invitation email accepted by the configured provider.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create invitation.')
    } finally { setBusy(false) }
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

  function addPosItem(item: WorkspaceRecord) {
    const onHand = Number(inventoryLocationStock.find((stock) => stock.location_id === posLocationId && stock.item_id === item.id)?.quantity ?? 0)
    const existing = posCart.find((line) => line.itemId === item.id)
    if (onHand <= 0 || (existing && existing.quantity >= onHand)) return
    const itemName = String(item.data.name ?? 'Inventory item')
    const unitPrice = Number(item.data.price ?? 0)
    setError('')
    setPosReceipt(null)
    setPosCart((cart) => {
      const line = cart.find((entry) => entry.itemId === item.id)
      if (line) return cart.map((entry) => entry.itemId === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry)
      return [...cart, { itemId: item.id, description: itemName, quantity: 1, unitPrice, onHand }]
    })
  }

  function scanPosBarcode(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    const code = event.currentTarget.value.trim().toLowerCase()
    if (!code) return
    const item = records.inventory.find((record) => [record.data.barcode, record.data.sku].some((value) => String(value ?? '').trim().toLowerCase() === code))
    if (item) {
      event.preventDefault()
      addPosItem(item)
      setPosSearch('')
    }
  }

  function changePosQuantity(itemId: string, quantity: number) {
    setPosCart((cart) => quantity <= 0
      ? cart.filter((line) => line.itemId !== itemId)
      : cart.map((line) => line.itemId === itemId ? { ...line, quantity: Math.min(quantity, line.onHand) } : line))
  }

  function queueOfflinePosSale() {
    if (!account || !posCart.length || posPaymentMethod !== 'cash') return
    const customer = posCustomerType === 'walk_in' ? 'Walk-in customer' : posCustomer.trim()
    const lines = posCart.map((line) => ({ ...line }))
    const draft: OfflinePosDraft = {
      id: crypto.randomUUID(),
      workspaceId: account.workspace.id,
      createdAt: new Date().toISOString(),
      idempotencyKey: posIdempotencyKey,
      customer,
      customerEmail: posCustomerType === 'remote' ? posCustomerEmail.trim() : '',
      locationId: posLocationId,
      amount: lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
      lines,
    }
    setOfflinePosDrafts((current) => [...current, draft])
    setPosIdempotencyKey(crypto.randomUUID())
    setPosCart([])
    setPosCustomer('')
    setPosCustomerType('walk_in')
    setPosCustomerEmail('')
    notify('Offline sale draft saved on this device only. It is not yet an invoice, payment, or stock deduction.')
  }

  async function syncOfflinePosDraft(draft: OfflinePosDraft) {
    if (!account || draft.workspaceId !== account.workspace.id) {
      setError('This offline sale belongs to a different business workspace and cannot be synced here.')
      return
    }
    setBusy(true); setError('')
    try {
      const created = await request<{ invoice: { id: string } }>('/v1/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customer: draft.customer,
          customerEmail: draft.customerEmail,
          locationId: draft.locationId || undefined,
          idempotencyKey: draft.idempotencyKey,
          dueDate: today,
          lines: draft.lines.map((line) => ({ itemId: line.itemId, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: 0, taxAmount: 0 })),
        }),
      })
      setOfflinePosDrafts((current) => current.filter((item) => item.id !== draft.id))
      setPosReceipt({ invoiceId: created.invoice.id, customer: draft.customer, amount: draft.amount, paymentMethod: 'cash', status: 'Created after reconnect · payment not recorded', lines: draft.lines })
      notify(`Offline draft synced as invoice ${created.invoice.id.slice(0, 8)}. Review payment and stock before releasing goods.`)
      const [inventory, listedInvoices, locationStock] = await Promise.all([
        request<{ records: WorkspaceRecord[] }>('/v1/records/inventory'),
        request<{ invoices: InvoiceRecord[] }>('/v1/invoices'),
        request<{ stock: InventoryLocationStock[] }>('/v1/inventory/location-stock'),
      ])
      setRecords((current) => ({ ...current, inventory: inventory.records }))
      setInvoicesList(listedInvoices.invoices)
      setInventoryLocationStock(locationStock.stock)
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? `Offline sale was not fully synced: ${reason.message}` : 'Offline sale was not fully synced. Keep the draft and retry.') }
    finally { setBusy(false) }
  }

  function discardOfflinePosDraft(draft: OfflinePosDraft) {
    if (!window.confirm(`Discard this local-only sale draft for ${draft.customer} (${money(draft.amount)})? It has not been posted to the workspace.`)) return
    setOfflinePosDrafts((current) => current.filter((item) => item.id !== draft.id))
  }

  async function checkoutPos() {
    if (!posCart.length || posCart.some((line) => line.quantity <= 0 || line.quantity > line.onHand)) {
      setError('Add available stock items to the cart before checkout.')
      return
    }
    if (posPaymentMethod === 'mpesa' && !posPaymentPhone.trim()) {
      setError('Enter the customer’s M-Pesa phone number before requesting payment.')
      return
    }
    if (posCustomerType === 'remote' && !posCustomer.trim()) {
      setError('Enter the remote customer’s name before checkout.')
      return
    }
    const customer = posCustomerType === 'walk_in' ? 'Walk-in customer' : posCustomer.trim()
    const saleLines = posCart.map((line) => ({ ...line }))
    const total = saleLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
    if (total <= 0) {
      setError('The sale total must be greater than zero. Check the item selling prices in Inventory.')
      return
    }
    if (posPaymentMethod === 'mpesa' && (!Number.isSafeInteger(total) || total < 1)) {
      setError('M-Pesa STK Push requires a whole-KSh total. Adjust item prices or quantities before checkout.')
      return
    }
    if (!navigator.onLine) {
      if (posPaymentMethod !== 'cash') { setError('M-Pesa requests require an active connection. No offline M-Pesa payment can be requested.'); return }
      queueOfflinePosSale()
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await request<{ invoice: { id: string } }>('/v1/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customer,
          customerEmail: posCustomerType === 'remote' ? posCustomerEmail.trim() : '',
          locationId: posLocationId || undefined,
          idempotencyKey: posIdempotencyKey,
          dueDate: today,
          lines: saleLines.map((line) => ({ itemId: line.itemId, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: 0, taxAmount: 0 })),
        }),
      })
      setPosIdempotencyKey(crypto.randomUUID())
      const receipt: PosReceipt = { invoiceId: created.invoice.id, customer, amount: total, paymentMethod: posPaymentMethod, status: 'Payment not yet recorded', lines: saleLines }
      setPosReceipt(receipt)
      setPosCart([])
      setPosCustomer('')
      setPosCustomerType('walk_in')
      setPosCustomerEmail('')
      setPosPaymentPhone('')

      if (posPaymentMethod === 'cash') {
        try {
          await request(`/v1/invoices/${created.invoice.id}/payments`, { method: 'POST', body: JSON.stringify({ amount: total, paymentDate: today }) })
          receipt.status = 'Paid · cash recorded'
          notify('Sale completed. Stock and cash payment recorded.')
        } catch (reason) {
          receipt.status = 'Unpaid · payment recording failed'
          setError(`Sale and stock were saved as invoice ${created.invoice.id.slice(0, 8)}, but cash payment was not recorded: ${reason instanceof Error ? reason.message : 'try recording the payment from Sales.'}`)
        }
      } else {
        try {
          const result = await request<{ customerMessage: string }>(`/v1/invoices/${created.invoice.id}/payments/mpesa`, { method: 'POST', body: JSON.stringify({ phone: posPaymentPhone.trim() }) })
          receipt.status = 'M-Pesa request started · confirm payment status before releasing goods'
          notify(result.customerMessage)
        } catch (reason) {
          receipt.status = 'Unpaid · M-Pesa request did not start'
          setError(`Sale and stock were saved as invoice ${created.invoice.id.slice(0, 8)}, but the M-Pesa request did not start: ${reason instanceof Error ? reason.message : 'check Daraja setup and try from Sales.'}`)
        }
      }
      setPosReceipt({ ...receipt })
      try {
        const [inventory, listedInvoices] = await Promise.all([
          request<{ records: WorkspaceRecord[] }>('/v1/records/inventory'),
          request<{ invoices: InvoiceRecord[] }>('/v1/invoices'),
        ])
        const locationStock = await request<{ stock: InventoryLocationStock[] }>('/v1/inventory/location-stock')
        setRecords((current) => ({ ...current, inventory: inventory.records }))
        setInventoryLocationStock(locationStock.stock)
        setInvoicesList(listedInvoices.invoices)
        await refresh()
      } catch (reason) {
        setError((message) => [message, `Sale was saved, but the workspace view could not refresh: ${reason instanceof Error ? reason.message : 'reload the page.'}`].filter(Boolean).join(' '))
      }
    } catch (reason) {
      if (reason instanceof TypeError && posPaymentMethod === 'cash') {
        queueOfflinePosSale()
        setError('The API could not be reached. The sale was saved as a local-only draft; it is not posted, paid, or deducted from stock.')
      } else setError(reason instanceof Error ? reason.message : 'Could not save the sale.')
    } finally {
      setBusy(false)
    }
  }

  async function retryPosCashPayment() {
    if (!posReceipt || !posReceipt.status.startsWith('Unpaid · payment recording failed')) return
    setBusy(true)
    setError('')
    try {
      await request(`/v1/invoices/${posReceipt.invoiceId}/payments`, { method: 'POST', body: JSON.stringify({ amount: posReceipt.amount, paymentDate: today }) })
      setPosReceipt({ ...posReceipt, status: 'Paid · cash recorded' })
      notify('Cash payment recorded against the saved POS invoice.')
      const listedInvoices = await request<{ invoices: InvoiceRecord[] }>('/v1/invoices')
      setInvoicesList(listedInvoices.invoices)
      const locationStock = await request<{ stock: InventoryLocationStock[] }>('/v1/inventory/location-stock')
      setInventoryLocationStock(locationStock.stock)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not record the cash payment.')
    } finally {
      setBusy(false)
    }
  }

  async function saveInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const created = await request<{ invoice: { id: string } }>('/v1/invoices', { method: 'POST', body: JSON.stringify({
        customer: invoice.customer,
        customerEmail: invoice.customerEmail,
        locationId: invoiceLocationId || undefined,
        dueDate: invoice.dueDate,
        lines: invoiceLines.map((line) => ({ itemId: line.itemId || undefined, description: line.description, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), discountAmount: Number(line.discountAmount || 0), taxAmount: Number(line.taxAmount || 0) })),
      }) })
      setModal(null); setInvoice({ customer: '', customerEmail: '', description: '', amount: '', dueDate: '' })
      setInvoiceLocationId('')
      setInvoiceLines([{ description: '', quantity: '1', unitPrice: '', discountAmount: '0', taxAmount: '0' }])
      void request<{ records: WorkspaceRecord[] }>('/v1/records/inventory').then((result) => setRecords((current) => ({ ...current, inventory: result.records }))).catch((reason) => setError(reason instanceof Error ? `Invoice saved, but stock could not be refreshed: ${reason.message}` : 'Invoice saved, but stock could not be refreshed.'))
      if (page === 'Sales') {
        const listed = await request<{ invoices: InvoiceRecord[] }>('/v1/invoices'); setInvoicesList(listed.invoices)
      }
      const mobileNumber = paymentPhone.trim()
      setPaymentPhone('')
      await refresh()
      if (mobileNumber) {
        try {
          const result = await request<{ customerMessage: string }>(`/v1/invoices/${created.invoice.id}/payments/mpesa`, { method: 'POST', body: JSON.stringify({ phone: mobileNumber }) })
          notify(`Invoice saved. ${result.customerMessage}`)
        } catch (reason) {
          notify(`Invoice saved; M-Pesa request not started: ${reason instanceof Error ? reason.message : 'check Daraja setup.'}`)
        }
      } else notify('Invoice saved to this workspace')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save invoice.')
    } finally { setBusy(false) }
  }

  async function saveEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request('/v1/estimates', { method: 'POST', body: JSON.stringify({
        customer: estimateInput.customer,
        customerEmail: estimateInput.customerEmail,
        validUntil: estimateInput.validUntil,
        lines: estimateLines.map((line) => ({ itemId: line.itemId || undefined, description: line.description, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), discountAmount: Number(line.discountAmount || 0), taxAmount: Number(line.taxAmount || 0) })),
      }) })
      setEstimateInput({ customer: '', customerEmail: '', description: '', amount: '', validUntil: today })
      setEstimateLines([{ description: '', quantity: '1', unitPrice: '', discountAmount: '0', taxAmount: '0' }])
      const result = await request<{ estimates: EstimateRecord[] }>('/v1/estimates')
      setEstimates(result.estimates); notify('Estimate saved; it has not been posted to the ledger.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save estimate.') }
    finally { setBusy(false) }
  }

  async function saveBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request('/v1/bills', { method: 'POST', body: JSON.stringify({
        supplier: billInput.supplier,
        billDate: billInput.billDate,
        dueDate: billInput.dueDate,
        requiresApproval: billInput.requiresApproval,
        lines: billLines.map((line) => ({ description: line.description, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), discountAmount: Number(line.discountAmount || 0), taxAmount: Number(line.taxAmount || 0), recoverableTaxAmount: Number(line.recoverableTaxAmount || 0) })),
      }) })
      setBillInput({ supplier: '', description: '', amount: '', billDate: today, dueDate: today, requiresApproval: false })
      setBillLines([{ description: '', quantity: '1', unitPrice: '', discountAmount: '0', taxAmount: '0', recoverableTaxAmount: '0' }])
      const result = await request<{ bills: VendorBill[] }>('/v1/bills')
      setBills(result.bills); await refresh(); notify('Bill recorded in accounts payable.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save supplier bill.') }
    finally { setBusy(false) }
  }

  async function payBill(bill: VendorBill) {
    setBusy(true); setError('')
    try {
      const amount = Number(paymentAmounts[bill.id])
      await request(`/v1/bills/${bill.id}/payments`, { method: 'POST', body: JSON.stringify({ amount, paymentDate: today }) })
      const result = await request<{ bills: VendorBill[] }>('/v1/bills')
      setBills(result.bills); setPaymentAmounts((values) => ({ ...values, [bill.id]: '' })); await refresh(); notify('Bill payment recorded in the ledger.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not record bill payment.') }
    finally { setBusy(false) }
  }

  async function approveBill(bill: VendorBill) {
    setBusy(true); setError('')
    try {
      await request(`/v1/bills/${bill.id}/approval`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) })
      const result = await request<{ bills: VendorBill[] }>('/v1/bills')
      setBills(result.bills); await refresh(); notify('Bill approved and posted to the ledger.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not approve bill.') }
    finally { setBusy(false) }
  }

  async function payInvoice(invoiceRow: InvoiceRecord) {
    setBusy(true); setError('')
    try {
      await request(`/v1/invoices/${invoiceRow.id}/payments`, { method: 'POST', body: JSON.stringify({ amount: Number(paymentAmounts[invoiceRow.id]), paymentDate: today }) })
      const result = await request<{ invoices: InvoiceRecord[] }>('/v1/invoices')
      setInvoicesList(result.invoices); setPaymentAmounts((values) => ({ ...values, [invoiceRow.id]: '' })); await refresh(); notify('Invoice payment recorded in the ledger.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not record invoice payment.') }
    finally { setBusy(false) }
  }

  async function loadInvoiceMpesaPayments(invoiceId: string) {
    try {
      const result = await request<{ payments: InvoiceMpesaPayment[] }>(`/v1/invoices/${invoiceId}/payments/mpesa`)
      setInvoiceMpesaPayments((current) => ({ ...current, [invoiceId]: result.payments }))
      const invoices = await request<{ invoices: InvoiceRecord[] }>('/v1/invoices')
      setInvoicesList(invoices.invoices)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load this invoice’s M-Pesa status.')
    }
  }

  async function sendInvoiceMpesaPrompt(invoiceRow: InvoiceRecord) {
    const phone = invoiceMpesaPhones[invoiceRow.id]?.trim()
    if (!phone) { setError('Enter the customer’s M-Pesa number before sending a prompt.'); return }
    setMpesaPromptSubmitting(true); setError('')
    try {
      const result = await request<{ customerMessage: string }>(`/v1/invoices/${invoiceRow.id}/payments/mpesa`, { method: 'POST', body: JSON.stringify({ phone }) })
      await loadInvoiceMpesaPayments(invoiceRow.id)
      notify(result.customerMessage)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the M-Pesa prompt. The invoice remains unpaid.')
      await loadInvoiceMpesaPayments(invoiceRow.id)
    } finally { setMpesaPromptSubmitting(false) }
  }

  async function recordStockMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request(`/v1/inventory/${stockMovementInput.itemId}/movements`, { method: 'POST', body: JSON.stringify({ ...stockMovementInput, quantity: Number(stockMovementInput.quantity), unitCost: Number(stockMovementInput.unitCost) }) })
      const result = await request<{ records: WorkspaceRecord[] }>('/v1/records/inventory')
      setRecords((current) => ({ ...current, inventory: result.records })); await refresh(); notify('Stock movement posted and recorded.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not record stock movement.') }
    finally { setBusy(false) }
  }

  async function createInventoryLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request('/v1/inventory/locations', { method: 'POST', body: JSON.stringify(locationInput) })
      const [locationResult, stockResult] = await Promise.all([request<{ locations: InventoryLocation[]; defaultLocationId: string }>('/v1/inventory/locations'), request<{ stock: InventoryLocationStock[] }>('/v1/inventory/location-stock')])
      setInventoryLocations(locationResult.locations); setInventoryLocationStock(stockResult.stock); setLocationInput({ name: '', code: '' }); notify('Stock location created.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create stock location.') }
    finally { setBusy(false) }
  }

  async function transferInventory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request('/v1/inventory/transfers', { method: 'POST', body: JSON.stringify({ ...transferInput, quantity: Number(transferInput.quantity), date: today }) })
      const result = await request<{ stock: InventoryLocationStock[] }>('/v1/inventory/location-stock')
      setInventoryLocationStock(result.stock); setTransferInput((current) => ({ ...current, quantity: '1' })); notify('Stock transfer recorded between locations.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not transfer stock.') }
    finally { setBusy(false) }
  }

  async function countInventory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request('/v1/inventory/counts', { method: 'POST', body: JSON.stringify({ ...countInput, countedQuantity: Number(countInput.countedQuantity), date: today }) })
      const [stock, inventory] = await Promise.all([request<{ stock: InventoryLocationStock[] }>('/v1/inventory/location-stock'), request<{ records: WorkspaceRecord[] }>('/v1/records/inventory')])
      setInventoryLocationStock(stock.stock); setRecords((current) => ({ ...current, inventory: inventory.records })); await refresh(); notify('Stock count adjustment recorded.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not post stock count.') }
    finally { setBusy(false) }
  }

  async function writeOffInventory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const item = records.inventory.find((record) => record.id === inventoryWriteOffInput.itemId)
    if (!item) { setError('Choose an inventory item to write off.'); return }
    const customReason = inventoryWriteOffInput.customReason.trim()
    if (inventoryWriteOffInput.reason === 'custom' && !customReason) { setError('Enter a reason for this stock write-off.'); return }
    setBusy(true); setError('')
    try {
      const reason = inventoryWriteOffInput.reason === 'custom'
        ? `Other: ${customReason}`
        : inventoryWriteOffInput.reason === 'expired' ? 'Expired stock' : 'Damaged stock'
      const reference = `${reason}${inventoryWriteOffInput.notes.trim() ? `: ${inventoryWriteOffInput.notes.trim()}` : ''}`.slice(0, 200)
      await request(`/v1/inventory/${item.id}/movements`, { method: 'POST', body: JSON.stringify({
        movementType: 'adjustment',
        adjustmentDirection: 'decrease',
        locationId: inventoryWriteOffInput.locationId,
        quantity: Number(inventoryWriteOffInput.quantity),
        unitCost: Number(item.data.cost ?? 0),
        reference,
        date: inventoryWriteOffInput.date,
      }) })
      const [stock, inventory] = await Promise.all([
        request<{ stock: InventoryLocationStock[] }>('/v1/inventory/location-stock'),
        request<{ records: WorkspaceRecord[] }>('/v1/records/inventory'),
      ])
      setInventoryLocationStock(stock.stock)
      setRecords((current) => ({ ...current, inventory: inventory.records }))
      setInventoryWriteOffInput((current) => ({ ...current, quantity: '1', customReason: '', notes: '' }))
      await refresh()
      notify(`${reason} quantity deducted and its cost posted as an inventory expense.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not record the inventory write-off.')
    } finally { setBusy(false) }
  }

  async function saveInventoryThresholds(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (settings.inventoryMediumStockThreshold <= settings.inventoryLowStockThreshold) {
      setError('The medium stock threshold must be higher than the low stock threshold.')
      return
    }
    setBusy(true); setError('')
    try {
      await request('/v1/settings', { method: 'PUT', body: JSON.stringify({ ...settings, businessName: settings.businessName || dashboard?.workspaceName }) })
      notify('Stock health thresholds saved for this business.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save stock thresholds.')
    } finally { setBusy(false) }
  }

  async function createPurchaseOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request('/v1/purchase-orders', { method: 'POST', body: JSON.stringify({
        supplier: purchaseOrderInput.supplier,
        locationId: purchaseOrderInput.locationId,
        orderDate: purchaseOrderInput.orderDate,
        dueDate: purchaseOrderInput.dueDate,
        expectedDate: purchaseOrderInput.expectedDate,
        lines: [{ itemId: purchaseOrderInput.itemId, quantity: Number(purchaseOrderInput.quantity), unitCost: Number(purchaseOrderInput.unitCost) }],
      }) })
      const result = await request<{ purchaseOrders: PurchaseOrder[] }>('/v1/purchase-orders')
      setPurchaseOrders(result.purchaseOrders); notify('Purchase order saved; inventory changes only when goods are received.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save purchase order.') }
    finally { setBusy(false) }
  }

  async function receivePurchaseOrder(order: PurchaseOrder) {
    setBusy(true); setError('')
    try {
      const lines = order.lines.map((line) => ({ lineId: line.id, quantity: Number(line.quantity) - Number(line.received_quantity) })).filter((line) => line.quantity > 0)
      await request(`/v1/purchase-orders/${order.id}/receive`, { method: 'POST', body: JSON.stringify({ lines, date: today }) })
      const result = await request<{ purchaseOrders: PurchaseOrder[] }>('/v1/purchase-orders')
      setPurchaseOrders(result.purchaseOrders); const inventory = await request<{ records: WorkspaceRecord[] }>('/v1/records/inventory')
      setRecords((current) => ({ ...current, inventory: inventory.records })); await refresh(); notify('Received goods posted to inventory and accounts payable.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not receive purchase order.') }
    finally { setBusy(false) }
  }

  async function loadProjectTime(projectId: string) {
    setTimeInput((current) => ({ ...current, projectId }))
    if (!projectId) { setTimeEntries([]); setProjectSummary(null); return }
    try {
      const [entries, summary] = await Promise.all([
        request<{ entries: TimeEntry[] }>(`/v1/projects/${projectId}/time`),
        request<Record<string, string>>(`/v1/projects/${projectId}/summary`),
      ])
      setTimeEntries(entries.entries); setProjectSummary(summary)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load project time records.') }
  }

  async function saveTimeEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request(`/v1/projects/${timeInput.projectId}/time`, { method: 'POST', body: JSON.stringify({ ...timeInput, hours: Number(timeInput.hours), hourlyCost: Number(timeInput.hourlyCost) }) })
      await loadProjectTime(timeInput.projectId); notify('Project time saved for review.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save project time.') }
    finally { setBusy(false) }
  }

  async function reviewTimeEntry(entry: TimeEntry, status: 'approved' | 'rejected') {
    if (!timeInput.projectId) return
    try {
      await request(`/v1/projects/${timeInput.projectId}/time/${entry.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await loadProjectTime(timeInput.projectId); notify(`Time entry ${status}.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not review project time.') }
  }

  async function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request('/v1/reports/budgets', { method: 'PUT', body: JSON.stringify({ ...budgetInput, amount: Number(budgetInput.amount) }) })
      const period = budgetInput.period
      const result = await request<{ budgets: BudgetLine[] }>(`/v1/reports/budgets?from=${period}&to=${period}`)
      setBudgets(result.budgets); notify('Budget saved.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save budget.') }
    finally { setBusy(false) }
  }

  async function saveRecurring(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request('/v1/recurring', { method: 'POST', body: JSON.stringify({ ...recurringInput, amount: Number(recurringInput.amount) }) })
      const result = await request<{ templates: RecurringTemplate[] }>('/v1/recurring')
      setRecurringTemplates(result.templates); setRecurringInput({ ...recurringInput, description: '', counterparty: '', amount: '' }); notify('Recurring schedule saved; no entry is posted until you run it.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save recurring schedule.') }
    finally { setBusy(false) }
  }

  async function runRecurring(template: RecurringTemplate) {
    setBusy(true); setError('')
    try {
      await request(`/v1/recurring/${template.id}/run`, { method: 'POST', body: JSON.stringify({}) })
      const result = await request<{ templates: RecurringTemplate[] }>('/v1/recurring')
      setRecurringTemplates(result.templates); await refresh(); notify('Recurring entry created and posted.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not run recurring schedule.') }
    finally { setBusy(false) }
  }

  async function updateEstimateStatus(estimate: EstimateRecord, status: 'sent' | 'accepted' | 'declined' | 'void') {
    setBusy(true); setError('')
    try {
      await request(`/v1/estimates/${estimate.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      setEstimates((current) => current.map((item) => item.id === estimate.id ? { ...item, status } : item))
      notify(`Estimate marked ${status}.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update estimate.') }
    finally { setBusy(false) }
  }

  async function convertEstimate(estimate: EstimateRecord) {
    setBusy(true); setError('')
    try {
      await request(`/v1/estimates/${estimate.id}/convert`, { method: 'POST', body: JSON.stringify({ dueDate: today }) })
      const [updatedEstimates, updatedInvoices, updatedInventory] = await Promise.all([request<{ estimates: EstimateRecord[] }>('/v1/estimates'), request<{ invoices: InvoiceRecord[] }>('/v1/invoices'), request<{ records: WorkspaceRecord[] }>('/v1/records/inventory')])
      setEstimates(updatedEstimates.estimates); setInvoicesList(updatedInvoices.invoices); setRecords((current) => ({ ...current, inventory: updatedInventory.records })); await refresh(); notify('Accepted estimate converted to an invoice.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not convert estimate.') }
    finally { setBusy(false) }
  }

  async function createSalesOrder(estimate: EstimateRecord) {
    setBusy(true); setError('')
    try {
      await request(`/v1/estimates/${estimate.id}/order`, { method: 'POST', body: JSON.stringify({}) })
      const [orders, updatedEstimates] = await Promise.all([request<{ orders: SalesOrder[] }>('/v1/sales-orders'), request<{ estimates: EstimateRecord[] }>('/v1/estimates')])
      setSalesOrders(orders.orders); setEstimates(updatedEstimates.estimates); notify('Accepted quote converted into a confirmed sales order.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create sales order.') }
    finally { setBusy(false) }
  }

  async function updateSalesOrder(order: SalesOrder, status: 'fulfilled' | 'cancelled') {
    setBusy(true); setError('')
    try {
      await request(`/v1/sales-orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      const [result, updatedEstimates] = await Promise.all([request<{ orders: SalesOrder[] }>('/v1/sales-orders'), status === 'cancelled' ? request<{ estimates: EstimateRecord[] }>('/v1/estimates') : Promise.resolve(null)])
      setSalesOrders(result.orders)
      if (updatedEstimates) setEstimates(updatedEstimates.estimates)
      notify(status === 'fulfilled' ? 'Sales order marked fulfilled; convert it to an invoice to post the sale.' : 'Sales order cancelled.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update sales order.') }
    finally { setBusy(false) }
  }

  async function openSalesReturn(invoiceRow: InvoiceRecord) {
    setError(''); setReturnInvoice(invoiceRow); setReturnQuantities({}); setReturnInput({ reason: '', refundAmount: '0', restock: true }); setBusy(true)
    try {
      const result = await request<{ lines: ReturnLine[] }>(`/v1/invoices/${invoiceRow.id}/lines`)
      setReturnLines(result.lines)
      setModal('return')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load invoice lines for return.') }
    finally { setBusy(false) }
  }

  async function saveSalesReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!returnInvoice) return
    const lines = Object.entries(returnQuantities).filter(([, quantity]) => Number(quantity) > 0).map(([invoiceLineId, quantity]) => ({ invoiceLineId, quantity: Number(quantity) }))
    if (!lines.length) { setError('Enter a return quantity for at least one invoice line.'); return }
    setBusy(true); setError('')
    try {
      await request(`/v1/invoices/${returnInvoice.id}/returns`, { method: 'POST', body: JSON.stringify({ ...returnInput, refundAmount: Number(returnInput.refundAmount), returnDate: today, lines }) })
      const [invoices, inventory, stock] = await Promise.all([request<{ invoices: InvoiceRecord[] }>('/v1/invoices'), request<{ records: WorkspaceRecord[] }>('/v1/records/inventory'), request<{ stock: InventoryLocationStock[] }>('/v1/inventory/location-stock')])
      setInvoicesList(invoices.invoices); setRecords((current) => ({ ...current, inventory: inventory.records })); setInventoryLocationStock(stock.stock); setModal(null); setReturnInvoice(null); await refresh(); notify('Return credit and any stock/refund entries were recorded. Make any external cash refund separately.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not record sales return.') }
    finally { setBusy(false) }
  }

  async function sendInvoiceEmail(invoiceId: string) {
    setBusy(true); setError('')
    try {
      const result = await request<{ message: string }>(`/v1/invoices/${invoiceId}/email`, { method: 'POST', body: '{}' })
      notify(result.message)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Email provider could not accept the invoice.') }
    finally { setBusy(false) }
  }

  async function createComplianceDraft(integrationType: 'kra_etims' | 'statutory_filing', sourceId: string) {
    setBusy(true); setError('')
    try {
      await request(`/v1/integrations/${integrationType === 'kra_etims' ? 'etims' : 'statutory'}/drafts/${sourceId}`, { method: 'POST', body: '{}' })
      const result = await request<{ drafts: ComplianceDraft[] }>('/v1/integrations/drafts')
      setComplianceDrafts(result.drafts); notify('Internal preparation draft saved; nothing was submitted externally.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not prepare integration draft.') }
    finally { setBusy(false) }
  }

  async function updateOnboarding(integrationType: 'kra_etims' | 'bank_feeds' | 'statutory_filing') {
    setBusy(true); setError('')
    try {
      const values = onboarding[integrationType] ?? { milestone: 'not_started', note: '', details: {} }
      const safeDetails = Object.fromEntries(Object.entries(values.details ?? {}).filter(([key]) => key !== 'taxpayerPin'))
      const result = await request<{ onboarding: OnboardingMilestone; verified: boolean }>(`/v1/integrations/onboarding/${integrationType}`, { method: 'PUT', body: JSON.stringify({ milestone: values.milestone, note: values.note, details: safeDetails }) })
      setOnboarding((current) => ({ ...current, [integrationType]: { milestone: result.onboarding.milestone, note: result.onboarding.self_reported_note, details: result.onboarding.details ?? {} } }))
      notify('Onboarding profile saved. Evidence and qualifications remain self-reported until independently verified.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save onboarding status.') }
    finally { setBusy(false) }
  }

  function setOnboardingDetail(integrationType: 'kra_etims' | 'statutory_filing', field: string, value: string | boolean) {
    setOnboarding((current) => {
      const previous = current[integrationType] ?? { milestone: 'not_started', note: '', details: {} }
      return { ...current, [integrationType]: { ...previous, details: { ...previous.details, [field]: value } } }
    })
  }

  async function updateComplianceDraft(draftId: string, workflowStatus: 'draft' | 'reviewed' | 'cancelled', reviewer?: typeof reviewerDetails) {
    try {
      await request(`/v1/integrations/drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify({ workflowStatus, ...(reviewer ? { reviewerName: reviewer.name, reviewerQualification: reviewer.qualification, reviewerRegistration: reviewer.registration, reviewerReference: reviewer.reference } : {}) }) })
      const result = await request<{ drafts: ComplianceDraft[] }>('/v1/integrations/drafts'); setComplianceDrafts(result.drafts)
      notify('Internal draft workflow updated; no submission occurred.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update draft workflow.') }
  }

  async function submitComplianceDraft(draftId: string) {
    setBusy(true); setError('')
    try {
      const result = await request<{ submissionStatus: string; environment?: string; notice?: string }>(`/v1/integrations/drafts/${draftId}/submit`, { method: 'POST', body: '{}' })
      const drafts = await request<{ drafts: ComplianceDraft[] }>('/v1/integrations/drafts'); setComplianceDrafts(drafts.drafts)
      notify(result.notice ?? `KRA response: ${result.submissionStatus}${result.environment ? ` (${result.environment})` : ''}`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Submission is blocked.'
      setError(message.includes('outcome is unknown') ? message : `${message} No submission was sent.`)
    } finally { setBusy(false) }
  }

  async function saveKraDevice() {
    setBusy(true); setError('')
    try {
      await request('/v1/integrations/etims/device', { method: 'PUT', body: JSON.stringify(kraDeviceInput) })
      const result = await request<KraEtimsConfig>('/v1/integrations/etims/config'); setKraEtimsConfig(result)
      notify('KRA taxpayer/device information saved encrypted on the API server.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save KRA OSCU device configuration.') }
    finally { setBusy(false) }
  }

  async function initializeKraDevice() {
    setBusy(true); setError('')
    try {
      const result = await request<{ initialized: boolean; environment: string; device: KraEtimsConfig['device']; notice: string }>('/v1/integrations/etims/initialize', { method: 'POST', body: '{}' })
      setKraEtimsConfig((current) => current ? { ...current, initialized: result.initialized, device: result.device } : current)
      notify(`KRA OSCU device initialized in ${result.environment} environment.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'KRA OSCU initialization failed.') }
    finally { setBusy(false) }
  }

  async function loadKraCodes() {
    setBusy(true); setError('')
    try {
      const result = await request<{ result: Record<string, unknown> }>('/v1/integrations/etims/codes')
      setKraCodes(result.result); notify('Latest KRA code lists retrieved; map the current KRA item/tax codes before preparing an invoice.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not retrieve KRA code lists.') }
    finally { setBusy(false) }
  }

  async function saveKraFiscalPayload(draftId: string) {
    setBusy(true); setError('')
    try {
      const fiscalPayload = JSON.parse(kraPayloadEditors[draftId] ?? '{}') as unknown
      await request(`/v1/integrations/etims/drafts/${draftId}/fiscal-payload`, { method: 'PUT', body: JSON.stringify(fiscalPayload) })
      const result = await request<{ drafts: ComplianceDraft[] }>('/v1/integrations/drafts'); setComplianceDrafts(result.drafts)
      notify('Fiscal payload validated and saved for KRA review. No KRA request was sent.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Fiscal payload must be valid KRA OSCU JSON with reconciled totals.') }
    finally { setBusy(false) }
  }

  function downloadComplianceDraft(draft: ComplianceDraft) {
    const blob = new Blob([JSON.stringify({ draftId: draft.id, integrationType: draft.integration_type, sourceType: draft.source_type, payloadVersion: draft.payload_version, workflowStatus: draft.workflow_status, providerStatus: draft.provider_status, createdAt: draft.created_at, payload: draft.draft_payload }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${draft.integration_type}-${draft.source_id.slice(0, 8)}-draft.json`; anchor.click()
    URL.revokeObjectURL(url)
  }

  async function calculatePayroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setPayrollEstimate(null)
    try {
      const result = await request<PayrollEstimate>('/v1/payroll/kenya/estimate', { method: 'POST', body: JSON.stringify({ grossMonthlyPay: Number(payrollInput.grossMonthlyPay), otherTaxableDeductions: Number(payrollInput.otherTaxableDeductions), otherTaxReliefs: Number(payrollInput.otherTaxReliefs) }) })
      setPayrollEstimate(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not calculate the payroll estimate.')
    } finally { setBusy(false) }
  }

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const body = { ...employeeInput, grossMonthlyPay: Number(employeeInput.grossMonthlyPay), otherTaxableDeductions: Number(employeeInput.otherTaxableDeductions), otherTaxReliefs: Number(employeeInput.otherTaxReliefs), deductions: employeeInput.deductions.map((item) => ({ ...item, amount: Number(item.amount) })) }
      await request(editingEmployeeId ? `/v1/payroll/employees/${editingEmployeeId}` : '/v1/payroll/employees', { method: editingEmployeeId ? 'PUT' : 'POST', body: JSON.stringify(body) })
      setEmployeeInput({ employeeNumber: '', fullName: '', email: '', phone: '', bankName: '', bankAccountName: '', bankAccountNumber: '', grossMonthlyPay: '', otherTaxableDeductions: '0', otherTaxReliefs: '0', deductions: [] })
      setEditingEmployeeId('')
      const result = await request<{ employees: Employee[] }>('/v1/payroll/employees')
      setEmployees(result.employees)
      setPayrollIncludedEmployeeIds((current) => {
        const activeIds = result.employees.filter((employee) => employee.active).map((employee) => employee.id)
        return current.length ? [...new Set([...current.filter((id) => activeIds.includes(id)), ...(editingEmployeeId ? [] : activeIds.filter((id) => !employees.some((employee) => employee.id === id)))])] : activeIds
      })
      notify('Encrypted employee record saved')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save employee record.') }
    finally { setBusy(false) }
  }

  function editEmployee(employee: Employee) {
    const deductions = employee.deductions ?? []
    const namedTaxableDeductions = deductions.filter((item) => item.kind === 'taxable_base').reduce((sum, item) => sum + item.amount, 0)
    const namedTaxReliefs = deductions.filter((item) => item.kind === 'tax_relief').reduce((sum, item) => sum + item.amount, 0)
    setEmployeeInput({
      employeeNumber: employee.employeeNumber,
      fullName: employee.fullName,
      email: employee.email ?? '',
      phone: employee.phone ?? '',
      bankName: employee.bankName ?? '',
      bankAccountName: employee.bankAccountName ?? '',
      bankAccountNumber: employee.bankAccountNumber ?? '',
      grossMonthlyPay: String(employee.grossMonthlyPay),
      otherTaxableDeductions: String(Math.max(0, Number(employee.otherTaxableDeductions ?? 0) - namedTaxableDeductions)),
      otherTaxReliefs: String(Math.max(0, Number(employee.otherTaxReliefs ?? 0) - namedTaxReliefs)),
      deductions: deductions.map((item) => ({ ...item, amount: String(item.amount) })),
    })
    setEditingEmployeeId(employee.id)
    setError('')
  }

  async function setEmployeeActive(employee: Employee, active: boolean) {
    setBusy(true); setError('')
    try {
      await request(`/v1/payroll/employees/${employee.id}/status`, { method: 'PATCH', body: JSON.stringify({ active }) })
      setEmployees((current) => current.map((item) => item.id === employee.id ? { ...item, active } : item))
      notify(active ? 'Employee restored to active payroll' : 'Employee archived')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update employee.') }
    finally { setBusy(false) }
  }

  async function saveWorkspaceRecord(event: FormEvent<HTMLFormElement>, type: 'customers' | 'suppliers' | 'inventory' | 'projects') {
    event.preventDefault(); setBusy(true); setError('')
    const body: Record<string, unknown> = { ...recordForm }
    if (type === 'suppliers') body.supplyItemIds = supplierItemIds.filter(Boolean)
    if (type === 'inventory' || type === 'projects') for (const key of type === 'inventory' ? ['quantity', 'cost', 'price', 'reorderPoint'] : ['budget']) body[key] = Number(body[key] || 0)
    try {
      await request(editingRecordId ? `/v1/records/${type}/${editingRecordId}` : `/v1/records/${type}`, { method: editingRecordId ? 'PUT' : 'POST', body: JSON.stringify(body) })
      const result = await request<{ records: WorkspaceRecord[] }>(`/v1/records/${type}`)
      setRecords((current) => ({ ...current, [type]: result.records })); setRecordForm({}); setEditingRecordId(''); setSupplierItemIds(['']); notify(`${type.slice(0, -1)} saved`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not save ${type.slice(0, -1)}.`) }
    finally { setBusy(false) }
  }

  async function deleteWorkspaceRecord(type: 'customers' | 'suppliers' | 'inventory' | 'projects', id: string) {
    try {
      await request(`/v1/records/${type}/${id}`, { method: 'DELETE' })
      setRecords((current) => ({ ...current, [type]: current[type].filter((record) => record.id !== id) })); notify('Record deleted')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete record.') }
  }

  async function persistDocument(file: File) {
    if (file.size > 5 * 1024 * 1024) { setError(`${file.name} exceeds the 5 MB document limit.`); return }
    setBusy(true); setError('')
    try {
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(new Error('Could not read selected file.')); reader.readAsDataURL(file)
      })
      await request('/v1/documents', { method: 'POST', body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'application/octet-stream', fileData }) })
      const result = await request<{ documents: StoredDocument[] }>('/v1/documents'); setStoredDocuments(result.documents); notify('Document stored in this business workspace')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not store document.') }
    finally { setBusy(false) }
  }

  async function downloadDocument(documentId: string) {
    try {
      const result = await request<{ fileName: string; mimeType: string; fileData: string }>(`/v1/documents/${documentId}/content`)
      const anchor = document.createElement('a'); anchor.href = `data:${result.mimeType};base64,${result.fileData}`; anchor.download = result.fileName; anchor.click()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not download document.') }
  }

  async function deleteDocument(documentId: string) {
    try {
      await request(`/v1/documents/${documentId}`, { method: 'DELETE' })
      setStoredDocuments((current) => current.filter((document) => document.id !== documentId)); notify('Document deleted from this workspace')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete document.') }
  }

  async function importBankCsv(file: File) {
    try {
      const lines = (await file.text()).split(/\r?\n/).filter(Boolean).map(parseCsvRow)
      const header = lines.shift()?.map((name) => name.toLowerCase()) ?? []
      const find = (...names: string[]) => header.findIndex((value) => names.includes(value))
      const dateIndex = find('date', 'transaction date'), descIndex = find('description', 'details', 'payee'), amountIndex = find('amount', 'value'), debitIndex = find('debit'), creditIndex = find('credit')
      if (dateIndex < 0 || descIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) throw new Error('CSV needs date, description, and amount or debit/credit columns.')
      const parsedRows = lines.map((cols) => {
        const raw = amountIndex >= 0 ? cols[amountIndex] : cols[creditIndex] && Number(cols[creditIndex]) ? cols[creditIndex] : `-${cols[debitIndex] ?? '0'}`
        const amount = Number(String(raw).replace(/[,$]/g, ''))
        const rawDate = cols[dateIndex] ?? ''
        const dateParts = rawDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
        const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : dateParts ? `${dateParts[3]}-${dateParts[2].padStart(2, '0')}-${dateParts[1].padStart(2, '0')}` : ''
        if (!Number.isFinite(amount) || amount === 0 || !date || !cols[descIndex]) return null
        return { date, description: cols[descIndex], amount: String(Math.abs(amount)), direction: amount > 0 ? 'income' as const : 'expense' as const }
      }).filter((row): row is NonNullable<typeof row> => row !== null)
      setBankImportRows(parsedRows)
      if (!parsedRows.length) setError('No valid statement rows found. Use YYYY-MM-DD dates and non-zero amounts.')
      else notify(`${parsedRows.length} statement rows ready for review; none have been posted`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read bank statement CSV.') }
  }

  async function postBankImport() {
    setBusy(true); setError('')
    try {
      await request('/v1/bank-imports', { method: 'POST', body: JSON.stringify({ rows: bankImportRows.map((row) => ({ ...row, amount: Number(row.amount) })) }) })
      setBankImportRows([]); await refresh(); notify('Reviewed statement rows posted to transactions and ledger')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Statement import stopped; check saved transactions before retrying.') }
    finally { setBusy(false) }
  }

  async function refreshBanking() {
    const [accountsResult, transactionsResult] = await Promise.all([
      request<{ accounts: ConnectedBankAccount[] }>('/v1/banking/accounts'),
      request<{ transactions: BankFeedTransaction[] }>('/v1/banking/transactions?status=needs_review'),
    ])
    setConnectedBankAccounts(accountsResult.accounts); setBankFeedTransactions(transactionsResult.transactions)
  }

  async function refreshReconciliations() {
    const result = await request<{ reconciliations: Reconciliation[] }>('/v1/accounting/reconciliations')
    setReconciliations(result.reconciliations)
  }

  async function createReconciliation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await request<{ reconciliation: Reconciliation }>('/v1/accounting/reconciliations', { method: 'POST', body: JSON.stringify({ ...reconciliationInput, openingBalance: Number(reconciliationInput.openingBalance), statementEndingBalance: Number(reconciliationInput.statementEndingBalance) }) })
      await refreshReconciliations(); await openReconciliation(result.reconciliation.id); notify('Reconciliation started; match cleared transactions to continue.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start reconciliation.') }
    finally { setBusy(false) }
  }

  async function openReconciliation(reconciliationId: string) {
    try {
      const result = await request<ReconciliationDetail>(`/v1/accounting/reconciliations/${reconciliationId}`)
      setReconciliationDetail(result)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load reconciliation.') }
  }

  async function setReconciliationMatch(transactionId: string, matched: boolean) {
    if (!reconciliationDetail) return
    setBusy(true); setError('')
    try {
      await request(`/v1/accounting/reconciliations/${reconciliationDetail.reconciliation.id}/matches/${transactionId}`, { method: 'PUT', body: JSON.stringify({ matched }) })
      await openReconciliation(reconciliationDetail.reconciliation.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update reconciliation match.') }
    finally { setBusy(false) }
  }

  async function completeReconciliation() {
    if (!reconciliationDetail) return
    setBusy(true); setError('')
    try {
      await request(`/v1/accounting/reconciliations/${reconciliationDetail.reconciliation.id}/complete`, { method: 'POST', body: '{}' })
      await openReconciliation(reconciliationDetail.reconciliation.id); await refreshReconciliations(); notify('Reconciliation completed and recorded in the audit log.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Reconciliation could not be completed.') }
    finally { setBusy(false) }
  }

  async function linkMonoBank() {
    if (!monoConfig?.enabled || !monoConfig.publicKey) { setError('Mono bank feeds are not configured on the API service yet.'); return }
    const customerName = monoCustomerName.trim() || dashboard?.workspaceName.trim() || ''
    const customerEmail = monoCustomerEmail.trim() || (account?.user.email.includes('@') ? account.user.email : '')
    if (!customerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) { setError('Enter the account holder name and a valid contact email in the details above.'); return }
    setError('')
    try {
      const { default: MonoConnect } = await import('@mono.co/connect.js')
      const connect = new MonoConnect({
        key: monoConfig.publicKey,
        scope: 'auth',
        data: { customer: { name: customerName, email: customerEmail } },
        reference: `kashflow-${account?.workspace.id}-${Date.now()}`,
        onSuccess: async ({ code }) => {
          if (!code) { setError('Mono Connect did not return an authorization code.'); return }
          setBusy(true)
          try {
            await request('/v1/banking/mono/link', { method: 'POST', body: JSON.stringify({ code }) })
            await refreshBanking(); notify('Bank account connected through Mono; imported rows are ready for review.')
          } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not complete Mono account linking.') }
          finally { setBusy(false) }
        },
        onClose: () => notify('Bank-linking flow closed'),
      })
      connect.setup(); connect.open()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not launch Mono Connect.') }
  }

  async function syncConnectedBank(accountId: string) {
    setBusy(true); setError('')
    try {
      await request(`/v1/banking/accounts/${accountId}/sync`, { method: 'POST', body: '{}' })
      await refreshBanking(); notify('Bank feed synchronized; new rows are available for review.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not synchronize bank transactions.') }
    finally { setBusy(false) }
  }

  async function reviewBankFeedTransaction(transactionId: string, action: 'post' | 'ignore') {
    setBusy(true); setError('')
    try {
      await request(`/v1/banking/transactions/${transactionId}/review`, { method: 'POST', body: JSON.stringify({ action }) })
      await refreshBanking()
      if (action === 'post') await refresh()
      notify(action === 'post' ? 'Reviewed transaction posted to the ledger.' : 'Transaction marked ignored.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update bank-feed transaction.') }
    finally { setBusy(false) }
  }

  async function createPayrollRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (!payrollIncludedEmployeeIds.length) throw new Error('Choose at least one employee to include in this payroll run.')
      const result = await request<{ run: PayrollRun }>('/v1/payroll/runs', { method: 'POST', body: JSON.stringify({
        period: payrollPeriod,
        employeeIds: payrollIncludedEmployeeIds,
        bonuses: payrollIncludedEmployeeIds.map((employeeId) => ({ employeeId, amount: Number(payrollBonuses[employeeId] || 0) })),
      }) })
      setPayrollRuns((current) => [result.run, ...current.filter((run) => run.id !== result.run.id)])
      const payslipResult = await request<{ payslips: typeof payslips }>(`/v1/payroll/runs/${result.run.id}/payslips`)
      setPayslips(payslipResult.payslips)
      notify('Draft payroll created with the selected employees and bonuses; review the line-by-line estimates before posting.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create payroll run.') }
    finally { setBusy(false) }
  }

  async function postPayroll(runId: string) {
    setBusy(true); setError('')
    try {
      await request(`/v1/payroll/runs/${runId}/post`, { method: 'POST', body: '{}' })
      const [runResult, remittanceResult] = await Promise.all([request<{ runs: PayrollRun[] }>('/v1/payroll/runs'), request<{ remittances: Remittance[] }>('/v1/payroll/remittances')])
      setPayrollRuns(runResult.runs); setRemittances(remittanceResult.remittances); notify('Payroll posted to the general ledger')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not post payroll.') }
    finally { setBusy(false) }
  }

  async function markPayrollPaid(runId: string) {
    setBusy(true); setError('')
    try {
      const payment = payrollPaymentInputs[runId]
      if (!payment?.paymentReference.trim()) throw new Error('Enter the reference from the external payment confirmation.')
      const run = payrollRuns.find((item) => item.id === runId)
      if (!run) throw new Error('Payroll run could not be found. Refresh the page and try again.')
      await request(`/v1/payroll/runs/${runId}/pay`, { method: 'POST', body: JSON.stringify({ amount: Number(payment.amount || run.outstanding_total || run.net_total), paymentReference: payment.paymentReference, paymentDate: today }) })
      const runs = await request<{ runs: PayrollRun[] }>('/v1/payroll/runs'); setPayrollRuns(runs.runs); await refresh()
      setPayrollPaymentInputs((current) => ({ ...current, [runId]: { amount: '', paymentReference: '' } }))
      notify('Externally confirmed payroll payment recorded; any unpaid balance remains a payroll payable.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not record payroll payment.') }
    finally { setBusy(false) }
  }

  async function loadPayslips(runId: string) {
    setError('')
    try { const result = await request<{ payslips: typeof payslips }>(`/v1/payroll/runs/${runId}/payslips`); setPayslips(result.payslips) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load payslips.') }
  }

  async function recordRemittance(remittanceId: string) {
    const paymentReference = window.prompt('Enter the external payment reference. This records it only; it does not pay the authority.')
    if (!paymentReference?.trim()) return
    setBusy(true); setError('')
    try {
      await request(`/v1/payroll/remittances/${remittanceId}/record-payment`, { method: 'POST', body: JSON.stringify({ paymentReference }) })
      const result = await request<{ remittances: Remittance[] }>('/v1/payroll/remittances'); setRemittances(result.remittances); notify('Remittance reference recorded')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not record remittance reference.') }
    finally { setBusy(false) }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await request('/v1/settings', { method: 'PUT', body: JSON.stringify({ ...settings, businessName: settings.businessName || dashboard?.workspaceName }) })
      await refresh()
      notify('Settings saved successfully')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save settings.')
    } finally { setBusy(false) }
  }

  async function exportWorkspaceData(type: string) {
    setExportBusy(true); setError('')
    try {
      const response = await fetch(`${API_BASE}/v1/exports/${encodeURIComponent(type)}`, { credentials: 'include' })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || `Export failed (${response.status})`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `kashflow-${type}-${today}.csv`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      notify(`${type[0].toUpperCase()}${type.slice(1)} CSV downloaded.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not export workspace data.')
    } finally { setExportBusy(false) }
  }

  async function shareInvoice(invoiceRow: InvoiceRecord) {
    setBusy(true); setError('')
    try {
      const result = await request<{ link: { url: string; expiresAt: string } }>(`/v1/invoices/${invoiceRow.id}/customer-link`, { method: 'POST', body: '{}' })
      try {
        await navigator.clipboard.writeText(result.link.url)
        notify('Secure invoice link copied. It expires in 30 days.')
      } catch {
        setError(`Copy this secure invoice link before sharing: ${result.link.url}`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the customer invoice link.')
    } finally { setBusy(false) }
  }

  async function sendInvoiceReminder(invoiceRow: InvoiceRecord) {
    setBusy(true); setError('')
    try {
      const result = await request<{ message: string }>(`/v1/invoices/${invoiceRow.id}/reminders`, { method: 'POST', body: '{}' })
      notify(result.message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send the invoice reminder.')
    } finally { setBusy(false) }
  }

  async function loadAuditEvents() {
    setBusy(true); setError('')
    try {
      const result = await request<{ events: AuditEvent[] }>('/v1/accounting/audit-events')
      setAuditEvents(result.events)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load the audit log.')
    } finally { setBusy(false) }
  }

  async function loadDatabaseBackups() {
    setBusy(true); setError(''); setBackupStatus('')
    try {
      if (!backupOperatorToken) throw new Error('Enter the platform backup operator token.')
      const result = await request<{ backups: DatabaseBackup[] }>('/v1/platform/backups', { headers: { Authorization: `Bearer ${backupOperatorToken}` } })
      setDatabaseBackups(result.backups)
      setBackupStatus(`Connected. ${result.backups.length} retained hourly snapshot(s) found.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load platform backups.') }
    finally { setBusy(false) }
  }

  async function createDatabaseBackupNow() {
    setBusy(true); setError(''); setBackupStatus('')
    try {
      if (!backupOperatorToken) throw new Error('Enter the platform backup operator token.')
      const result = await request<{ backup: { key: string; createdAt: string } }>('/v1/platform/backups', { method: 'POST', headers: { Authorization: `Bearer ${backupOperatorToken}` }, body: '{}' })
      setBackupStatus(`Backup saved: ${result.backup.key} (${new Date(result.backup.createdAt).toLocaleString('en-KE')}).`)
      await loadDatabaseBackups()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create a database backup.') }
    finally { setBusy(false) }
  }

  async function restoreDatabaseBackupNow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setBackupStatus('')
    try {
      if (!backupOperatorToken) throw new Error('Enter the platform backup operator token.')
      if (restoreConfirmation !== 'RESTORE THE ENTIRE DATABASE') throw new Error('Enter the exact restore confirmation phrase.')
      const result = await request<{ restoredKey: string; safetyBackupKey: string }>('/v1/platform/backups/restore', {
        method: 'POST',
        headers: { Authorization: `Bearer ${backupOperatorToken}` },
        body: JSON.stringify({ key: restoreBackupKey, confirmation: restoreConfirmation }),
      })
      setRestoreConfirmation('')
      setBackupStatus(`Restored archived database objects from ${result.restoredKey}. Pre-restore safety snapshot: ${result.safetyBackupKey}. Restart the normal deployment, apply migrations, and verify business data before resuming traffic.`)
      await loadDatabaseBackups()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore the database backup.') }
    finally { setBusy(false) }
  }

  async function previewRecordImport(file: File) {
    setBusy(true); setError(''); setRecordImportPreview(null); setRecordImportRows([])
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a CSV file no larger than 5 MB.')
      const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim())
      if (lines.length < 2 || lines.length > 501) throw new Error('CSV must include a header and between 1 and 500 data rows.')
      const headers = parseCsvRow(lines[0] ?? []).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''))
      const allowed: Record<ImportType, string[]> = {
        customers: ['name', 'email', 'phone', 'address', 'taxpin', 'notes'],
        suppliers: ['name', 'email', 'phone', 'address', 'taxpin', 'notes'],
        inventory: ['name', 'sku', 'barcode', 'reorderpoint', 'quantity', 'unit', 'cost', 'price', 'notes'],
        projects: ['name', 'customer', 'status', 'startdate', 'enddate', 'budget', 'notes'],
      }
      const headerNames: Record<string, string> = { taxpin: 'taxPin', reorderpoint: 'reorderPoint', startdate: 'startDate', enddate: 'endDate' }
      const selectedColumns = headers.map((header) => allowed[recordImportType].includes(header) ? (headerNames[header] ?? header) : '')
      if (!selectedColumns.includes('name')) throw new Error('CSV needs a name column. Use the field names shown in the import guide.')
      const rows = lines.slice(1).map((line) => {
        const values = parseCsvRow(line)
        return Object.fromEntries(selectedColumns.flatMap((column, index) => column ? [[column, values[index] ?? '']] : []))
      })
      const result = await request<{ preview: RecordImportPreview }>(`/v1/imports/records/${recordImportType}`, { method: 'POST', body: JSON.stringify({ rows, commit: false }) })
      setRecordImportRows(rows)
      setRecordImportPreview(result.preview)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not preview this CSV import.')
    } finally { setBusy(false) }
  }

  async function commitRecordImport() {
    if (!recordImportPreview || !recordImportRows.length) return
    setBusy(true); setError('')
    try {
      const result = await request<{ imported: number; message: string }>(`/v1/imports/records/${recordImportPreview.type}`, { method: 'POST', body: JSON.stringify({ rows: recordImportRows, commit: true }) })
      const refreshed = await request<{ records: WorkspaceRecord[] }>(`/v1/records/${recordImportPreview.type}`)
      setRecords((current) => ({ ...current, [recordImportPreview.type]: refreshed.records }))
      setRecordImportRows([]); setRecordImportPreview(null)
      notify(result.message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not import these records.')
    } finally { setBusy(false) }
  }

  async function refreshAccounting() {
    const [trial, journal, periods, statements] = await Promise.all([
      request<{ accounts: AccountSummary[]; totals: { debit: string; credit: string } }>('/v1/accounting/trial-balance'),
      request<{ entries: typeof journalEntries }>('/v1/accounting/journals'),
      request<{ periods: AccountingPeriod[] }>('/v1/accounting/periods'),
      request<FinancialStatements>(`/v1/accounting/reports/financial-statements?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`),
    ])
    setAccounts(trial.accounts); setTrialTotals(trial.totals); setJournalEntries(journal.entries); setAccountingPeriods(periods.periods); setFinancialStatements(statements)
  }

  async function runFinancialStatements(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const result = await request<FinancialStatements>(`/v1/accounting/reports/financial-statements?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`)
      setFinancialStatements(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not prepare financial statements.')
    } finally { setBusy(false) }
  }

  async function closeAccountingPeriod(period: string) {
    if (!window.confirm(`Close ${period}? New journal postings in this month will be blocked.`)) return
    setBusy(true); setError('')
    try { await request(`/v1/accounting/periods/${period}/close`, { method: 'POST', body: '{}' }); await refreshAccounting(); notify(`${period} closed`) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not close accounting period.') }
    finally { setBusy(false) }
  }

  async function reopenAccountingPeriod(period: string) {
    setBusy(true); setError('')
    try { await request(`/v1/accounting/periods/${period}/reopen`, { method: 'POST', body: '{}' }); await refreshAccounting(); notify(`${period} reopened`) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not reopen accounting period.') }
    finally { setBusy(false) }
  }

  async function reverseJournalEntry(entry: (typeof journalEntries)[number]) {
    const date = window.prompt('Enter the date for the correcting reversal (YYYY-MM-DD).', today)
    if (!date) return
    const reason = window.prompt('Why is this journal being corrected? A reversal is immutable; post a replacement journal separately.')
    if (!reason?.trim()) return
    setBusy(true); setError('')
    try {
      await request(`/v1/accounting/journals/${entry.id}/reverse`, { method: 'POST', body: JSON.stringify({ date, reason }) })
      await refreshAccounting()
      notify('Journal reversed with a linked, balanced correcting entry. Post a separate replacement journal if needed.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not reverse journal entry.') }
    finally { setBusy(false) }
  }

  const payrollMoney = (value: number) => `KSh ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const helpResources = useMemo(() => [
    { title: 'Create an admin account', category: 'Setup', keywords: ['admin', 'create account', 'business name', 'signup', 'register', 'sign up'] },
    { title: 'Add a transaction', category: 'Accounting', keywords: ['transaction', 'income', 'expense', 'ledger', 'money', 'bookkeeping'] },
    { title: 'Create an invoice', category: 'Sales', keywords: ['invoice', 'customer', 'payment', 'sales', 'bill', 'receipt'] },
    { title: 'Manage payroll', category: 'Payroll', keywords: ['payroll', 'employee', 'salary', 'payslip', 'nhif', 'nssf', 'shif', 'tax'] },
    { title: 'Business settings', category: 'Settings', keywords: ['settings', 'business name', 'currency', 'timezone', 'notifications', 'audit trail', 'security'] },
    { title: 'Upload receipts and bank statements', category: 'Documents', keywords: ['receipt', 'bank statement', 'attachment', 'file upload', 'document', 'csv', 'upload'] },
  ], [])

  const helpResults = useMemo(() => {
    const query = helpSearch.trim().toLowerCase()
    if (!query) return helpResources.slice(0, 6)
    return helpResources.filter((item) => `${item.title} ${item.category} ${item.keywords.join(' ')}`.toLowerCase().includes(query))
  }, [helpResources, helpSearch])

  const filtered = useMemo(() => (dashboard?.transactions ?? []).filter((row) =>
    `${row.description} ${row.account} ${row.direction}`.toLowerCase().includes(search.toLowerCase())), [dashboard, search])
  const posItems = useMemo(() => records.inventory.filter((item) => {
    const query = posSearch.trim().toLowerCase()
    const stock = Number(inventoryLocationStock.find((row) => row.location_id === posLocationId && row.item_id === item.id)?.quantity ?? 0)
    return stock > 0 && (!query || `${item.data.name ?? ''} ${item.data.sku ?? ''} ${item.data.barcode ?? ''} ${item.data.notes ?? ''}`.toLowerCase().includes(query))
  }), [records.inventory, inventoryLocationStock, posLocationId, posSearch])
  const posTotal = posCart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
  const chart = useMemo(() => (dashboard?.cashflow ?? []).map((row) => ({
    date: new Date(`${row.date}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }),
    income: Number(row.income), expense: Number(row.expense),
  })), [dashboard])
  const mpesaStatus = integrationReadiness?.integrations.find((item) => item.id === 'mpesa')?.status ?? 'daraja_credentials_and_callback_required'
  const mpesaConfigured = mpesaStatus.startsWith('configured_')
  const emailStatus = integrationReadiness?.integrations.find((item) => item.id === 'email')?.status ?? 'resend_api_key_and_verified_sender_required'
  const emailConfigured = emailStatus === 'resend_configured'
  const bankFeedStatus = integrationReadiness?.integrations.find((item) => item.id === 'bank_feeds')?.status ?? 'mono_business_approval_and_server_keys_required'
  const monoConfigured = bankFeedStatus === 'mono_configured_consent_required'

  if (starting) return <div className="auth-screen"><div className="auth-card"><Brand /><p>Connecting securely to your workspace…</p></div></div>

  if (!account) return <div className="auth-screen">
    <form className="auth-card" onSubmit={submitAuth}>
      <Brand />
      <p className="auth-intro">{showSetupFlow ? 'Create a business workspace and become its administrator.' : 'Sign in to your business workspace.'}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {showSetupFlow && <label className="field-label">Business name
        <input required maxLength={120} value={credentials.businessName} onChange={(event) => setCredentials({ ...credentials, businessName: event.target.value })} />
      </label>}
      <label className="field-label">Email or phone number
        <input type="text" required autoComplete={showSetupFlow ? 'username' : 'username'} value={credentials.identifier} onChange={(event) => setCredentials({ ...credentials, identifier: event.target.value })} />
      </label>
      <label className="field-label">Password
        <input type="password" required minLength={showSetupFlow ? 12 : 1} autoComplete={showSetupFlow ? 'new-password' : 'current-password'} value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} />
        {showSetupFlow && <small>Use at least 12 characters.</small>}
      </label>
      <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : showSetupFlow ? 'Create business account' : 'Sign in'}</button>
      {!showSetupFlow && (
        <p className="auth-cta-wrap">
          <button type="button" className="auth-link" onClick={() => setShowSetupFlow(true)}>
            {bootstrapAvailable ? 'Create admin account' : 'Create a new business admin account'}
          </button>
        </p>
      )}
      {showSetupFlow && (
        <p style={{ marginTop: '12px', textAlign: 'center' }}>
          <button type="button" style={{ background: 'transparent', border: 'none', color: '#5f46ca', fontWeight: 600, cursor: 'pointer', padding: 0 }} onClick={() => setShowSetupFlow(false)}>
            Use sign in instead
          </button>
        </p>
      )}
      <p className="auth-note">New business owners can create a separate workspace with their own admin login. Your records are stored in the connected database. External provider connections are not enabled by sign-up.</p>
    </form>
  </div>

  const periodLabel = overviewRangeNames[overviewRange]
  const activePayrollEmployees = employees.filter((employee) => employee.active)
  const selectedPayrollEmployees = activePayrollEmployees.filter((employee) => payrollIncludedEmployeeIds.includes(employee.id))
  const selectedPayrollSalaryTotal = selectedPayrollEmployees.reduce((sum, employee) => sum + Number(employee.grossMonthlyPay), 0)
  const selectedPayrollBonusTotal = selectedPayrollEmployees.reduce((sum, employee) => sum + Number(payrollBonuses[employee.id] || 0), 0)
  const metricCards = [
    { title: `Income · ${periodLabel}`, value: dashboard?.totals.income ?? '0', Icon: ArrowDownLeft, tone: 'purple-icon', destination: 'Accounting' },
    { title: `Expenses · ${periodLabel}`, value: dashboard?.totals.expenses ?? '0', Icon: ArrowUpRight, tone: 'peach-icon', destination: 'Expenses' },
    { title: `Net movement · ${periodLabel}`, value: dashboard?.totals.net ?? '0', Icon: Gauge, tone: 'blue-icon', destination: 'Accounting' },
    { title: 'Unpaid invoices', value: dashboard?.invoices.unpaid_amount ?? '0', Icon: Wallet, tone: 'mint-icon', destination: 'Sales' },
  ]

  if (window.location.pathname.startsWith('/store/') || window.location.pathname.startsWith('/portal/') || window.location.pathname.startsWith('/invoice/')) {
    return <OnlineStoreApp apiBase={API_BASE} pathname={window.location.pathname} />
  }

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="brand-row"><div className="brand-mark">K</div><div className="brand-name">Kash<span>Flow</span><small>{t('BUSINESS SUITE')}</small></div>
        <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={18} /></button>
      </div>
      <div className="company-switcher"><span className="company-avatar">{dashboard?.workspaceName.slice(0, 1).toUpperCase()}</span>
        <span className="company-copy"><strong>{dashboard?.workspaceName}</strong><small>{account?.workspaces?.length ? `${account.workspaces.length} businesses` : 'Private workspace'}</small></span>
      </div>
      <button className="nav-link bottom-link" onClick={() => { setModal('business'); setSidebarOpen(false) }}><Plus size={18} /> {t('Add business')}</button>
      <nav className="side-nav" aria-label="Main navigation">
        {groups.map((group) => <div className="nav-group" key={group.title}><p className="nav-heading">{t(group.title)}</p>
          {group.items.map(([name, Icon]) => <button key={name} className={`nav-link ${page === name ? 'active' : ''}`} onClick={() => { navigateTo(name); setSidebarOpen(false) }}>
            <Icon size={18} strokeWidth={1.8} /><span>{t(name)}</span>
          </button>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="help-card"><div className="help-icon"><ShieldCheck size={16} /></div><strong>{t('Private workspace')}</strong><p>{t('Records you enter are saved to your account database.')}</p></div>
        <div className="sidebar-utility-links" aria-label="Account and support">
          <button className={`nav-link bottom-link ${page === 'Settings' ? 'active' : ''}`} onClick={() => { teamPermissionsScrollPending.current = false; navigateTo('Settings'); setSidebarOpen(false) }}><Settings2 size={18} /> {t('Settings')}</button>
          <button className={`nav-link bottom-link ${page === 'Settings' ? 'active' : ''}`} onClick={() => { setSidebarOpen(false); if (page === 'Settings') document.getElementById('team-permissions')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); else { teamPermissionsScrollPending.current = true; navigateTo('Settings') } }}><Users size={18} /> Team &amp; Permissions</button>
          <button className={`nav-link bottom-link ${page === 'Help' ? 'active' : ''}`} onClick={() => { navigateTo('Help'); setSidebarOpen(false) }}><LifeBuoy size={18} /> {t('Help & support')}</button>
        </div>
        <div className="profile-row"><div className="profile-avatar">{account.user.email.slice(0, 1).toUpperCase()}</div>
          <div className="profile-copy"><strong>{account.user.email}</strong><small>{account.workspaces?.length ? `Business admin • ${account.workspaces.length} businesses` : 'Workspace admin'}</small></div>
          <button className="icon-button" onClick={() => void logout()} aria-label="Sign out"><LogOut size={16} /></button>
        </div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
        <div className="breadcrumbs"><span>{dashboard?.workspaceName}</span><ChevronRight size={14} /><strong>{t(page)}</strong><span className="demo-tag">{t('SAVED WORKSPACE DATA')}</span></div>
        <div className="topbar-actions">
          <label className="language-picker"><span>{t('Language')}</span><select aria-label={t('Language')} value={language} onChange={(event) => setLanguage(event.target.value as LanguageCode)}>{languages.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label className="search-box"><Search size={16} /><input aria-label="Search saved transactions" placeholder="Search records, settings, or help..." value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
          <button className="icon-button notification-button" aria-label="Workspace status" onClick={() => setStatusOpen((open) => !open)}><Bell size={18} /></button>
          <button className="top-help" onClick={() => navigateTo('Help')}><CircleHelp size={17} /><span>Help</span></button>
        </div>
        {statusOpen && <div className="notification-popover"><strong>{mpesaConfigured ? 'Daraja STK Push configured' : 'No external services connected'}</strong><p>Saved records are available in this workspace. KRA/eTIMS, bank feeds, and statutory filing remain inactive; verify any M-Pesa payment with Daraja and your merchant statement.</p><button onClick={() => setStatusOpen(false)}>Close</button></div>}
      </header>

      <div className="content-wrap">
        {page !== 'Overview' && <div className="page-navigation"><button className="button button-secondary" onClick={navigateBack}><ArrowLeft size={15} /> Back</button></div>}
        {page === 'Overview' ? <>
          <section className="welcome-row"><div><div className="eyebrow"><span className="live-dot" /> PRIVATE WORKSPACE</div>
            <h1>{dashboard?.workspaceName}</h1><p className="welcome-subtitle">Review income and expense totals for the period you choose.</p>
          </div><div className="welcome-actions">
            <button className="button button-secondary" onClick={() => { setError(''); setModal('transaction') }}><Plus size={16} /> {t('Add transaction')}</button>
            <button className="button button-primary" onClick={() => { setError(''); setPaymentPhone(''); setModal('invoice') }}><Plus size={17} /> {t('Create invoice')}</button>
            <button className="button button-secondary" onClick={() => { setError(''); setInviteLink(''); setModal('invite') }}><Users size={16} /> {t('Invite member')}</button>
          </div></section>

          <section className="overview-period-toolbar" aria-label="Overview date range">
            <label className="field-label">Overview period
              <select value={overviewRange} disabled={overviewLoading} onChange={(event) => {
                const range = event.target.value as OverviewRange
                if (range === 'custom') setOverviewRange(range)
                else void loadOverviewPeriod(range)
              }}>
                {(Object.entries(overviewRangeNames) as Array<[OverviewRange, string]>).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            {overviewRange === 'custom' && <><label className="field-label">From<input type="date" max={overviewTo || today} value={overviewFrom} onChange={(event) => setOverviewFrom(event.target.value)} /></label><label className="field-label">To<input type="date" min={overviewFrom} max={today} value={overviewTo} onChange={(event) => setOverviewTo(event.target.value)} /></label><button className="button button-primary overview-apply" disabled={overviewLoading || !overviewFrom || !overviewTo || overviewFrom > overviewTo} onClick={() => void loadOverviewPeriod('custom')}>{overviewLoading ? 'Updating…' : 'Apply dates'}</button></>}
            <span className="overview-period-caption">{dashboard?.period ? `${dashboard.period.from} – ${dashboard.period.to}` : 'Loading selected period…'}</span>
          </section>
          {error && <p className="form-error" role="alert">{error}</p>}
          <section className="metric-grid" aria-label="Saved business totals for selected period">
            {metricCards.map(({ title, value, Icon, tone, destination }) =>             <button type="button" className="metric-card metric-card-link" key={title} onClick={() => navigateTo(destination)} aria-label={`${t('Open')} ${t(title)} ${t('details')}`}>
                <div className="metric-top"><span>{t(title)}</span><span className={`metric-icon ${tone}`}><Icon size={17} /></span></div>
                <div className="metric-value">{money(value)}</div><div className="metric-foot"><span>{t('View related records')} <ArrowRight size={12} /></span></div>
            </button>)}
          </section>

          <section className="panel intake-panel" aria-label="Document and bank intake">
            <div className="panel-header"><div><h2>Receipts, documents, and bank intake</h2><p>Store supporting files here; import and review CSV transactions from Banking.</p></div><span className="task-count">{storedDocuments.length}</span></div>
            <div className="upload-row">
              <label className="upload-zone">
                <span>Add receipt or invoice copy</span>
                <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ofx,.qif,.xml,.txt" multiple onChange={(event) => addAttachmentFiles(event.target.files)} />
              </label>
              <label className="upload-zone bank-zone">
                <span>Upload bank statement or CSV</span>
                <input type="file" accept=".csv,.xlsx,.xls,.ofx,.qif,.xml,image/*,.pdf" multiple onChange={(event) => addAttachmentFiles(event.target.files)} />
              </label>
            </div>
            <div className="attachment-list">
              {storedDocuments.length ? storedDocuments.map((file) => <div key={file.id} className="attachment-item">
                <div className="attachment-pill">Stored</div>
                <div className="attachment-copy"><strong>{file.file_name}</strong><small>{formatAttachmentSize(file.file_size)} · {new Date(file.created_at).toLocaleDateString('en-KE')}</small></div>
                <button className="button button-small" onClick={() => void downloadDocument(file.id)}>Download</button>
              </div>) : <div className="empty-state">No uploaded receipts, bank statements, or supporting documents yet.</div>}
            </div>
            <p className="upload-note"><ShieldCheck size={15} /> Documents are stored in the workspace database (maximum 5 MB each). Banking supports manual CSV review; automatic bank feeds, KRA eTIMS, and statutory filing require separately approved and configured providers.</p>
          </section>

          <section className="dashboard-grid">
            <article className="panel cashflow-panel">
              <div className="panel-header"><div><h2>Recorded cash flow</h2><p>Daily saved income and expenses, including recorded payroll payments</p></div>
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
              <div className="chart-footer"><span><span className="status-dot" /> Database-backed records</span><button onClick={() => navigateTo('Reports')}>View reports <ArrowRight size={14} /></button></div>
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
              <button className="task-footer" onClick={() => { setError(''); setPaymentPhone(''); setModal('invoice') }}>Create invoice <ArrowRight size={14} /></button>
            </article>
          </section>
          <footer className="page-footer"><span>© 2026 KashFlow Technologies</span><span><i className="secure-dot" /> Private workspace</span><button onClick={() => void logout()}>Sign out</button></footer>
        </> : page === 'Payroll' ? <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> PAYROLL · {dashboard?.workspaceName}</div>
          <h1>Payroll & statutory estimates</h1>
          <p className="welcome-subtitle">Manage employee and tax details, review monthly drafts, record confirmed external payments, and track any remaining payroll payable.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <article className="module-card">
            <h2>Employee records ({employees.length})</h2>
            <form onSubmit={addEmployee}>
              <div className="field-row"><label className="field-label">Employee number<input required value={employeeInput.employeeNumber} onChange={(event) => setEmployeeInput({ ...employeeInput, employeeNumber: event.target.value })} /></label><label className="field-label">Full name<input required value={employeeInput.fullName} onChange={(event) => setEmployeeInput({ ...employeeInput, fullName: event.target.value })} /></label></div>
              <div className="field-row"><label className="field-label">Email<input type="email" value={employeeInput.email} onChange={(event) => setEmployeeInput({ ...employeeInput, email: event.target.value })} /></label><label className="field-label">Phone<input type="tel" value={employeeInput.phone} onChange={(event) => setEmployeeInput({ ...employeeInput, phone: event.target.value })} /></label></div>
              <div className="field-row"><label className="field-label">Bank name<input maxLength={100} value={employeeInput.bankName} onChange={(event) => setEmployeeInput({ ...employeeInput, bankName: event.target.value })} placeholder="Optional" /></label><label className="field-label">Account holder name<input maxLength={160} value={employeeInput.bankAccountName} onChange={(event) => setEmployeeInput({ ...employeeInput, bankAccountName: event.target.value })} placeholder="Optional" /></label><label className="field-label">Bank account number<input maxLength={34} autoComplete="off" value={employeeInput.bankAccountNumber} onChange={(event) => setEmployeeInput({ ...employeeInput, bankAccountNumber: event.target.value })} placeholder="Optional" /></label></div>
              <div className="field-row"><label className="field-label">Gross monthly pay (KSh)<input required type="number" min="0.01" step="0.01" value={employeeInput.grossMonthlyPay} onChange={(event) => setEmployeeInput({ ...employeeInput, grossMonthlyPay: event.target.value })} /></label><label className="field-label">Other allowable deductions<input type="number" min="0" step="0.01" value={employeeInput.otherTaxableDeductions} onChange={(event) => setEmployeeInput({ ...employeeInput, otherTaxableDeductions: event.target.value })} /></label></div>
              <div className="deduction-editor"><div className="panel-header"><div><h3>Named employee deductions</h3><p>Choose how each amount is treated in the estimate; confirm tax treatment with a qualified payroll adviser.</p></div><button type="button" className="button button-small" onClick={() => setEmployeeInput({ ...employeeInput, deductions: [...employeeInput.deductions, { name: '', kind: 'post_tax', amount: '' }] })}><Plus size={14} /> Add deduction</button></div>
                {employeeInput.deductions.map((deduction, index) => <div className="field-row deduction-row" key={index}><label className="field-label">Deduction name<input required value={deduction.name} placeholder="e.g. Sacco contribution" onChange={(event) => setEmployeeInput({ ...employeeInput, deductions: employeeInput.deductions.map((item, row) => row === index ? { ...item, name: event.target.value } : item) })} /></label><label className="field-label">Treatment<select value={deduction.kind} onChange={(event) => setEmployeeInput({ ...employeeInput, deductions: employeeInput.deductions.map((item, row) => row === index ? { ...item, kind: event.target.value as typeof item.kind } : item) })}><option value="taxable_base">Taxable-pay adjustment</option><option value="tax_relief">Tax relief adjustment</option><option value="post_tax">Post-tax net deduction</option></select></label><label className="field-label">Amount (KSh)<input required type="number" min="0.01" step="0.01" value={deduction.amount} onChange={(event) => setEmployeeInput({ ...employeeInput, deductions: employeeInput.deductions.map((item, row) => row === index ? { ...item, amount: event.target.value } : item) })} /></label><button type="button" className="button button-small" aria-label={`Remove deduction ${index + 1}`} onClick={() => setEmployeeInput({ ...employeeInput, deductions: employeeInput.deductions.filter((_, row) => row !== index) })}>Remove</button></div>)}
              </div>
              <label className="field-label">Other tax reliefs (KSh)<input type="number" min="0" step="0.01" value={employeeInput.otherTaxReliefs} onChange={(event) => setEmployeeInput({ ...employeeInput, otherTaxReliefs: event.target.value })} /></label>
              <div className="button-row"><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : editingEmployeeId ? 'Save employee changes' : 'Save encrypted employee'}</button>{editingEmployeeId && <button type="button" className="button button-secondary" disabled={busy} onClick={() => { setEditingEmployeeId(''); setEmployeeInput({ employeeNumber: '', fullName: '', email: '', phone: '', bankName: '', bankAccountName: '', bankAccountNumber: '', grossMonthlyPay: '', otherTaxableDeductions: '0', otherTaxReliefs: '0', deductions: [] }) }}>Cancel edit</button>}</div>
            </form>
            {employees.map((employee) => <div className="transaction-row employee-record-row" key={employee.id}>
              <span><strong>{employee.fullName} {!employee.active && <span className="status-pill amber">Archived</span>}</strong><small>{employee.employeeNumber} · {payrollMoney(employee.grossMonthlyPay)}/month · {employee.email || 'No email'}{employee.phone ? ` · ${employee.phone}` : ''}</small></span>
              <div className="button-row"><button className="button button-small" disabled={busy} onClick={() => editEmployee(employee)}>Edit details</button><button className="button button-small" disabled={busy} onClick={() => void setEmployeeActive(employee, !employee.active)}>{employee.active ? 'Archive' : 'Restore'}</button></div>
            </div>)}
          </article>
          <article className="module-card">
            <h2>Payroll runs</h2>
            <form onSubmit={createPayrollRun}>
              <div className="field-row"><label className="field-label">Period<input required type="month" value={payrollPeriod} onChange={(event) => setPayrollPeriod(event.target.value)} /></label></div>
              <h3>Choose employees and add bonuses</h3>
              <p className="dialog-note">Active employees are included by default. Remove someone by unchecking Include. Bonuses are added to gross pay before the saved tax estimate is calculated.</p>
              <div className="payroll-table-scroll"><table className="payroll-line-table"><thead><tr><th>Include</th><th>Employee</th><th>Bank account</th><th>Gross salary</th><th>Bonus (KSh)</th><th>Gross total</th></tr></thead><tbody>
                {activePayrollEmployees.map((employee) => {
                  const included = payrollIncludedEmployeeIds.includes(employee.id)
                  const bonus = Number(payrollBonuses[employee.id] || 0)
                  return <tr key={employee.id}>
                    <td><label className="payroll-include"><input type="checkbox" checked={included} onChange={(event) => setPayrollIncludedEmployeeIds((current) => event.target.checked ? [...new Set([...current, employee.id])] : current.filter((id) => id !== employee.id))} /><span>Include</span></label></td>
                    <td><strong>{employee.fullName}</strong><small>{employee.employeeNumber}</small></td>
                    <td>{employee.bankAccountNumber ? <span>{employee.bankName || 'Bank'} · ****{employee.bankAccountNumber.slice(-4)}</span> : <span className="dialog-note">Not added</span>}</td>
                    <td>{payrollMoney(employee.grossMonthlyPay)}</td>
                    <td><input aria-label={`Bonus for ${employee.fullName}`} className="payroll-bonus-input" type="number" min="0" max="100000000" step="0.01" value={payrollBonuses[employee.id] ?? '0'} disabled={!included} onChange={(event) => setPayrollBonuses((current) => ({ ...current, [employee.id]: event.target.value }))} /></td>
                    <td>{payrollMoney(Number(employee.grossMonthlyPay) + (included ? bonus : 0))}</td>
                  </tr>
                })}
                {!activePayrollEmployees.length && <tr><td colSpan={6}>Add an active employee above to prepare payroll.</td></tr>}
              </tbody></table></div>
              <div className="payroll-draft-summary"><span>{selectedPayrollEmployees.length} employee(s)</span><span>Salary {payrollMoney(selectedPayrollSalaryTotal)}</span><span>Bonuses {payrollMoney(selectedPayrollBonusTotal)}</span><strong>Estimated gross {payrollMoney(selectedPayrollSalaryTotal + selectedPayrollBonusTotal)}</strong></div>
              <button className="button button-primary" disabled={busy || !selectedPayrollEmployees.length}>{busy ? 'Preparing…' : 'Create draft payroll'}</button>
            </form>
            <p className="dialog-note">Bank details are encrypted and shown here only as a masked destination; expand an employee's saved payroll details below when preparing the payment. Bank feeds are read-only and do not send payments. Record a payment only after paying employees externally and confirming it. Confirmed payroll payments appear separately in Expenses under Payroll.</p>
            {payrollRuns.map((run) => {
              const outstanding = Number(run.outstanding_total ?? Math.max(0, Number(run.net_total) - Number(run.paid_total ?? (run.status === 'paid' ? run.net_total : 0))))
              const paid = Number(run.paid_total ?? (run.status === 'paid' ? run.net_total : 0))
              const paymentInput = payrollPaymentInputs[run.id]
              return <div className="payroll-run-row" key={run.id}>
                <div className="transaction-row"><span><strong>{run.period} · {run.status.replace('_', ' ')}</strong><small>{run.employee_count} employees · gross {money(run.gross_total)} · net {money(run.net_total)} · PAYE {money(run.paye_total)}</small><small>Paid {money(paid)} · outstanding payroll payable {money(outstanding)}</small></span><div className="button-row"><button className="button button-small" onClick={() => void loadPayslips(run.id)}>Payslips</button>{run.status === 'draft' && <button className="button button-small" disabled={busy} onClick={() => void postPayroll(run.id)}>Review & post</button>}{run.status !== 'draft' && <button className="button button-small" disabled={busy || complianceDrafts.some((draft) => draft.integration_type === 'statutory_filing' && draft.source_id === run.id)} onClick={() => void createComplianceDraft('statutory_filing', run.id)}>Prepare filing draft</button>}</div></div>
                {(run.status === 'posted' || run.status === 'partially_paid') && <div className="payroll-payment-entry">
                  <label className="field-label">Confirmed payment (KSh)<input aria-label={`Confirmed payment amount for ${run.period}`} required type="number" min="0.01" max={outstanding.toFixed(2)} step="0.01" value={paymentInput?.amount ?? outstanding.toFixed(2)} onChange={(event) => setPayrollPaymentInputs((current) => ({ ...current, [run.id]: { amount: event.target.value, paymentReference: current[run.id]?.paymentReference ?? '' } }))} /></label>
                  <label className="field-label">External bank/cash reference<input aria-label={`External payment reference for ${run.period}`} required maxLength={120} value={paymentInput?.paymentReference ?? ''} onChange={(event) => setPayrollPaymentInputs((current) => ({ ...current, [run.id]: { amount: current[run.id]?.amount ?? outstanding.toFixed(2), paymentReference: event.target.value } }))} /></label>
                  <button className="button button-primary" disabled={busy || outstanding <= 0} onClick={() => void markPayrollPaid(run.id)}>Record confirmed payment</button>
                </div>}
              </div>
            })}
            {payslips.length > 0 && <div className="payroll-table-scroll"><h3>Employee payroll details · {payslips[0].period}</h3><table className="payroll-line-table payroll-payslip-table"><thead><tr><th>Employee / bank</th><th>Gross salary</th><th>Bonus</th><th>PAYE</th><th>NSSF</th><th>SHIF</th><th>AHL</th><th>Other deductions</th><th>Net pay</th></tr></thead><tbody>
              {payslips.map((slip) => {
                const postTaxDeductions = slip.employee.deductions?.filter((item) => item.kind === 'post_tax').reduce((sum, item) => sum + Number(item.amount), 0) ?? 0
                return <tr key={slip.id}>
                  <td><strong>{slip.employee.fullName}</strong><small>{slip.employee.employeeNumber}</small>{slip.employee.bankAccountNumber && <details className="payroll-bank-details"><summary>{slip.employee.bankName || 'Bank'} · ****{slip.employee.bankAccountNumber.slice(-4)}</summary><small>{slip.employee.bankAccountName || slip.employee.fullName}<br />{slip.employee.bankAccountNumber}</small></details>}</td>
                  <td>{payrollMoney(Number(slip.employee.grossMonthlyPay))}</td><td>{payrollMoney(slip.bonusAmount ?? 0)}</td>
                  <td>{payrollMoney(slip.estimate.payeEstimate)}</td><td>{payrollMoney(slip.estimate.nssfEmployee)}</td><td>{payrollMoney(slip.estimate.shifEmployee)}</td><td>{payrollMoney(slip.estimate.housingLevyEmployee)}</td>
                  <td>{payrollMoney(postTaxDeductions)}</td><td><strong>{payrollMoney(slip.estimate.netPayEstimate)}</strong></td>
                </tr>
              })}
            </tbody></table></div>}
          </article>
          <article className="module-card"><h2>Statutory remittances (reference tracking only)</h2><p>Record a payment reference after paying the authority through its official channel. KashFlow does not submit returns or transfer remittances.</p>{remittances.map((item) => <div className="transaction-row" key={item.id}><span><strong>{item.remittance_type.toUpperCase()} · {item.status}</strong><small>{money(item.amount)}</small></span>{item.status === 'due' && <button className="button button-small" onClick={() => void recordRemittance(item.id)}>Record external payment</button>}</div>)}</article>
          <article className="module-card"><h2>Ad-hoc payroll estimate (not saved)</h2><form onSubmit={calculatePayroll}>
            <div className="field-row"><label className="field-label">Gross monthly pay (KSh)<input required type="number" min="0" step="0.01" value={payrollInput.grossMonthlyPay} onChange={(event) => setPayrollInput({ ...payrollInput, grossMonthlyPay: event.target.value })} /></label><label className="field-label">Other allowable deductions<input type="number" min="0" step="0.01" value={payrollInput.otherTaxableDeductions} onChange={(event) => setPayrollInput({ ...payrollInput, otherTaxableDeductions: event.target.value })} /></label></div>
            <label className="field-label">Other tax reliefs<input type="number" min="0" step="0.01" value={payrollInput.otherTaxReliefs} onChange={(event) => setPayrollInput({ ...payrollInput, otherTaxReliefs: event.target.value })} /></label><button className="button button-secondary" disabled={busy}>Calculate one-person estimate</button>
          </form>{payrollEstimate && <div className="invoice-summary"><strong>{payrollEstimate.ruleSet} · effective {payrollEstimate.effectiveFrom}</strong><p>PAYE {payrollMoney(payrollEstimate.payeEstimate)} · NSSF {payrollMoney(payrollEstimate.nssfEmployee)} · SHIF {payrollMoney(payrollEstimate.shifEmployee)} · AHL {payrollMoney(payrollEstimate.housingLevyEmployee)} · net {payrollMoney(payrollEstimate.netPayEstimate)}</p></div>}</article>
          <div className="module-footnote"><ShieldCheck size={16} /> Employee and payslip fields are encrypted at rest with PAYROLL_DATA_ENCRYPTION_KEY and accessible only to workspace admins. The KE-2026-01 calculations remain unverified estimates; a qualified Kenyan payroll professional must review them before use. This is not statutory filing.</div>
        </section> : page === 'Accounting' ? <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> DOUBLE-ENTRY LEDGER · {dashboard?.workspaceName}</div><h1>Accounting</h1><p className="welcome-subtitle">Posted manual transactions, invoices, and payroll runs create balanced, immutable journal entries.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <article className="module-card"><div className="panel-header"><div><h2>Financial statements</h2><p>Built from posted journal entries in this workspace.</p></div></div>
            <form className="record-form-grid statement-filters" onSubmit={runFinancialStatements}><label className="field-label">Income statement from<input required type="date" value={reportFrom} max={reportTo} onChange={(event) => setReportFrom(event.target.value)} /></label><label className="field-label">Through<input required type="date" value={reportTo} min={reportFrom} onChange={(event) => setReportTo(event.target.value)} /></label><button className="button button-primary" disabled={busy}>{busy ? 'Preparing…' : 'Run reports'}</button></form>
            {financialStatements && <div className="statement-grid">
              <section className="statement-panel"><h3>Income statement</h3><p className="statement-caption">{financialStatements.from} to {financialStatements.to}</p>
                <h4>Income</h4>{financialStatements.incomeStatement.income.map((line) => <div className="statement-line" key={`income-${line.code}`}><span>{line.name}</span><strong>{money(line.amount)}</strong></div>)}<div className="statement-total"><span>Total income</span><strong>{money(financialStatements.incomeStatement.totalIncome)}</strong></div>
                <h4>Expenses</h4>{financialStatements.incomeStatement.expenses.map((line) => <div className="statement-line" key={`expense-${line.code}`}><span>{line.name}</span><strong>{money(line.amount)}</strong></div>)}<div className="statement-total"><span>Total expenses</span><strong>{money(financialStatements.incomeStatement.totalExpenses)}</strong></div>
                <div className="statement-grand-total"><span>Net income</span><strong>{money(financialStatements.incomeStatement.netIncome)}</strong></div>
              </section>
              <section className="statement-panel"><h3>Balance sheet</h3><p className="statement-caption">As of {financialStatements.balanceSheet.asOf}</p>
                <h4>Assets</h4>{financialStatements.balanceSheet.assets.map((line) => <div className="statement-line" key={`asset-${line.code}`}><span>{line.name}</span><strong>{money(line.amount)}</strong></div>)}<div className="statement-total"><span>Total assets</span><strong>{money(financialStatements.balanceSheet.totalAssets)}</strong></div>
                <h4>Liabilities</h4>{financialStatements.balanceSheet.liabilities.map((line) => <div className="statement-line" key={`liability-${line.code}`}><span>{line.name}</span><strong>{money(line.amount)}</strong></div>)}<div className="statement-total"><span>Total liabilities</span><strong>{money(financialStatements.balanceSheet.totalLiabilities)}</strong></div>
                <h4>Equity</h4>{financialStatements.balanceSheet.equity.map((line) => <div className="statement-line" key={`equity-${line.code}`}><span>{line.name}</span><strong>{money(line.amount)}</strong></div>)}<div className="statement-line"><span>Accumulated earnings (unclosed)</span><strong>{money(financialStatements.balanceSheet.accumulatedEarnings)}</strong></div>
                <div className="statement-total"><span>Total equity</span><strong>{money(financialStatements.balanceSheet.totalEquity)}</strong></div><div className="statement-grand-total"><span>Liabilities + equity</span><strong>{money(financialStatements.balanceSheet.liabilitiesAndEquity)}</strong></div>
                <p className={`statement-balance ${Math.round(financialStatements.balanceSheet.difference * 100) === 0 ? 'balanced' : 'unbalanced'}`}>{Math.round(financialStatements.balanceSheet.difference * 100) === 0 ? 'Balances' : `Out of balance by ${money(Math.abs(financialStatements.balanceSheet.difference))}`}</p>
              </section>
            </div>}
            <p className="statement-disclaimer">Management reports only—not audited or tax-certified. These reports reflect posted journals available in KashFlow; review opening balances and account mappings with an accountant.</p>
          </article>
          <article className="module-card"><h2>Chart of accounts</h2>{accounts.map((account) => <div className="transaction-row" key={account.code}><span><strong>{account.code} · {account.name}</strong><small>{account.type}</small></span><strong>{money(account.balance)}</strong></div>)}</article>
          <article className="module-card"><h2>Trial balance</h2><div className="invoice-summary"><strong>Debits {money(trialTotals.debit)} · Credits {money(trialTotals.credit)}</strong><p>{Number(trialTotals.debit) === Number(trialTotals.credit) ? 'Balanced' : 'Out of balance — investigate before closing a period.'}</p></div></article>
          <article className="module-card"><h2>Journal entries</h2><p>Posted entries stay immutable. Use a linked reversal in an open period to correct an entry, then post a separate replacement journal if required.</p>{journalEntries.map((entry) => <div className="invoice-summary" key={entry.id}><strong>{entry.entry_date} · {entry.description}</strong><p>{entry.lines.map((line) => `${line.code}: Dr ${money(line.debit)} / Cr ${money(line.credit)}`).join(' · ')}</p>{entry.reversal_of && <p className="dialog-note">Reversal of {entry.reversal_of.slice(0, 8)}{entry.correction_reason ? ` · ${entry.correction_reason}` : ''}</p>}{entry.reversed_by && <p className="dialog-note">Reversed by {entry.reversed_by.slice(0, 8)}</p>}{!entry.reversal_of && !entry.reversed_by && <button className="button button-small" disabled={busy} onClick={() => void reverseJournalEntry(entry)}>Create correcting reversal</button>}</div>)}</article>
          <article className="module-card"><h2>Accounting periods</h2>{accountingPeriods.map((period) => <div className="transaction-row" key={period.period}><strong>{period.period}</strong><span>{period.status}</span>{period.status === 'open' ? <button className="button button-small" disabled={busy} onClick={() => void closeAccountingPeriod(period.period)}>Close period</button> : <button className="button button-small" disabled={busy} onClick={() => void reopenAccountingPeriod(period.period)}>Reopen</button>}</div>)}{!accountingPeriods.length && <div className="empty-state">Periods appear as journal entries are posted.</div>}</article>
          <button className="button button-secondary" onClick={() => void refreshAccounting()}>Refresh ledger</button>
          <div className="module-footnote"><ShieldCheck size={16} /> Posted journals are corrected through a linked immutable reversal and a separately reviewed replacement; journal edits and audit certification are not supported. Have a qualified accountant review corrections.</div>
        </section> : page === 'Banking' ? <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> BANKING · {dashboard?.workspaceName}</div><h1>Bank accounts</h1><p className="welcome-subtitle">Connect your bank, then review imported transactions before adding them to your books.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <article className="module-card banking-connect-card"><div className="panel-header"><div><h2>Connect a bank</h2><p>{monoConfig?.enabled ? 'Your bank signs in through Mono’s secure consent window. KashFlow never sees your bank password.' : 'Online connection is not available right now. You can still import a statement below.'}</p></div><span className={`status-pill ${monoConfig?.enabled ? 'green' : 'amber'}`}>{monoConfig?.enabled ? 'Ready to connect' : 'Manual import available'}</span></div>
            {monoConfig?.enabled ? <><details className="setup-more"><summary>Change account holder details</summary><div className="field-row"><label className="field-label">Account holder or business name<input required value={monoCustomerName || dashboard?.workspaceName || ''} onChange={(event) => setMonoCustomerName(event.target.value)} /></label><label className="field-label">Contact email<input required type="email" value={monoCustomerEmail || (account?.user.email.includes('@') ? account.user.email : '')} onChange={(event) => setMonoCustomerEmail(event.target.value)} /></label></div></details><button className="button button-primary" disabled={busy} onClick={() => void linkMonoBank()}>{busy ? 'Connecting…' : 'Connect bank securely'}</button></> : <details className="setup-more"><summary>Why can’t I connect online?</summary><ul className="help-list">{(monoConfig?.setupRequired ?? ['Complete Mono business onboarding/KYB', 'Configure Mono public and secret keys on the API server', 'Register the public webhook URL']).map((requirement) => <li key={requirement}>{requirement}</li>)}</ul><p><a href="https://app.mono.co/signup" target="_blank" rel="noreferrer">Open Mono Partner Dashboard</a> · <a href="https://docs.mono.co/docs/coverage" target="_blank" rel="noreferrer">Check supported banks</a></p></details>}
          </article>
          <article className="module-card"><div className="panel-header"><div><h2>Connected accounts ({connectedBankAccounts.length})</h2><p>Last synchronized status and account details</p></div><button className="button button-small" onClick={() => void refreshBanking()}>Refresh</button></div>{connectedBankAccounts.map((linked) => <div className="transaction-row" key={linked.id}><span><strong>{linked.institution_name || linked.account_name || 'Mono bank account'} · {linked.account_number_masked}</strong><small>{linked.currency} · {linked.account_type} · data {linked.data_status} · last sync {linked.last_synced_at ? new Date(linked.last_synced_at).toLocaleString('en-KE') : 'pending'}</small></span><button className="button button-small" disabled={busy || linked.connection_status !== 'connected'} onClick={() => void syncConnectedBank(linked.id)}>Sync transactions</button></div>)}{!connectedBankAccounts.length && <div className="empty-state">No bank accounts connected yet.</div>}</article>
          <article className="module-card"><h2>Transactions needing review ({bankFeedTransactions.length})</h2><p>New imported transactions do not affect accounting reports or the ledger until you explicitly post them.</p>{bankFeedTransactions.map((item) => <div className="transaction-row" key={item.id}><span><strong>{item.narration || 'Bank transaction'}</strong><small>{item.institution_name} · {item.account_name} · {item.transaction_date} · {item.direction} · {item.currency}</small></span><strong>{money(item.amount)}</strong><div className="button-row"><button className="button button-primary" disabled={busy || item.currency !== 'KES'} title={item.currency !== 'KES' ? 'Convert to KSh before posting to this ledger.' : undefined} onClick={() => void reviewBankFeedTransaction(item.id, 'post')}>Review & post</button><button className="button button-small" disabled={busy} onClick={() => void reviewBankFeedTransaction(item.id, 'ignore')}>Ignore</button></div></div>)}{!bankFeedTransactions.length && <div className="empty-state">No imported transactions need review.</div>}</article>
          <article className="module-card"><details className="setup-more"><summary>Import a bank statement file (CSV)</summary><p>Choose a statement file with date, description, and amount columns (or debit and credit). You can review the preview before posting.</p><label className="field-label">Choose CSV statement<input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBankCsv(file) }} /></label>
            {bankImportRows.map((row, index) => <div className="transaction-row" key={`${row.date}-${index}`}><span><strong>{row.description}</strong><small>{row.date} · {row.direction}</small></span><strong>{money(row.amount)}</strong></div>)}
            {bankImportRows.length > 0 && <div className="button-row"><button className="button button-secondary" onClick={() => setBankImportRows([])}>Discard preview</button><button className="button button-primary" disabled={busy} onClick={() => void postBankImport()}>{busy ? 'Posting…' : `Post ${bankImportRows.length} reviewed rows`}</button></div>}
          </details></article>
          <article className="module-card"><h2>Reconcile a statement</h2><p>Match posted transactions for an account and date range. Reconciliation completes only when opening balance plus matched activity equals your statement balance.</p>
            <form className="record-form-grid" onSubmit={createReconciliation}><label className="field-label">Ledger account label<input required maxLength={120} value={reconciliationInput.accountLabel} onChange={(event) => setReconciliationInput({ ...reconciliationInput, accountLabel: event.target.value })} /></label><label className="field-label">From<input required type="date" value={reconciliationInput.periodStart} onChange={(event) => setReconciliationInput({ ...reconciliationInput, periodStart: event.target.value })} /></label><label className="field-label">To<input required type="date" min={reconciliationInput.periodStart} value={reconciliationInput.periodEnd} onChange={(event) => setReconciliationInput({ ...reconciliationInput, periodEnd: event.target.value })} /></label><label className="field-label">Opening balance (KSh)<input required type="number" step="0.01" value={reconciliationInput.openingBalance} onChange={(event) => setReconciliationInput({ ...reconciliationInput, openingBalance: event.target.value })} /></label><label className="field-label">Statement ending balance (KSh)<input required type="number" step="0.01" value={reconciliationInput.statementEndingBalance} onChange={(event) => setReconciliationInput({ ...reconciliationInput, statementEndingBalance: event.target.value })} /></label><button className="button button-primary" disabled={busy}>Start reconciliation</button></form>
            {reconciliations.map((item) => <div className="transaction-row" key={item.id}><span><strong>{item.account_label} · {item.period_start} to {item.period_end}</strong><small>{item.matched_count ?? 0} matched · ending {money(item.statement_ending_balance)} · {item.status}</small></span><button className="button button-small" onClick={() => void openReconciliation(item.id)}>{item.status === 'completed' ? 'View reconciliation' : 'Continue matching'}</button></div>)}
            {reconciliationDetail && <div className="reconciliation-detail"><h3>{reconciliationDetail.reconciliation.account_label} matching</h3><p>Calculated ending {money(reconciliationDetail.calculatedEndingBalance)} · statement {money(reconciliationDetail.reconciliation.statement_ending_balance)} · difference {money(reconciliationDetail.difference)}</p>
              {reconciliationDetail.transactions.map((item) => <label className="transaction-row reconciliation-item" key={item.id}><input type="checkbox" checked={item.matched} disabled={busy || reconciliationDetail.reconciliation.status !== 'in_progress'} onChange={(event) => void setReconciliationMatch(item.id, event.target.checked)} /><span><strong>{item.description}</strong><small>{item.transaction_date} · {item.account} · {item.direction}</small></span><strong>{item.direction === 'expense' ? '− ' : '+ '}{money(item.amount)}</strong></label>)}
              {!reconciliationDetail.transactions.length && <div className="empty-state">No posted transactions for this account and date range. Post reviewed bank rows first.</div>}
              {reconciliationDetail.reconciliation.status === 'in_progress' && <button className="button button-primary" disabled={busy || Math.round(Number(reconciliationDetail.difference) * 100) !== 0} onClick={() => void completeReconciliation()}>Complete balanced reconciliation</button>}
            </div>}
          </article>
        </section> : page === 'Expenses' ? <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> EXPENSES · SAVED TRANSACTIONS</div><h1>Expenses</h1><p className="welcome-subtitle">Create and review expenses. Saving a record posts its balanced ledger entry.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary" onClick={() => { setTransaction({ description: '', amount: '', direction: 'expense', account: 'Operating expenses', date: today }); setModal('transaction') }}><Plus size={16} /> Add expense</button>
          <article className="module-card">{(dashboard?.transactions ?? []).filter((row) => row.direction === 'expense').map((row) => <div className="transaction-row" key={row.id}><span><strong>{row.description}</strong><small>{row.transaction_date} · {row.account}</small></span><strong>{money(row.amount)}</strong></div>)}{!(dashboard?.transactions ?? []).some((row) => row.direction === 'expense') && <div className="empty-state">No expenses saved yet.</div>}</article>
        </section> : ['Customers', 'Suppliers', 'Inventory', 'Projects'].includes(page) ? (() => {
          const type = ({ Customers: 'customers', Suppliers: 'suppliers', Inventory: 'inventory', Projects: 'projects' } as Record<string, 'customers' | 'suppliers' | 'inventory' | 'projects'>)[page]
          const fields: Record<string, Array<{ name: string; label: string; kind?: string }>> = {
            customers: [{ name: 'name', label: 'Customer name' }, { name: 'email', label: 'Email', kind: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'address', label: 'Address' }, { name: 'taxPin', label: 'KRA PIN (optional)' }, { name: 'notes', label: 'Notes' }],
            suppliers: [{ name: 'name', label: 'Supplier name' }, { name: 'email', label: 'Email', kind: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'address', label: 'Address' }, { name: 'taxPin', label: 'KRA PIN (optional)' }, { name: 'notes', label: 'Notes' }],
            inventory: [{ name: 'name', label: 'Item or service name' }, { name: 'sku', label: 'SKU' }, { name: 'barcode', label: 'Barcode (scanner input)' }, { name: 'quantity', label: 'Quantity', kind: 'number' }, { name: 'reorderPoint', label: 'Low-stock alert at', kind: 'number' }, { name: 'unit', label: 'Unit' }, { name: 'cost', label: 'Unit cost (KSh)', kind: 'number' }, { name: 'price', label: 'Selling price (KSh)', kind: 'number' }, { name: 'notes', label: 'Notes' }],
            projects: [{ name: 'name', label: 'Project name' }, { name: 'customer', label: 'Customer' }, { name: 'status', label: 'Status', kind: 'status' }, { name: 'startDate', label: 'Start date', kind: 'date' }, { name: 'endDate', label: 'End date', kind: 'date' }, { name: 'budget', label: 'Budget (KSh)', kind: 'number' }, { name: 'notes', label: 'Notes' }],
          }
          const inventoryHealth = type === 'inventory' ? records.inventory.map((record) => {
            const locationQuantities = inventoryLocationStock.filter((stock) => stock.item_id === record.id && inventoryLocations.some((location) => location.id === stock.location_id && location.active))
            const quantity = locationQuantities.length
              ? locationQuantities.reduce((sum, stock) => sum + Number(stock.quantity), 0)
              : Number(record.data.quantity ?? 0)
            const reorderPoint = Number(record.data.reorderPoint ?? 0)
            const lowThreshold = Math.max(Number(settings.inventoryLowStockThreshold ?? 5), reorderPoint)
            const mediumThreshold = Math.max(Number(settings.inventoryMediumStockThreshold ?? 10), lowThreshold + 1, reorderPoint * 2)
            const status: 'low' | 'medium' | 'healthy' = quantity <= lowThreshold ? 'low'
              : quantity <= mediumThreshold ? 'medium' : 'healthy'
            return { id: record.id, name: String(record.data.name ?? 'Inventory item'), quantity, unit: String(record.data.unit ?? 'unit'), reorderPoint, lowThreshold, mediumThreshold, status }
          }).sort((left, right) => ({ low: 0, medium: 1, healthy: 2 }[left.status] - { low: 0, medium: 1, healthy: 2 }[right.status]) || left.name.localeCompare(right.name)) : []
          const healthGroups = [
            { status: 'low', title: 'Low stock · reorder now', description: 'At or below the configured low-stock limit or item reorder point.', items: inventoryHealth.filter((item) => item.status === 'low') },
            { status: 'medium', title: 'Medium stock · watch', description: 'Above the low limit and at or below the configured medium limit.', items: inventoryHealth.filter((item) => item.status === 'medium') },
            { status: 'healthy', title: 'Healthy stock', description: 'Above the configured medium-stock limit.', items: inventoryHealth.filter((item) => item.status === 'healthy') },
          ]
          return <section className="module-page"><div className="eyebrow"><span className="live-dot" /> {page.toUpperCase()} · WORKSPACE DATABASE</div><h1>{page}</h1><p className="welcome-subtitle">Create and maintain records for {dashboard?.workspaceName}. Data is private to this business.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <form className="module-card" onSubmit={(event) => void saveWorkspaceRecord(event, type)}><h2>{editingRecordId ? 'Edit' : 'Add'} {page.slice(0, -1).toLowerCase()}</h2><div className="record-form-grid">{fields[type].map((field) => <label className="field-label" key={field.name}>{field.label}{field.kind === 'status' ? <select value={recordForm[field.name] ?? 'planned'} onChange={(event) => setRecordForm({ ...recordForm, [field.name]: event.target.value })}><option value="planned">Planned</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option></select> : <input required={field.name === 'name'} type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : field.kind ?? 'text'} min={field.kind === 'number' ? '0' : undefined} step={field.kind === 'number' ? '0.01' : undefined} value={recordForm[field.name] ?? ''} onChange={(event) => setRecordForm({ ...recordForm, [field.name]: event.target.value })} />}</label>)}</div>{type === 'suppliers' && <fieldset className="module-card supplier-items-fieldset"><legend>Inventory items supplied (optional)</legend><p className="dialog-note">Link one or more items this supplier provides. These are reference links only; they do not change stock or purchase orders.</p>{supplierItemIds.map((itemId, index) => <div className="field-row" key={`supplier-item-${index}`}><label className="field-label">Inventory item<select aria-label={`Supplier inventory item ${index + 1}`} value={itemId} onChange={(event) => setSupplierItemIds((current) => current.map((value, row) => row === index ? event.target.value : value))}><option value="">Choose item (optional)</option>{records.inventory.filter((item) => !supplierItemIds.includes(item.id) || item.id === itemId).map((item) => <option key={item.id} value={item.id}>{String(item.data.name ?? 'Inventory item')}{item.data.sku ? ` · ${item.data.sku}` : ''}</option>)}</select></label>{supplierItemIds.length > 1 && <button type="button" className="button button-small" aria-label="Remove supplier item row" onClick={() => setSupplierItemIds((current) => current.filter((_, row) => row !== index))}>Remove</button>}</div>)}<button type="button" className="button button-secondary" onClick={() => setSupplierItemIds((current) => [...current, ''])}>Add another item</button></fieldset>}<div className="button-row"><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : `${editingRecordId ? 'Update' : 'Save'} ${page.slice(0, -1).toLowerCase()}`}</button>{editingRecordId && <button type="button" className="button button-secondary" onClick={() => { setEditingRecordId(''); setRecordForm({}); setSupplierItemIds(['']) }}>Cancel edit</button>}</div></form>
            {type === 'inventory' && <article className="module-card stock-health-panel">
              <div className="panel-header"><div><h2>Stock health &amp; reorder reminders</h2><p>Health uses each item’s saved reorder point; location quantities are combined for the business total.</p></div><span className="task-count">{inventoryHealth.filter((item) => item.status === 'low').length} low</span></div>
              <div className="stock-health-grid">{healthGroups.map((group) => <section className={`stock-health-card stock-health-${group.status}`} key={group.status}>
                <div className="stock-health-heading"><span className={`stock-health-dot stock-health-dot-${group.status}`} /><h3>{group.title}</h3><strong>{group.items.length}</strong></div>
                <p>{group.description}</p>
                {group.items.slice(0, 8).map((item) => <div className="stock-health-item" key={item.id}><span><strong>{item.name}</strong><small>{item.quantity} {item.unit} on hand · reorder at {item.reorderPoint}</small></span><span className={`stock-status-pill stock-status-${group.status}`}>{group.status === 'low' ? 'Reorder' : group.status === 'medium' ? 'Watch' : 'Healthy'}</span></div>)}
                {group.items.length > 8 && <small className="stock-health-more">+{group.items.length - 8} more items</small>}
                {!group.items.length && <div className="empty-state stock-health-empty">No items in this level.</div>}
              </section>)}</div>
              <p className="dialog-note">Red = low; orange = medium/watch; green = healthy. Item-specific reorder points can raise the low and medium cutoffs above the business thresholds.</p>
            </article>}
            {type === 'inventory' && account?.workspaces?.find((workspace) => workspace.id === account.workspace.id)?.role === 'admin' && <article className="module-card">
              <h2>Set stock health thresholds</h2>
              <p>Set the maximum quantities for low and medium stock. Healthy stock is anything above the medium limit. Saved thresholds apply to this business; an item’s reorder point can raise its low and medium limits.</p>
              <form className="record-form-grid" onSubmit={(event) => void saveInventoryThresholds(event)}>
                <label className="field-label">Low stock up to (items)<input required type="number" min="0" max="1000000" step="1" value={settings.inventoryLowStockThreshold} onChange={(event) => setSettings({ ...settings, inventoryLowStockThreshold: Number(event.target.value) })} /></label>
                <label className="field-label">Medium stock up to (items)<input required type="number" min="1" max="1000000" step="1" value={settings.inventoryMediumStockThreshold} onChange={(event) => setSettings({ ...settings, inventoryMediumStockThreshold: Number(event.target.value) })} /></label>
                <p className="dialog-note">Healthy stock starts above {settings.inventoryMediumStockThreshold} items. Medium must be higher than low.</p>
                <button className="button button-primary" disabled={busy || settings.inventoryMediumStockThreshold <= settings.inventoryLowStockThreshold}>{busy ? 'Saving…' : 'Save stock thresholds'}</button>
              </form>
            </article>}
            <article className="module-card"><h2>Saved {page.toLowerCase()} ({records[type].length})</h2>{records[type].map((record) => <div className="transaction-row" key={record.id}><span><strong>{record.data.name}</strong><small>{type === 'inventory' ? `SKU ${record.data.sku || '—'} · Qty ${record.data.quantity} ${record.data.unit}` : type === 'projects' ? `${record.data.status} · ${record.data.customer || 'No customer'} · Budget ${money(record.data.budget || 0)}` : type === 'suppliers' ? `${record.data.email || 'No email'} · ${record.data.phone || 'No phone'} · ${(Array.isArray(record.data.supplyItemIds) ? record.data.supplyItemIds : []).map((itemId) => String(records.inventory.find((item) => item.id === itemId)?.data.name ?? '')).filter(Boolean).join(', ') || 'No linked inventory items'}` : `${record.data.email || 'No email'} · ${record.data.phone || 'No phone'}`}</small>{type === 'inventory' && <span className={`stock-status-pill stock-status-${inventoryHealth.find((item) => item.id === record.id)?.status ?? 'healthy'}`}>{inventoryHealth.find((item) => item.id === record.id)?.status === 'low' ? 'Low stock' : inventoryHealth.find((item) => item.id === record.id)?.status === 'medium' ? 'Watch stock' : 'Healthy stock'}</span>}</span><div className="button-row">{type === 'customers' && <button className="button button-small" onClick={() => beginInvoiceForCustomer(record)}>Create invoice</button>}<button className="button button-small" onClick={() => { setEditingRecordId(record.id); setRecordForm(Object.fromEntries(Object.entries(record.data).filter(([key]) => key !== 'supplyItemIds').map(([key, value]) => [key, String(value ?? '')]))); setSupplierItemIds(Array.isArray(record.data.supplyItemIds) && record.data.supplyItemIds.length ? record.data.supplyItemIds.map(String) : ['']) }}>Edit</button><button className="button button-small" onClick={() => void deleteWorkspaceRecord(type, record.id)}>Delete</button></div></div>)}{!records[type].length && <div className="empty-state">No {page.toLowerCase()} saved yet.</div>}</article>
            {type === 'suppliers' && <article className="module-card"><h2>Vendor bills and payments</h2><p>Record itemized bills and tax amounts verified for your business. Tax entries are bookkeeping inputs, not statutory determinations.</p><form className="record-form-grid" onSubmit={saveBill}><label className="field-label">Supplier<input required value={billInput.supplier} onChange={(event) => setBillInput({ ...billInput, supplier: event.target.value })} /></label><DraftLineEditor lines={billLines} includeRecoverableTax onChange={(index, key, value) => setBillLines((lines) => lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line))} onAdd={() => setBillLines((lines) => [...lines, { description: '', quantity: '1', unitPrice: '', discountAmount: '0', taxAmount: '0', recoverableTaxAmount: '0' }])} onRemove={(index) => setBillLines((lines) => lines.filter((_, lineIndex) => lineIndex !== index))} /><p>Total: <strong>{money(draftDocumentTotal(billLines))}</strong></p><label className="field-label">Bill date<input required type="date" value={billInput.billDate} onChange={(event) => setBillInput({ ...billInput, billDate: event.target.value })} /></label><label className="field-label">Due date<input required type="date" min={billInput.billDate} value={billInput.dueDate} onChange={(event) => setBillInput({ ...billInput, dueDate: event.target.value })} /></label><label className="field-label"><input type="checkbox" checked={billInput.requiresApproval} onChange={(event) => setBillInput({ ...billInput, requiresApproval: event.target.checked })} /> Require admin approval before posting</label><button className="button button-primary" disabled={busy}>Record bill</button></form>
              {bills.map((bill) => <div className="transaction-row" key={bill.id}><span><strong>{bill.supplier} · {bill.description}</strong><small>Due {bill.due_date} · {bill.approval_status === 'pending' ? 'awaiting approval' : bill.approval_status === 'rejected' ? 'rejected' : bill.status} · Remaining {money(bill.amount_due ?? bill.amount)}</small></span><strong>{money(bill.amount)}</strong>{bill.approval_status === 'pending' && <button className="button button-small" disabled={busy} onClick={() => void approveBill(bill)}>Approve and post</button>}{bill.status === 'unpaid' && bill.approval_status === 'approved' && <><label className="field-label">Payment (KSh)<input min="0.01" max={bill.amount_due ?? bill.amount} step="0.01" type="number" value={paymentAmounts[bill.id] ?? ''} onChange={(event) => setPaymentAmounts((values) => ({ ...values, [bill.id]: event.target.value }))} /></label><button className="button button-small" disabled={busy || !paymentAmounts[bill.id]} onClick={() => void payBill(bill)}>Record payment</button></>}</div>)}
              {!bills.length && <div className="empty-state">No bills yet.</div>}
            </article>}
            {type === 'inventory' && <article className="module-card"><h2>Stock control and locations</h2><p>Receipts and issues update on-hand quantities and post inventory/COGS journals. Location transfers and counts are tracked separately; negative stock is blocked.</p>
              <form className="record-form-grid" onSubmit={createInventoryLocation}><label className="field-label">New shop or warehouse<input required maxLength={120} value={locationInput.name} onChange={(event) => setLocationInput({ ...locationInput, name: event.target.value })} /></label><label className="field-label">Location code<input required maxLength={40} value={locationInput.code} onChange={(event) => setLocationInput({ ...locationInput, code: event.target.value })} /></label><button className="button button-secondary" disabled={busy}>Add location</button></form>
              <div className="transaction-row"><span><strong>Active locations</strong><small>{inventoryLocations.map((location) => `${location.name}${location.is_default ? ' (default)' : ''}`).join(' · ')}</small></span><span>{inventoryLocations.length} locations</span></div>
              <form className="record-form-grid" onSubmit={transferInventory}><h3>Transfer stock</h3><label className="field-label">Item<select required value={transferInput.itemId} onChange={(event) => setTransferInput({ ...transferInput, itemId: event.target.value })}><option value="">Select item</option>{records.inventory.map((item) => <option key={item.id} value={item.id}>{String(item.data.name)}</option>)}</select></label><label className="field-label">From<select required value={transferInput.fromLocationId} onChange={(event) => setTransferInput({ ...transferInput, fromLocationId: event.target.value })}><option value="">Select source</option>{inventoryLocations.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="field-label">To<select required value={transferInput.toLocationId} onChange={(event) => setTransferInput({ ...transferInput, toLocationId: event.target.value })}><option value="">Select destination</option>{inventoryLocations.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="field-label">Quantity<input required type="number" min="0.001" step="0.001" value={transferInput.quantity} onChange={(event) => setTransferInput({ ...transferInput, quantity: event.target.value })} /></label><button className="button button-secondary" disabled={busy || inventoryLocations.length < 2}>Transfer</button></form>
              <form className="record-form-grid" onSubmit={countInventory}><h3>Stock count</h3><label className="field-label">Item<select required value={countInput.itemId} onChange={(event) => setCountInput({ ...countInput, itemId: event.target.value })}><option value="">Select item</option>{records.inventory.map((item) => <option key={item.id} value={item.id}>{String(item.data.name)}</option>)}</select></label><label className="field-label">Location<select required value={countInput.locationId} onChange={(event) => setCountInput({ ...countInput, locationId: event.target.value })}><option value="">Select location</option>{inventoryLocations.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="field-label">Counted quantity<input required type="number" min="0" step="0.001" value={countInput.countedQuantity} onChange={(event) => setCountInput({ ...countInput, countedQuantity: event.target.value })} /></label><button className="button button-secondary" disabled={busy}>Post count</button></form>
              {account?.workspaces?.find((workspace) => workspace.id === account.workspace.id)?.role === 'admin' && <form className="record-form-grid inventory-writeoff-form" onSubmit={(event) => void writeOffInventory(event)}>
                <h3>Damaged or expired inventory write-off</h3>
                <p className="dialog-note">Record stock that can no longer be sold. The quantity is deducted from the selected location and business total, and its recorded unit cost is posted as an inventory expense. Negative stock is blocked.</p>
                <label className="field-label">Inventory item<select required value={inventoryWriteOffInput.itemId} onChange={(event) => setInventoryWriteOffInput({ ...inventoryWriteOffInput, itemId: event.target.value })}><option value="">Select item</option>{records.inventory.map((item) => <option key={item.id} value={item.id}>{String(item.data.name)} · total {item.data.quantity}</option>)}</select></label>
                <label className="field-label">Location<select required value={inventoryWriteOffInput.locationId} onChange={(event) => setInventoryWriteOffInput({ ...inventoryWriteOffInput, locationId: event.target.value })}><option value="">Select location</option>{inventoryLocations.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                <label className="field-label">Reason<select value={inventoryWriteOffInput.reason} onChange={(event) => setInventoryWriteOffInput({ ...inventoryWriteOffInput, reason: event.target.value as typeof inventoryWriteOffInput.reason })}><option value="damaged">Damaged</option><option value="expired">Expired</option><option value="custom">Custom reason</option></select></label>
                {inventoryWriteOffInput.reason === 'custom' && <label className="field-label">Custom reason<input required maxLength={100} value={inventoryWriteOffInput.customReason} onChange={(event) => setInventoryWriteOffInput({ ...inventoryWriteOffInput, customReason: event.target.value })} placeholder="e.g. lost in transit" /></label>}
                <label className="field-label">Quantity<input required type="number" min="0.001" step="0.001" value={inventoryWriteOffInput.quantity} onChange={(event) => setInventoryWriteOffInput({ ...inventoryWriteOffInput, quantity: event.target.value })} /></label>
                <label className="field-label">Write-off date<input required type="date" value={inventoryWriteOffInput.date} onChange={(event) => setInventoryWriteOffInput({ ...inventoryWriteOffInput, date: event.target.value })} /></label>
                <label className="field-label">Notes (optional)<input maxLength={160} value={inventoryWriteOffInput.notes} onChange={(event) => setInventoryWriteOffInput({ ...inventoryWriteOffInput, notes: event.target.value })} placeholder="e.g. damaged in storage" /></label>
                <button className="button button-primary" disabled={busy || !inventoryWriteOffInput.itemId || !inventoryWriteOffInput.locationId}>{busy ? 'Posting…' : 'Deduct damaged / expired stock'}</button>
              </form>}
              <div className="transaction-row"><span><strong>Stock by location</strong><small>{inventoryLocationStock.map((stock) => `${records.inventory.find((item) => item.id === stock.item_id)?.data.name ?? 'Item'} · ${stock.location_name}: ${stock.quantity}`).join(' | ') || 'No location stock saved yet'}</small></span></div>
              <form className="record-form-grid" onSubmit={recordStockMovement}><label className="field-label">Inventory item<select required value={stockMovementInput.itemId} onChange={(event) => { const item = records.inventory.find((record) => record.id === event.target.value); setStockMovementInput({ ...stockMovementInput, itemId: event.target.value, unitCost: String(item?.data.cost ?? stockMovementInput.unitCost) }) }}><option value="">Select item</option>{records.inventory.map((item) => <option value={item.id} key={item.id}>{String(item.data.name)} · total {item.data.quantity}</option>)}</select></label><label className="field-label">Location<select required value={stockMovementInput.locationId} onChange={(event) => setStockMovementInput({ ...stockMovementInput, locationId: event.target.value })}><option value="">Select location</option>{inventoryLocations.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="field-label">Movement<select value={stockMovementInput.movementType} onChange={(event) => setStockMovementInput({ ...stockMovementInput, movementType: event.target.value as typeof stockMovementInput.movementType })}><option value="purchase">Receive stock</option><option value="sale">Issue stock (COGS only)</option><option value="adjustment">Stock count adjustment</option></select></label>{stockMovementInput.movementType === 'adjustment' && <label className="field-label">Adjustment direction<select value={stockMovementInput.adjustmentDirection} onChange={(event) => setStockMovementInput({ ...stockMovementInput, adjustmentDirection: event.target.value as typeof stockMovementInput.adjustmentDirection })}><option value="increase">Increase stock</option><option value="decrease">Decrease stock</option></select></label>}<label className="field-label">Quantity<input required min="0.001" step="0.001" type="number" value={stockMovementInput.quantity} onChange={(event) => setStockMovementInput({ ...stockMovementInput, quantity: event.target.value })} /></label><label className="field-label">Unit cost (KSh)<input required min="0" step="0.01" type="number" disabled={stockMovementInput.movementType === 'sale'} value={stockMovementInput.unitCost} onChange={(event) => setStockMovementInput({ ...stockMovementInput, unitCost: event.target.value })} /></label><label className="field-label">Reference<input maxLength={200} value={stockMovementInput.reference} onChange={(event) => setStockMovementInput({ ...stockMovementInput, reference: event.target.value })} /></label><label className="field-label">Date<input required type="date" value={stockMovementInput.date} onChange={(event) => setStockMovementInput({ ...stockMovementInput, date: event.target.value })} /></label><button className="button button-primary" disabled={busy || !records.inventory.length}>Post movement</button></form>
              <h3>Purchase orders</h3><form className="record-form-grid" onSubmit={createPurchaseOrder}><label className="field-label">Supplier<input required value={purchaseOrderInput.supplier} onChange={(event) => setPurchaseOrderInput({ ...purchaseOrderInput, supplier: event.target.value })} /></label><label className="field-label">Receive into<select required value={purchaseOrderInput.locationId} onChange={(event) => setPurchaseOrderInput({ ...purchaseOrderInput, locationId: event.target.value })}><option value="">Select location</option>{inventoryLocations.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="field-label">Item<select required value={purchaseOrderInput.itemId} onChange={(event) => setPurchaseOrderInput({ ...purchaseOrderInput, itemId: event.target.value })}><option value="">Select item</option>{records.inventory.map((item) => <option key={item.id} value={item.id}>{String(item.data.name)}</option>)}</select></label><label className="field-label">Quantity<input required min="0.001" step="0.001" type="number" value={purchaseOrderInput.quantity} onChange={(event) => setPurchaseOrderInput({ ...purchaseOrderInput, quantity: event.target.value })} /></label><label className="field-label">Unit cost (KSh)<input required min="0" step="0.01" type="number" value={purchaseOrderInput.unitCost} onChange={(event) => setPurchaseOrderInput({ ...purchaseOrderInput, unitCost: event.target.value })} /></label><label className="field-label">Order date<input required type="date" value={purchaseOrderInput.orderDate} onChange={(event) => setPurchaseOrderInput({ ...purchaseOrderInput, orderDate: event.target.value })} /></label><label className="field-label">Payment due date<input type="date" min={purchaseOrderInput.orderDate} value={purchaseOrderInput.dueDate} onChange={(event) => setPurchaseOrderInput({ ...purchaseOrderInput, dueDate: event.target.value })} /></label><label className="field-label">Expected date<input type="date" value={purchaseOrderInput.expectedDate} onChange={(event) => setPurchaseOrderInput({ ...purchaseOrderInput, expectedDate: event.target.value })} /></label><button className="button button-secondary" disabled={busy || !records.inventory.length}>Create purchase order</button></form>
              {purchaseOrders.map((order) => <div className="transaction-row" key={order.id}><span><strong>{order.supplier} · PO {order.id.slice(0, 8)}</strong><small>{order.status} · {order.lines.map((line) => `${line.item_name}: ${line.received_quantity}/${line.quantity}`).join(' · ')}</small></span>{order.status !== 'received' && order.status !== 'cancelled' && <button className="button button-small" disabled={busy} onClick={() => void receivePurchaseOrder(order)}>Receive remaining</button>}</div>)}
            </article>}
            {type === 'projects' && <article className="module-card"><h2>Time and project costing</h2><p>Approved time is a management cost estimate and billable value, not a payroll posting or invoice.</p><label className="field-label">Project<select value={timeInput.projectId} onChange={(event) => void loadProjectTime(event.target.value)}><option value="">Select project</option>{records.projects.map((project) => <option key={project.id} value={project.id}>{String(project.data.name)}</option>)}</select></label>
              {timeInput.projectId && <><form className="record-form-grid" onSubmit={saveTimeEntry}><label className="field-label">Work description<input required value={timeInput.description} onChange={(event) => setTimeInput({ ...timeInput, description: event.target.value })} /></label><label className="field-label">Date<input required type="date" value={timeInput.workDate} onChange={(event) => setTimeInput({ ...timeInput, workDate: event.target.value })} /></label><label className="field-label">Hours<input required min="0.01" max="24" step="0.01" type="number" value={timeInput.hours} onChange={(event) => setTimeInput({ ...timeInput, hours: event.target.value })} /></label><label className="field-label">Hourly cost (KSh)<input required min="0" step="0.01" type="number" value={timeInput.hourlyCost} onChange={(event) => setTimeInput({ ...timeInput, hourlyCost: event.target.value })} /></label><label className="field-label"><input type="checkbox" checked={timeInput.billable} onChange={(event) => setTimeInput({ ...timeInput, billable: event.target.checked })} /> Billable time</label><button className="button button-primary" disabled={busy}>Submit time</button></form>
                {projectSummary && <div className="invoice-summary"><strong>Project profitability estimate</strong><p>{projectSummary.approved_hours} approved hours · pending cost {money(projectSummary.pending_cost)}</p><p>Approved cost {money(projectSummary.approved_cost)} · billable value estimate {money(projectSummary.billableValueEstimate)} · estimated margin {money(projectSummary.estimatedBillableMargin)}</p>{Number(projectSummary.budget) > 0 && <p>Budget {money(projectSummary.budget)} · estimated budget remaining {money(projectSummary.remainingBudgetEstimate)}</p>}<small>{projectSummary.profitabilityNote}</small></div>}
                {timeEntries.map((entry) => <div className="transaction-row" key={entry.id}><span><strong>{entry.description}</strong><small>{entry.work_date} · {entry.hours} hours · {entry.status}{entry.billable ? ' · billable' : ''}</small></span><strong>{money(Number(entry.hours) * Number(entry.hourly_cost))}</strong>{entry.status === 'submitted' && <div className="button-row"><button className="button button-small" onClick={() => void reviewTimeEntry(entry, 'approved')}>Approve</button><button className="button button-small" onClick={() => void reviewTimeEntry(entry, 'rejected')}>Reject</button></div>}</div>)}
              </>}
            </article>}
          </section>
        })() : page === 'Kenya compliance' ? <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> KENYA COMPLIANCE · {dashboard?.workspaceName}</div><h1>Taxes and compliance</h1><p className="welcome-subtitle">See what’s connected and manage your tax setup. Estimates and drafts are not official filings or tax invoices.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="metric-grid compliance-overview-grid">{[{ name: 'KRA eTIMS', description: 'Prepare invoice details for KRA. Production use requires KRA approval and device setup.', key: 'kra_etims' as const, blocker: 'Approval required for live invoices' }, { name: 'Bank feeds', description: 'Connect an eligible bank or import a statement. Review transactions before posting.', key: 'bank_feeds' as const, blocker: monoConfigured ? 'Ready to connect' : 'Manual statement import available' }, { name: 'Payroll taxes', description: 'Prepare payroll estimates. Official PAYE, SHIF, NSSF and AHL filing is not connected.', key: 'statutory_filing' as const, blocker: 'Estimates only · filing not connected' }].map((item) => {
            const value = onboarding[item.key] ?? { milestone: 'not_started', note: '', details: {} }
            const details = value.details ?? {}
            return <article className="metric-card compliance-setup-card" key={item.key}><div className="metric-top"><span>{item.name}</span><ShieldCheck size={17} /></div><strong>{item.blocker}</strong><p>{item.description}</p>
              {item.key === 'bank_feeds' && <button className="button button-primary" onClick={() => navigateTo('Banking')}>Connect or import a bank</button>}
              {item.key === 'statutory_filing' && <button className="button button-secondary" onClick={() => navigateTo('Payroll')}>Open payroll estimates</button>}
              <details className="setup-more"><summary>Advanced setup and onboarding notes</summary>
              {item.key === 'kra_etims' && <div className="compliance-evidence-form"><label className="field-label">KRA system solution<select value={String(details.solution ?? '')} onChange={(event) => setOnboardingDetail('kra_etims', 'solution', event.target.value)}><option value="">Select OSCU/VSCU</option><option value="OSCU">OSCU · always-online system</option><option value="VSCU">VSCU · bulk/offline-capable system</option></select></label><label className="field-label">Taxpayer KRA PIN<input value={String(details.taxpayerPin ?? '')} onChange={(event) => setOnboardingDetail('kra_etims', 'taxpayerPin', event.target.value)} autoComplete="off" /></label><label className="field-label">KRA sandbox registration reference<input value={String(details.sandboxReference ?? '')} onChange={(event) => setOnboardingDetail('kra_etims', 'sandboxReference', event.target.value)} /></label><label className="field-label">KRA certification reference<input value={String(details.certificationReference ?? '')} onChange={(event) => setOnboardingDetail('kra_etims', 'certificationReference', event.target.value)} /></label><label className="field-label">Production approval reference<input value={String(details.productionApprovalReference ?? '')} onChange={(event) => setOnboardingDetail('kra_etims', 'productionApprovalReference', event.target.value)} /></label><a href="https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/etims-system-to-system-integration" target="_blank" rel="noreferrer">Official KRA OSCU/VSCU specs, sandbox, and certification steps</a></div>}
              {item.key === 'statutory_filing' && <div className="compliance-evidence-form"><p>Record the route confirmed with the authority or approved provider. These selections are evidence notes only and do not connect or submit.</p><label className="field-label">PAYE return route<select value={String(details.payeRoute ?? '')} onChange={(event) => setOnboardingDetail('statutory_filing', 'payeRoute', event.target.value)}><option value="">Select route</option><option value="kra_itax_workbook">KRA iTax official return-workbook/upload process</option><option value="authorized_provider">Authorized provider/API (provide approval details below)</option></select></label><label className="field-label">Affordable Housing Levy route<select value={String(details.ahlRoute ?? '')} onChange={(event) => setOnboardingDetail('statutory_filing', 'ahlRoute', event.target.value)}><option value="">Select route</option><option value="kra_itax_or_official_portal">KRA official portal/process</option><option value="authorized_provider">Authorized provider/API (provide approval details below)</option></select></label><label className="field-label">SHIF/SHA employer route<input value={String(details.shifRoute ?? '')} onChange={(event) => setOnboardingDetail('statutory_filing', 'shifRoute', event.target.value)} placeholder="Authority portal or approved provider route" /></label><label className="field-label">NSSF employer route<input value={String(details.nssfRoute ?? '')} onChange={(event) => setOnboardingDetail('statutory_filing', 'nssfRoute', event.target.value)} placeholder="Employer portal or approved provider route" /></label><label className="field-label">Authorized provider name (if applicable)<input value={String(details.providerName ?? '')} onChange={(event) => setOnboardingDetail('statutory_filing', 'providerName', event.target.value)} /></label><label className="field-label">Authority/provider approval or route reference<input value={String(details.routeConfirmationReference ?? '')} onChange={(event) => setOnboardingDetail('statutory_filing', 'routeConfirmationReference', event.target.value)} /></label><label className="field-label checkbox-row"><input type="checkbox" checked={details.routesConfirmed === true} onChange={(event) => setOnboardingDetail('statutory_filing', 'routesConfirmed', event.target.checked)} /> I confirmed each filing route with the authority/provider (self-attested)</label><a href="https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye" target="_blank" rel="noreferrer">KRA official PAYE filing and iTax workbook instructions</a></div>}
              <label className="field-label">Self-reported onboarding milestone<select value={value.milestone} onChange={(event) => setOnboarding((current) => ({ ...current, [item.key]: { ...value, milestone: event.target.value } }))}><option value="not_started">Not started</option><option value="application_in_progress">Application in progress</option><option value="sandbox_testing">Sandbox testing</option><option value="certification_review">Certification review</option><option value="certified">Certified (self-reported; not verified)</option></select></label><label className="field-label">Progress note<textarea maxLength={1000} value={value.note} onChange={(event) => setOnboarding((current) => ({ ...current, [item.key]: { ...value, note: event.target.value } }))} placeholder="Track application references or next steps; never enter passwords or API keys." /></label><button className="button button-secondary" disabled={busy} onClick={() => void updateOnboarding(item.key)}>Save progress</button>
              </details>
            </article>
          })}</div>
          <details className="compliance-advanced"><summary>Technical KRA setup and invoice drafts</summary>
          <article className="module-card"><div className="panel-header"><div><h2>KRA OSCU device connection · {kraEtimsConfig?.environment ?? 'loading'}</h2><p>Uses KRA’s documented OSCU initialization, code-list, and sales endpoint. Device PIN/serial and the KRA communication key are encrypted on the API server.</p></div><span className={`status-pill ${kraEtimsConfig?.initialized ? 'green' : 'amber'}`}>{kraEtimsConfig?.initialized ? 'Device initialized' : 'Setup required'}</span></div>
            {!kraEtimsConfig?.credentialsEncryptionReady && <p className="form-error">Configure KRA_ETIMS_CREDENTIALS_ENCRYPTION_KEY in the API service environment before saving device credentials.</p>}
            <div className="record-form-grid"><label className="field-label">Taxpayer KRA PIN<input autoComplete="off" maxLength={11} value={kraDeviceInput.taxpayerPin} onChange={(event) => setKraDeviceInput({ ...kraDeviceInput, taxpayerPin: event.target.value.toUpperCase() })} /></label><label className="field-label">Branch ID<input maxLength={2} value={kraDeviceInput.branchId} onChange={(event) => setKraDeviceInput({ ...kraDeviceInput, branchId: event.target.value })} /></label><label className="field-label">KRA-approved device serial number<input maxLength={100} value={kraDeviceInput.deviceSerial} onChange={(event) => setKraDeviceInput({ ...kraDeviceInput, deviceSerial: event.target.value })} /></label></div>
            <div className="button-row"><button className="button button-secondary" disabled={busy || !kraEtimsConfig?.credentialsEncryptionReady} onClick={() => void saveKraDevice()}>Save encrypted device details</button><button className="button button-primary" disabled={busy || !kraEtimsConfig?.configured || kraEtimsConfig.initialized} onClick={() => void initializeKraDevice()}>{busy ? 'Contacting KRA…' : `Initialize ${kraEtimsConfig?.environment ?? 'OSCU'} device`}</button><button className="button button-small" disabled={busy || !kraEtimsConfig?.initialized} onClick={() => void loadKraCodes()}>Fetch KRA code lists</button></div>
            {kraEtimsConfig?.device && <p>Device ID {kraEtimsConfig.device.deviceId || '—'} · SDC {kraEtimsConfig.device.sdcId || '—'} · MRC {kraEtimsConfig.device.mrcNo || '—'}</p>}
            <p className="dialog-note">Production fiscalization requires KRA approval/certification and environment KRA_ETIMS_ENV=production plus KRA_ETIMS_LIVE_ENABLED=true set by the API operator. Sandbox calls are not fiscal invoices. Never share these credentials in chat.</p>
            {kraCodes && <details><summary>Latest response from KRA standard code lists</summary><pre className="kra-code-list">{JSON.stringify(kraCodes, null, 2)}</pre></details>}
          </article>
          <article className="module-card"><h2>Prepare eTIMS invoice drafts</h2><p>Creates a workspace draft. After taxpayer/device approval, initialization and exact KRA code/tax mapping, reviewed requests call the KRA OSCU sandbox or production endpoint selected by the API operator. Sandbox receipts are not fiscal invoices.</p>{invoicesList.filter((invoiceRow) => !complianceDrafts.some((draft) => draft.integration_type === 'kra_etims' && draft.source_id === invoiceRow.id)).map((invoiceRow) => <div className="transaction-row" key={invoiceRow.id}><span><strong>{invoiceRow.customer} · {invoiceRow.description}</strong><small>{money(invoiceRow.amount)} · {invoiceRow.status}</small></span><button className="button button-small" disabled={busy} onClick={() => void createComplianceDraft('kra_etims', invoiceRow.id)}>Create fiscalization draft</button></div>)}{!invoicesList.length && <div className="empty-state">Create an internal invoice first to prepare a draft snapshot.</div>}</article>
          <article className="module-card"><h2>Integration preparation drafts ({complianceDrafts.length})</h2>{complianceDrafts.map((draft) => <div className="compliance-draft-row" key={draft.id}><div className="transaction-row"><span><strong>{draft.integration_type === 'kra_etims' ? 'eTIMS invoice draft' : 'Statutory filing preparation'} · {draft.workflow_status}</strong><small>{draft.payload_version} · Provider status: {draft.provider_status}{draft.external_invoice_number ? ` · KRA invoice ${draft.external_invoice_number}` : ''}</small></span><div className="button-row"><button className="button button-small" onClick={() => downloadComplianceDraft(draft)}>Download snapshot</button>{draft.workflow_status === 'reviewed' && <button className="button button-primary" disabled={busy || draft.provider_status === 'accepted_by_kra' || draft.provider_status === 'submitted_to_kra' || draft.provider_status === 'submission_unknown'} onClick={() => void submitComplianceDraft(draft.id)}>{draft.provider_status === 'accepted_by_kra' ? 'KRA accepted' : draft.provider_status === 'submission_unknown' ? 'Reconcile with KRA' : 'Submit to authority'}</button>}{draft.workflow_status !== 'cancelled' && <button className="button button-small" onClick={() => void updateComplianceDraft(draft.id, 'cancelled')}>Cancel draft</button>}</div></div>
            {draft.integration_type === 'kra_etims' && draft.workflow_status === 'draft' && <div className="kra-fiscal-editor"><h3>KRA OSCU fiscal payload</h3><p>Map the invoice using current KRA codes shown above and qualified tax review. This editor sends a draft to our validator first; no KRA call occurs until “Submit to authority”. Amount and tax groups must reconcile exactly.</p><label className="field-label">KRA sales JSON (OSCU)</label><textarea className="kra-json-editor" rows={18} spellCheck={false} value={kraPayloadEditors[draft.id] ?? JSON.stringify(draft.draft_payload.fiscalPayload ?? {}, null, 2)} onChange={(event) => setKraPayloadEditors((current) => ({ ...current, [draft.id]: event.target.value }))} /><div className="button-row"><button className="button button-secondary" disabled={busy || !kraEtimsConfig?.initialized} onClick={() => void saveKraFiscalPayload(draft.id)}>Validate & save payload</button><button className="button button-small" disabled={busy || !draft.draft_payload.fiscalPayload || !kraEtimsConfig?.initialized} onClick={() => void updateComplianceDraft(draft.id, 'reviewed')}>Mark reviewed</button></div></div>}
            {draft.integration_type === 'kra_etims' && draft.provider_status === 'accepted_by_kra' && <small className="reviewer-note">KRA accepted invoice {draft.external_invoice_number ?? '—'} · signature {draft.fiscal_receipt_signature ?? 'not returned'}. Verify this result in your taxpayer records.</small>}
          </div>)}{!complianceDrafts.length && <div className="empty-state">No preparation drafts yet. Generate an eTIMS draft here or a statutory draft from a posted payroll run.</div>}</article>
          </details>
          <div className="module-footnote"><ShieldCheck size={16} /> Progress notes are self-reported. Payroll figures are estimates requiring qualified Kenyan review; no statutory returns are filed from KashFlow.</div>
        </section> : page === 'Documents' ? <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> DOCUMENTS · PRIVATE WORKSPACE STORAGE</div><h1>Document storage</h1><p className="welcome-subtitle">Upload and retain receipt, invoice, and bank-statement files in this business database. Maximum 5 MB per file.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <article className="module-card"><label className="upload-zone"><span>{busy ? 'Saving document…' : 'Choose files to store'}</span><input type="file" multiple onChange={(event) => { for (const file of Array.from(event.target.files ?? [])) void persistDocument(file); event.currentTarget.value = '' }} /></label>
            {storedDocuments.map((item) => <div className="transaction-row" key={item.id}><span><strong>{item.file_name}</strong><small>{item.mime_type} · {formatAttachmentSize(item.file_size)} · {new Date(item.created_at).toLocaleDateString('en-KE')}</small></span><div className="button-row"><button className="button button-small" onClick={() => void downloadDocument(item.id)}>Download</button><button className="button button-small" onClick={() => void deleteDocument(item.id)}>Delete</button></div></div>)}{!storedDocuments.length && <div className="empty-state">No stored documents yet.</div>}</article>
        </section> : page === 'Reports' ? <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> REPORTS · WORKSPACE RECORDS</div><h1>Business reports</h1><p className="welcome-subtitle">Visual summaries from saved transactions and invoices. These are management views, not audited financial statements.</p>
          <div className="dashboard-grid"><article className="module-card report-chart"><h2>Income vs expenses this month</h2><ResponsiveContainer width="100%" height={260}><BarChart data={chart}><CartesianGrid vertical={false} stroke="#eff0f4" /><XAxis dataKey="date" /><YAxis /><Tooltip formatter={(value) => money(Number(value))} /><Legend /><Bar dataKey="income" fill="#7256df" radius={[5, 5, 0, 0]} /><Bar dataKey="expense" fill="#48b99e" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></article>
            <article className="module-card report-chart"><h2>Recorded cash flow mix</h2><ResponsiveContainer width="100%" height={260}><PieChart><Pie data={[{ name: 'Income', value: Number(dashboard?.totals.monthIncome ?? 0) }, { name: 'Expenses', value: Number(dashboard?.totals.monthExpenses ?? 0) }].filter((item) => item.value > 0)} dataKey="value" nameKey="name" outerRadius={85} label>{['#7256df', '#48b99e'].map((color) => <Cell key={color} fill={color} />)}</Pie><Tooltip formatter={(value) => money(Number(value))} /><Legend /></PieChart></ResponsiveContainer>{Number(dashboard?.totals.monthIncome ?? 0) + Number(dashboard?.totals.monthExpenses ?? 0) === 0 && <div className="empty-state">Add transactions to populate this chart.</div>}</article></div>
          <div className="module-card"><h2>At-a-glance</h2><div className="transaction-row"><span>Recorded income this month</span><strong>{money(dashboard?.totals.monthIncome ?? 0)}</strong></div><div className="transaction-row"><span>Recorded expenses this month</span><strong>{money(dashboard?.totals.monthExpenses ?? 0)}</strong></div><div className="transaction-row"><span>Outstanding invoices</span><strong>{money(dashboard?.invoices.unpaid_amount ?? 0)}</strong></div><p>Sources: saved transactions and invoices. Confirmed payroll payments are included in cash-flow expenses; any unpaid net pay remains a payroll payable in the accounting ledger. Bank-feed rows are included only after review and posting.</p></div>
          {retailReport && <article className="module-card"><h2>Retail and inventory insights</h2><div className="transaction-row"><span>Inventory valuation at recorded unit cost</span><strong>{money(retailReport.totalValuation)}</strong></div><h3>Reorder alerts</h3>{retailReport.reorderAlerts.map((item) => <div className="transaction-row" key={`${item.itemId}-${item.locationId}`}><span><strong>{item.name} · {item.location}</strong><small>{item.quantity} {item.unit} on hand · alert at {item.reorderPoint}</small></span><span className="status-pill amber">Reorder</span></div>)}{!retailReport.reorderAlerts.length && <p>No items are at or below their configured reorder points.</p>}<h3>Best sellers</h3>{retailReport.bestSellers.map((item) => <div className="transaction-row" key={item.itemId}><span><strong>{item.name}</strong><small>{item.quantitySold.toLocaleString('en-KE')} sold · revenue {money(item.revenue)} · cost estimate {money(item.cost)}</small></span><strong>Gross profit est. {money(item.grossProfit)}</strong></div>)}{!retailReport.bestSellers.length && <div className="empty-state">Post product sales to see best sellers and gross profit estimates.</div>}<p className="dialog-note">Inventory value uses current average item cost; product margins are management estimates and do not replace reviewed accounting valuation.</p></article>}
          <article className="module-card"><h2>Cash-flow outlook</h2><p>Three-month estimate based on the average monthly posted ledger activity available over the last six months; not a cash guarantee.</p>{forecast.map((row) => <div className="transaction-row" key={row.period}><span><strong>{row.period}</strong><small>Historical-average estimate</small></span><span>Income {money(row.income)} · Expenses {money(row.expenses)}</span><strong>Net {money(row.income - row.expenses)}</strong></div>)}</article>
          <article className="module-card"><h2>Budget by account</h2><form className="record-form-grid" onSubmit={saveBudget}><label className="field-label">Account<select required value={budgetInput.accountCode} onChange={(event) => setBudgetInput({ ...budgetInput, accountCode: event.target.value })}><option value="">Choose account</option>{accounts.map((accountRow) => <option value={accountRow.code} key={accountRow.code}>{accountRow.code} · {accountRow.name}</option>)}</select></label><label className="field-label">Period<input required type="month" value={budgetInput.period} onChange={(event) => setBudgetInput({ ...budgetInput, period: event.target.value })} /></label><label className="field-label">Budget (KSh)<input required min="0" step="0.01" type="number" value={budgetInput.amount} onChange={(event) => setBudgetInput({ ...budgetInput, amount: event.target.value })} /></label><button className="button button-primary" disabled={busy}>Save budget</button></form>
            {budgets.map((budget) => <div className="transaction-row" key={budget.id}><span><strong>{budget.period} · {budget.account_code} {budget.account_name}</strong><small>Budget {money(budget.budget)} · actual {money(budget.actual)}</small></span><strong>Variance {money(budget.variance)}</strong></div>)}
          </article>
          {agingReport && <article className="module-card"><h2>Receivables and payables aging as at {agingReport.asOf}</h2><div className="dashboard-grid"><div><h3>Customer invoices</h3>{Object.entries(agingReport.receivables.buckets).map(([bucket, amount]) => <div className="transaction-row" key={`ar-${bucket}`}><span>{bucket === 'current' ? 'Not overdue' : bucket.replace('days', 'Days ')}</span><strong>{money(amount)}</strong></div>)}</div><div><h3>Supplier bills</h3>{Object.entries(agingReport.payables.buckets).map(([bucket, amount]) => <div className="transaction-row" key={`ap-${bucket}`}><span>{bucket === 'current' ? 'Not overdue' : bucket.replace('days', 'Days ')}</span><strong>{money(amount)}</strong></div>)}</div></div></article>}
        </section> : page === 'Point of sale' ? <section className="module-page pos-page">
          <div className="eyebrow"><span className="live-dot" /> POINT OF SALE · {dashboard?.workspaceName}</div>
          <h1>{t('Counter checkout')}</h1>
          <p className="welcome-subtitle">Sell from saved inventory. Checkout creates an internal invoice, deducts stock, and records cash payments in your workspace.</p>
          <p className={`pos-connectivity ${isOnline ? 'online' : 'offline'}`} role="status">{isOnline ? 'Online · inventory and prices are current when refreshed.' : 'Offline · using this business’s last cached catalog; stock may have changed. Sales save locally and are not posted until synced.'}</p>
          <p className="dialog-note">Offline drafts and the cached catalog are stored in this browser and are not encrypted by KashFlow. Use offline checkout only on a device protected by your organization.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          {offlinePosDrafts.filter((draft) => draft.workspaceId === account?.workspace.id).length > 0 && <article className="module-card offline-pos-queue">
            <div className="panel-header"><div><h2>Offline sale drafts ({offlinePosDrafts.filter((draft) => draft.workspaceId === account?.workspace.id).length})</h2><p>Stored only in this browser for {dashboard?.workspaceName}; not posted, paid, or deducted from stock.</p></div></div>
            {offlinePosDrafts.filter((draft) => draft.workspaceId === account?.workspace.id).map((draft) => <div className="transaction-row" key={draft.id}><span><strong>{draft.customer} · {money(draft.amount)}</strong><small>{new Date(draft.createdAt).toLocaleString('en-KE')} · {draft.lines.length} item line(s) · location {inventoryLocations.find((location) => location.id === draft.locationId)?.name ?? 'not selected'}</small></span><div className="button-row"><button className="button button-primary button-small" disabled={busy || !isOnline} onClick={() => void syncOfflinePosDraft(draft)}>Sync and validate stock</button><button className="button button-small" disabled={busy} onClick={() => discardOfflinePosDraft(draft)}>Discard</button></div></div>)}
          </article>}
          <div className="pos-layout">
            <section className="module-card pos-catalog" aria-label="Sellable inventory">
              <div className="pos-catalog-head"><div><h2>Items</h2><p>{records.inventory.length} inventory items · {records.inventory.filter((item) => Number(item.data.quantity ?? 0) > 0).length} in stock</p></div>
                <label className="field-label">Selling location<select aria-label="POS selling location" value={posLocationId} onChange={(event) => setPosLocationId(event.target.value)}>{inventoryLocations.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                <label className="pos-search"><Search size={16} /><input aria-label="Search or scan barcode/SKU" placeholder="Search or scan barcode…" value={posSearch} onKeyDown={scanPosBarcode} onChange={(event) => setPosSearch(event.target.value)} /></label>
              </div>
              {!records.inventory.length ? <div className="empty-state">No inventory items yet. Add items with a selling price in Inventory to start a sale.<button className="button button-secondary" onClick={() => navigateTo('Inventory')}>Open inventory</button></div> :
                <div className="pos-item-grid">{posItems.map((item) => {
                  const onHand = Number(inventoryLocationStock.find((stock) => stock.location_id === posLocationId && stock.item_id === item.id)?.quantity ?? 0)
                  const itemName = String(item.data.name ?? 'Inventory item')
                  const sku = String(item.data.sku ?? '')
                  const line = posCart.find((entry) => entry.itemId === item.id)
                  const disabled = onHand <= 0 || Boolean(line && line.quantity >= onHand)
                  return <button type="button" className="pos-item" key={item.id} disabled={disabled} onClick={() => addPosItem(item)}>
                    <span className="pos-item-icon"><Package size={19} /></span><strong>{itemName}</strong>{(sku || item.data.barcode) && <small>{sku}{item.data.barcode ? ` · ${item.data.barcode}` : ''}</small>}
                    <span className={`pos-stock ${onHand <= 5 ? 'low' : ''}`}>{onHand > 0 ? `${onHand} in stock` : 'Out of stock'}</span><b>{money(Number(item.data.price ?? 0))}</b>
                  </button>
                })}{!posItems.length && <div className="empty-state">No items match “{posSearch}”.</div>}</div>
              }
            </section>
            <aside className="module-card pos-checkout" aria-label="Current sale">
              <div className="pos-cart-title"><div><h2>Current sale</h2><p>{posCart.reduce((count, line) => count + line.quantity, 0)} items</p></div><button type="button" className="button button-small" disabled={!posCart.length} onClick={() => setPosCart([])}>Clear</button></div>
              <fieldset className="pos-payment-choice"><legend>Customer type</legend><button type="button" className={posCustomerType === 'walk_in' ? 'selected' : ''} aria-pressed={posCustomerType === 'walk_in'} onClick={() => setPosCustomerType('walk_in')}>Walk-in customer</button><button type="button" className={posCustomerType === 'remote' ? 'selected' : ''} aria-pressed={posCustomerType === 'remote'} onClick={() => setPosCustomerType('remote')}>Remote customer</button></fieldset>
              {posCustomerType === 'remote' && <><label className="field-label">Remote customer name<input required maxLength={160} list="pos-customer-records" placeholder="Customer name" value={posCustomer} onChange={(event) => setPosCustomer(event.target.value)} /><datalist id="pos-customer-records">{records.customers.map((customer) => <option key={customer.id} value={String(customer.data.name ?? '')} />)}</datalist></label><label className="field-label">Customer email (optional)<input type="email" maxLength={254} autoComplete="email" value={posCustomerEmail} onChange={(event) => setPosCustomerEmail(event.target.value)} /></label></>}
              <div className="pos-cart-lines">{posCart.map((line) => <div className="pos-cart-line" key={line.itemId}>
                <div className="pos-line-main"><strong>{line.description}</strong><small>{money(line.unitPrice)} each · {line.onHand} available</small></div>
                <div className="pos-quantity"><button type="button" aria-label={`Remove one ${line.description}`} onClick={() => changePosQuantity(line.itemId, line.quantity - 1)}><Minus size={14} /></button><span>{line.quantity}</span><button type="button" aria-label={`Add one ${line.description}`} disabled={line.quantity >= line.onHand} onClick={() => changePosQuantity(line.itemId, line.quantity + 1)}><Plus size={14} /></button></div>
                <strong className="pos-line-total">{money(line.quantity * line.unitPrice)}</strong>
                <button type="button" className="icon-button pos-remove" aria-label={`Remove ${line.description} from sale`} onClick={() => changePosQuantity(line.itemId, 0)}><Trash2 size={15} /></button>
              </div>)}{!posCart.length && <div className="pos-cart-empty"><ShoppingBag size={22} /><strong>Your sale is empty</strong><span>Select an item to add it to the cart.</span></div>}</div>
              <div className="pos-total-row"><span>Total due</span><strong>{money(posTotal)}</strong></div>
              <fieldset className="pos-payment-choice"><legend>Payment method</legend>
                <button type="button" className={posPaymentMethod === 'cash' ? 'selected' : ''} aria-pressed={posPaymentMethod === 'cash'} onClick={() => setPosPaymentMethod('cash')}><Banknote size={17} />Cash / manual</button>
                <button type="button" className={posPaymentMethod === 'mpesa' ? 'selected' : ''} aria-pressed={posPaymentMethod === 'mpesa'} disabled={!mpesaConfigured} title={mpesaConfigured ? 'Request an M-Pesa STK push' : 'Configure Daraja before requesting M-Pesa'} onClick={() => setPosPaymentMethod('mpesa')}><Smartphone size={17} />M-Pesa{!mpesaConfigured && <small>Setup needed</small>}</button>
              </fieldset>
              {posPaymentMethod === 'mpesa' && <label className="field-label">Customer M-Pesa number<input type="tel" autoComplete="tel" placeholder="07XX XXX XXX" value={posPaymentPhone} onChange={(event) => setPosPaymentPhone(event.target.value)} /></label>}
              <button type="button" className="button button-primary pos-complete" disabled={busy || !posCart.length || posTotal <= 0} onClick={() => void checkoutPos()}>{busy ? 'Processing sale…' : posPaymentMethod === 'mpesa' ? 'Request M-Pesa payment' : 'Complete cash sale'}</button>
              <p className="pos-disclaimer"><ShieldCheck size={14} />Internal invoice only—not a KRA/eTIMS fiscal receipt. M-Pesa requests require configured Daraja; verify payment before releasing goods.</p>
            </aside>
          </div>
          {posReceipt && <div className="module-card pos-last-sale"><div><div className="eyebrow">LAST SALE · {posReceipt.invoiceId.slice(0, 8).toUpperCase()}</div><h2>{money(posReceipt.amount)}</h2><p>{posReceipt.customer} · {posReceipt.status}</p></div>
            <div className="button-row"><button className="button button-secondary" onClick={() => window.print()}><Printer size={15} />{t('Print receipt')}</button><button className="button button-secondary" disabled={posBridgeBusy} onClick={() => void sendPosHardwareCommand('/receipt')}><Printer size={15} />{t('Thermal print')}</button>{posReceipt.paymentMethod === 'cash' && posReceipt.status.startsWith('Paid') && <button className="button button-secondary" disabled={posBridgeBusy} onClick={() => void sendPosHardwareCommand('/cash-drawer')}>{t('Open cash drawer')}</button>}<button className="button button-secondary" onClick={() => navigateTo('Sales')}>Open sales</button>{posReceipt.status.startsWith('Unpaid · payment recording failed') && <button className="button button-primary" disabled={busy} onClick={() => void retryPosCashPayment()}>Retry recording cash payment</button>}</div>
            <details className="module-footnote"><summary>Receipt printer setup · Windows local bridge</summary><p>Install and run the local bridge on this checkout computer, configured for an ESC/POS network printer. It is separate from the browser print option; compatible printer, network access, and drawer cable are required.</p><div className="field-row"><label className="field-label">Local bridge URL<input value={posBridgeAddress} onChange={(event) => changePosBridgeAddress(event.target.value)} placeholder="http://127.0.0.1:17371" /></label><button className="button button-small" disabled={posBridgeBusy} onClick={() => void testPosBridge()}>{posBridgeBusy ? 'Checking…' : t('Test connection')}</button></div>{posBridgeStatus && <p role="status">{t(posBridgeStatus)}</p>}<small>{t('Internal receipt only; not an eTIMS tax invoice.')} Cash drawer is enabled only after a cash payment is recorded.</small></details>
          </div>}
          {posReceipt && <article className="pos-receipt-print"><div className="pos-receipt-brand"><strong>KashFlow</strong><span>{dashboard?.workspaceName}</span></div><h2>{t('SALE RECEIPT')}</h2><p>{t('Invoice')} {posReceipt.invoiceId.slice(0, 8).toUpperCase()} · {today}</p><p>{t('Customer')}: {posReceipt.customer}</p><hr />{posReceipt.lines.map((line) => <div className="pos-receipt-line" key={line.itemId}><span>{line.quantity} × {line.description}</span><strong>{money(line.quantity * line.unitPrice)}</strong></div>)}<hr /><div className="pos-receipt-line"><strong>{t('Total')}</strong><strong>{money(posReceipt.amount)}</strong></div><p>{posReceipt.status}</p><small>{t('Internal receipt only; not an eTIMS tax invoice.')}</small></article>}
        </section> : page === 'Sales' ? <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> SALES · {dashboard?.workspaceName}</div><h1>Invoices</h1><p className="welcome-subtitle">Internal invoices support itemized lines and recorded payments. They are not KRA/eTIMS fiscal tax invoices.</p>
          <button className="button button-primary" onClick={() => { setError(''); setPaymentPhone(''); setModal('invoice') }}>Create invoice</button>
          <div className="module-card">{error && <p className="form-error" role="alert">{error}</p>}{invoicesList.map((invoiceRow) => {
            const latestMpesaPayment = invoiceMpesaPayments[invoiceRow.id]?.[0]
            const promptOpen = mpesaPromptInvoiceId === invoiceRow.id
            const paidAmount = Number(invoiceRow.amount_paid ?? 0)
            const invoiceStatusLabel = invoiceRow.status === 'paid' ? 'Paid' : invoiceRow.status === 'void' ? 'Void' : paidAmount > 0 ? 'Partially paid' : 'Not paid'
            return <div className="invoice-payment-card" key={invoiceRow.id}>
              <div className="transaction-row">
                <span><strong>{invoiceRow.customer} · {invoiceRow.description}</strong><small>Due {invoiceRow.due_date} · paid {money(invoiceRow.amount_paid ?? 0)} · due {money(invoiceRow.amount_due ?? invoiceRow.amount)}</small></span>
                <span className={`status-pill ${invoiceRow.status === 'paid' ? 'green' : 'amber'}`}>{invoiceStatusLabel}</span>
                <strong>{money(invoiceRow.amount)}</strong>
                <button className="button button-small" onClick={() => { setInvoicePreview(invoiceRow); setModal('invoice') }}>Preview / email draft</button>
                {invoiceRow.status !== 'void' && <button className="button button-small" disabled={busy} onClick={() => void shareInvoice(invoiceRow)}>Share invoice</button>}
                {invoiceRow.status === 'unpaid' && <button className="button button-small" disabled={busy || !invoiceRow.customer_email} title={!invoiceRow.customer_email ? 'Add a customer email to this invoice first.' : undefined} onClick={() => void sendInvoiceReminder(invoiceRow)}>Send reminder</button>}
                {invoiceRow.status !== 'void' && <button className="button button-small" onClick={() => void openSalesReturn(invoiceRow)}>Return / credit</button>}
                {invoiceRow.status !== 'paid' && invoiceRow.status !== 'void' && <>
                  <label className="field-label">Payment (KSh)<input min="0.01" max={invoiceRow.amount_due ?? invoiceRow.amount} step="0.01" type="number" value={paymentAmounts[invoiceRow.id] ?? ''} onChange={(event) => setPaymentAmounts((values) => ({ ...values, [invoiceRow.id]: event.target.value }))} /></label>
                  <button className="button button-small" disabled={busy || !paymentAmounts[invoiceRow.id]} onClick={() => void payInvoice(invoiceRow)}>Record payment</button>
                  <button className="button button-small" disabled={!mpesaConfigured || mpesaPromptSubmitting} title={!mpesaConfigured ? 'Daraja M-Pesa is not configured for this business.' : undefined} onClick={() => {
                    if (promptOpen) { setMpesaPromptInvoiceId(null); return }
                    setMpesaPromptInvoiceId(invoiceRow.id)
                    if (!(invoiceRow.id in invoiceMpesaPayments)) void loadInvoiceMpesaPayments(invoiceRow.id)
                  }}>M-Pesa prompt{!mpesaConfigured && ' · setup needed'}</button>
                </>}
                {latestMpesaPayment && <span className={`status-pill ${latestMpesaPayment.status === 'paid' ? 'green' : 'amber'}`}>M-Pesa {latestMpesaPayment.status === 'paid' ? 'paid' : latestMpesaPayment.status.replaceAll('_', ' ')}</span>}
              </div>
              {promptOpen && invoiceRow.status === 'unpaid' && <div className="invoice-mpesa-prompt">
                <label className="field-label">Customer M-Pesa number<input type="tel" autoComplete="tel" placeholder="0712345678" value={invoiceMpesaPhones[invoiceRow.id] ?? ''} onChange={(event) => setInvoiceMpesaPhones((current) => ({ ...current, [invoiceRow.id]: event.target.value }))} /></label>
                <button className="button button-primary button-small" disabled={!mpesaConfigured || mpesaPromptSubmitting || !invoiceMpesaPhones[invoiceRow.id]?.trim() || ['initiating', 'pending', 'verification_required'].includes(latestMpesaPayment?.status ?? '')} onClick={() => void sendInvoiceMpesaPrompt(invoiceRow)}>{mpesaPromptSubmitting ? 'Sending…' : 'Send prompt'}</button>
                {latestMpesaPayment && ['initiating', 'pending', 'verification_required'].includes(latestMpesaPayment.status) && <p className="dialog-note">A request is already {latestMpesaPayment.status.replaceAll('_', ' ')} for this invoice. Refresh its status before sending another prompt.</p>}
                {latestMpesaPayment?.result_description && latestMpesaPayment.status === 'failed' && <p className="form-error" role="alert">Last M-Pesa attempt failed: {latestMpesaPayment.result_description}</p>}
                <button className="button button-small" disabled={mpesaPromptSubmitting} onClick={() => void loadInvoiceMpesaPayments(invoiceRow.id)}>Refresh payment status</button>
                <p className="dialog-note">The invoice remains unpaid until Daraja confirms payment. Verify the result before releasing goods.</p>
              </div>}
            </div>
          })}{!invoicesList.length && <div className="empty-state">No invoices yet. Create one to review and preview it here.</div>}</div>
          <article className="module-card"><h2>Estimates and quotes</h2><p>Estimates do not post to the ledger. Tax amounts are entered by you after qualified review; these documents are not tax invoices.</p><form className="record-form-grid" onSubmit={saveEstimate}><label className="field-label">Customer<input required value={estimateInput.customer} onChange={(event) => setEstimateInput({ ...estimateInput, customer: event.target.value })} /></label><label className="field-label">Customer email<input type="email" value={estimateInput.customerEmail} onChange={(event) => setEstimateInput({ ...estimateInput, customerEmail: event.target.value })} /></label><DraftLineEditor lines={estimateLines} inventoryItems={records.inventory} onChange={(index, key, value) => setEstimateLines((lines) => lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line))} onAdd={() => setEstimateLines((lines) => [...lines, { description: '', quantity: '1', unitPrice: '', discountAmount: '0', taxAmount: '0' }])} onRemove={(index) => setEstimateLines((lines) => lines.filter((_, lineIndex) => lineIndex !== index))} /><p>Estimate total: <strong>{money(draftDocumentTotal(estimateLines))}</strong></p><label className="field-label">Valid until<input required type="date" value={estimateInput.validUntil} onChange={(event) => setEstimateInput({ ...estimateInput, validUntil: event.target.value })} /></label><button className="button button-secondary" disabled={busy}>Save estimate</button></form>
            {estimates.map((estimate) => <div className="transaction-row" key={estimate.id}><span><strong>{estimate.customer} · {estimate.description}</strong><small>{money(estimate.amount)} · valid until {estimate.valid_until} · {estimate.status}</small></span><div className="button-row">{estimate.status === 'draft' && <button className="button button-small" disabled={busy} onClick={() => void updateEstimateStatus(estimate, 'sent')}>Mark sent</button>}{['draft', 'sent'].includes(estimate.status) && <button className="button button-small" disabled={busy} onClick={() => void updateEstimateStatus(estimate, 'accepted')}>Accept</button>}{estimate.status === 'accepted' && !salesOrders.some((order) => order.estimate_id === estimate.id) && <button className="button button-primary" disabled={busy} onClick={() => void createSalesOrder(estimate)}>Create sales order</button>}</div></div>)}
            <h3>Sales order lifecycle</h3>{salesOrders.map((order) => <div className="transaction-row" key={order.id}><span><strong>{order.customer} · SO {order.id.slice(0, 8)}</strong><small>{order.description} · {money(order.amount)} · {order.status}</small></span><div className="button-row">{order.status === 'confirmed' && <><button className="button button-small" disabled={busy} onClick={() => void updateSalesOrder(order, 'fulfilled')}>Mark fulfilled</button><button className="button button-small" disabled={busy} onClick={() => void updateSalesOrder(order, 'cancelled')}>Cancel order</button></>}{order.status === 'fulfilled' && <button className="button button-primary" disabled={busy} onClick={() => { const estimate = estimates.find((item) => item.id === order.estimate_id); if (estimate) void convertEstimate(estimate) }}>Convert fulfilled order to invoice</button>}{order.status === 'cancelled' && <button className="button button-small" disabled={busy} onClick={() => { const estimate = estimates.find((item) => item.id === order.estimate_id); if (estimate) void createSalesOrder(estimate) }}>Reopen order</button>}</div></div>)}{!salesOrders.length && <div className="empty-state">Accepted estimates can become orders before fulfillment and invoicing.</div>}
          </article>
          <article className="module-card"><h2>Recurring transactions</h2><p>Create an invoice or expense schedule. KashFlow never posts a recurring transaction automatically; an admin must run each due item.</p><form className="record-form-grid" onSubmit={saveRecurring}><label className="field-label">Type<select value={recurringInput.type} onChange={(event) => setRecurringInput({ ...recurringInput, type: event.target.value as 'invoice' | 'expense' })}><option value="invoice">Invoice</option><option value="expense">Expense</option></select></label><label className="field-label">Description<input required value={recurringInput.description} onChange={(event) => setRecurringInput({ ...recurringInput, description: event.target.value })} /></label>{recurringInput.type === 'invoice' && <label className="field-label">Customer<input required value={recurringInput.counterparty} onChange={(event) => setRecurringInput({ ...recurringInput, counterparty: event.target.value })} /></label>}<label className="field-label">Amount (KSh)<input required min="0.01" step="0.01" type="number" value={recurringInput.amount} onChange={(event) => setRecurringInput({ ...recurringInput, amount: event.target.value })} /></label><label className="field-label">Frequency<select value={recurringInput.frequency} onChange={(event) => setRecurringInput({ ...recurringInput, frequency: event.target.value as typeof recurringInput.frequency })}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></label><label className="field-label">First due date<input required type="date" value={recurringInput.nextDate} onChange={(event) => setRecurringInput({ ...recurringInput, nextDate: event.target.value })} /></label><button className="button button-primary" disabled={busy}>Save schedule</button></form>
            {recurringTemplates.map((template) => <div className="transaction-row" key={template.id}><span><strong>{template.template_type} · {template.description}</strong><small>{template.frequency} · next {template.next_date} · {template.active ? 'active' : 'paused'}</small></span><strong>{money(template.amount)}</strong><button className="button button-small" disabled={busy || !template.active || template.next_date > today} onClick={() => void runRecurring(template)}>Run due entry</button></div>)}
          </article>
        </section> : page === 'Settings' ? <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> SETTINGS · {dashboard?.workspaceName}</div>
          <h1>Business settings</h1>
          <p className="welcome-subtitle">Update saved workspace defaults and provider preferences for this business. These toggles control whether this workspace allows live integrations and statutory routes.</p>
          <form onSubmit={saveSettings} className="module-card">
            <div className="field-row"><label className="field-label">Business name<input value={settings.businessName || dashboard?.workspaceName || ''} onChange={(event) => setSettings({ ...settings, businessName: event.target.value })} /></label><label className="field-label">Currency<select value={settings.currency} onChange={(event) => setSettings({ ...settings, currency: event.target.value })}><option value="KES">KES</option><option value="USD">USD</option><option value="GBP">GBP</option></select></label></div>
            <div className="field-row"><label className="field-label">Timezone<select value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}><option value="Africa/Nairobi">Africa/Nairobi</option><option value="UTC">UTC</option><option value="Africa/Kampala">Africa/Kampala</option></select></label><label className="field-label">Default invoice terms<select value={settings.invoiceTerms} onChange={(event) => setSettings({ ...settings, invoiceTerms: event.target.value })}><option value="Net 7">Net 7</option><option value="Net 14">Net 14</option><option value="Net 30">Net 30</option></select></label></div>
            <div className="field-row"><label className="field-label checkbox-row"><input type="checkbox" checked={settings.emailAlerts} onChange={(event) => setSettings({ ...settings, emailAlerts: event.target.checked })} /> Email alert preference (delivery not configured)</label><label className="field-label checkbox-row"><input type="checkbox" checked={settings.auditTrail} onChange={(event) => setSettings({ ...settings, auditTrail: event.target.checked })} /> Audit log preference (supported events are recorded)</label></div>
            <div className="field-row"><div className="field-label"><strong>Multi-factor authentication</strong><p className="dialog-note">MFA login enforcement is not implemented. The old preference toggle did not add a second factor; use an identity provider that enforces MFA for production accounts.</p></div><div className="field-label"><strong>Automatic backup cadence</strong><p className="dialog-note">Platform-level hourly backups rotate 24 snapshots when the API operator configures S3 storage and PostgreSQL backup tools. Manage snapshots below with platform authorization.</p></div></div>
            <div className="field-row"><label className="field-label checkbox-row"><input type="checkbox" checked={settings.monoEnabled} onChange={(event) => setSettings({ ...settings, monoEnabled: event.target.checked })} /> Allow Mono bank-feed connections for this business</label><label className="field-label checkbox-row"><input type="checkbox" checked={settings.darajaEnabled} onChange={(event) => setSettings({ ...settings, darajaEnabled: event.target.checked })} /> Allow Daraja / M-Pesa for this business</label></div>
            <div className="field-row"><label className="field-label checkbox-row"><input type="checkbox" checked={settings.kraEtimsLiveEnabled} onChange={(event) => setSettings({ ...settings, kraEtimsLiveEnabled: event.target.checked })} /> Permit live KRA eTIMS usage for this business</label><label className="field-label checkbox-row"><input type="checkbox" checked={settings.statutoryFilingsEnabled} onChange={(event) => setSettings({ ...settings, statutoryFilingsEnabled: event.target.checked })} /> Permit statutory filing routes for this business</label></div>
            <div className="field-row"><label className="field-label checkbox-row"><input type="checkbox" checked={settings.shifEnabled} onChange={(event) => setSettings({ ...settings, shifEnabled: event.target.checked })} /> Enable SHIF route</label><label className="field-label checkbox-row"><input type="checkbox" checked={settings.nssfEnabled} onChange={(event) => setSettings({ ...settings, nssfEnabled: event.target.checked })} /> Enable NSSF route</label><label className="field-label checkbox-row"><input type="checkbox" checked={settings.ahlEnabled} onChange={(event) => setSettings({ ...settings, ahlEnabled: event.target.checked })} /> Enable AHL route</label></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions"><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
          </form>
            <section className="module-card">
              <h2>Platform database backups</h2>
              <p>Automatic hourly full-database backups require the API operator to configure S3-compatible storage and `pg_dump`/`pg_restore`. The service rotates 24 UTC hourly slots; a slot is overwritten every 24 hours. Restore affects every business in the database, first creates a safety backup, and should be done during planned downtime.</p>
              <label className="field-label">Platform backup operator token<input type="password" autoComplete="off" value={backupOperatorToken} onChange={(event) => setBackupOperatorToken(event.target.value)} /></label>
              <div className="button-row"><button type="button" className="button button-secondary" disabled={busy || !backupOperatorToken} onClick={() => void loadDatabaseBackups()}>Load backup list</button><button type="button" className="button button-primary" disabled={busy || !backupOperatorToken} onClick={() => void createDatabaseBackupNow()}>{busy ? 'Working…' : 'Create backup now'}</button></div>
              {backupStatus && <p role="status" className="dialog-note">{backupStatus}</p>}
              {databaseBackups.length > 0 && <><div className="backup-list">{databaseBackups.map((backup) => <div className="transaction-row" key={backup.key}><span><strong>{backup.key}</strong><small>{backup.lastModified ? new Date(backup.lastModified).toLocaleString('en-KE') : 'Timestamp unavailable'} · {(backup.size / (1024 * 1024)).toFixed(1)} MB</small></span></div>)}</div>
                <form className="module-card backup-restore-form" onSubmit={(event) => void restoreDatabaseBackupNow(event)}>
                  <h3>Restore full database</h3>
                  <label className="field-label">Hourly backup<select required value={restoreBackupKey} onChange={(event) => setRestoreBackupKey(event.target.value)}><option value="">Choose a backup</option>{databaseBackups.map((backup) => <option key={backup.key} value={backup.key}>{backup.lastModified ? new Date(backup.lastModified).toLocaleString('en-KE') : backup.key}</option>)}</select></label>
                  <label className="field-label">Type RESTORE THE ENTIRE DATABASE to confirm<input required autoComplete="off" value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} /></label>
                  <button className="button button-primary backup-restore-button" disabled={busy || !restoreBackupKey || restoreConfirmation !== 'RESTORE THE ENTIRE DATABASE'}>Restore selected backup</button>
                </form>
              </>}
              <p className="dialog-note">Backups contain every business and encrypted payroll/integration secrets. S3 server-side AES256 is requested; also enable private-bucket access controls and retention/versioning policies in your provider console. Store the operator token outside the app and rotate it if exposed.</p>
            </section>
            <section className="module-card">
              <h2>Export workspace data</h2>
              <p>Download business-scoped CSV files for reporting, migration, or accountant review. Exports are limited to 50,000 rows and require administrator access.</p>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="button-row">{['customers', 'suppliers', 'inventory', 'projects', 'invoices', 'bills', 'transactions', 'journals', 'audit'].map((type) => <button key={type} className="button button-secondary" disabled={exportBusy} onClick={() => void exportWorkspaceData(type)}>{exportBusy ? 'Preparing…' : `Export ${type}`}</button>)}</div>
            </section>
            <section className="module-card">
              <h2>Import records from CSV</h2>
              <p>Preview and check up to 500 customers, suppliers, inventory items, or projects before importing. Existing names and repeated rows are skipped. Inventory opening quantity and cost create stock movements and a balanced opening journal. This does not import invoices, payroll, bank transactions, attachments, or supplier item links.</p>
              <div className="field-row"><label className="field-label">Record type<select value={recordImportType} disabled={busy} onChange={(event) => { setRecordImportType(event.target.value as ImportType); setRecordImportPreview(null); setRecordImportRows([]) }}><option value="customers">Customers</option><option value="suppliers">Suppliers</option><option value="inventory">Inventory</option><option value="projects">Projects</option></select></label><label className="field-label">CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewRecordImport(file); event.target.value = '' }} /></label></div>
              <p className="dialog-note">Use a <code>name</code> header, followed by supported fields for the selected type (for example <code>email,phone,address,taxPin,notes</code> or inventory <code>sku,barcode,quantity,unit,cost,price,reorderPoint</code>). Exported KashFlow CSVs include system IDs and timestamps; imports create new records and do not restore IDs.</p>
              {recordImportPreview && <div className="transaction-row"><span><strong>Preview: {recordImportPreview.wouldImport} new records</strong><small>{recordImportPreview.totalRows} valid rows · {recordImportPreview.duplicateRows.length} duplicate rows will be skipped{recordImportPreview.duplicateRows.length ? ` (CSV row ${recordImportPreview.duplicateRows.join(', ')})` : ''}</small></span><div className="button-row"><button className="button button-secondary" disabled={busy} onClick={() => { setRecordImportPreview(null); setRecordImportRows([]) }}>Discard preview</button><button className="button button-primary" disabled={busy || !recordImportPreview.wouldImport} onClick={() => void commitRecordImport()}>{busy ? 'Importing…' : `Import ${recordImportPreview.wouldImport} records`}</button></div></div>}
            </section>
            <section className="module-card">
              <div className="panel-header"><div><h2>Audit activity</h2><p>Recent supported accounting events are retained for internal review. This is an application log, not an independently certified audit.</p></div><button className="button button-secondary" disabled={busy} onClick={() => void loadAuditEvents()}>{busy ? 'Loading…' : 'Load audit log'}</button></div>
              {auditEvents.map((event) => <div className="transaction-row" key={event.id}><span><strong>{event.event_type.replaceAll('.', ' ')}</strong><small>{event.entity_type}{event.entity_id ? ` · ${event.entity_id.slice(0, 8)}` : ''} · {new Date(event.created_at).toLocaleString('en-KE')}</small></span><small>{JSON.stringify(event.event_data)}</small></div>)}
              {!auditEvents.length && <p className="dialog-note">Load recent supported events. Not all record reads or edits are currently audited.</p>}
            </section>
            <section className="module-card">
              <h2>{t('Online store and customer orders')}</h2>
              <p>Publish a simple product catalog and accept order requests. Customers do not pay online here; verify stock, shipping, tax, and payment before fulfillment.</p>
              <form className="record-form-grid" onSubmit={saveStoreSettings}>
                <label className="field-label checkbox-row"><input type="checkbox" checked={storeConfig.enabled} onChange={(event) => setStoreConfig({ ...storeConfig, enabled: event.target.checked })} /> {t('Store is open to customers')}</label>
                <label className="field-label">{t('Store address slug')}<input required minLength={3} maxLength={50} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={storeConfig.slug} onChange={(event) => setStoreConfig({ ...storeConfig, slug: event.target.value })} /></label>
                <label className="field-label">{t('Store name')}<input required maxLength={120} value={storeConfig.title} onChange={(event) => setStoreConfig({ ...storeConfig, title: event.target.value })} /></label>
                <label className="field-label">Description<textarea maxLength={1000} value={storeConfig.description} onChange={(event) => setStoreConfig({ ...storeConfig, description: event.target.value })} /></label>
                <div className="button-row"><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : t('Save store')}</button>{storeConfig.enabled && storeConfig.slug && <a className="button button-secondary" href={`/store/${encodeURIComponent(storeConfig.slug)}`} target="_blank" rel="noreferrer">{t('Preview customer store')}</a>}</div>
              </form>
              <h3>{t('Customer order requests')} ({storeOrders.filter((order) => order.source !== 'woocommerce').length})</h3>
              {storeOrders.map((order) => <div className="transaction-row" key={order.id}><span><strong>{order.customer_name} · {money(order.total)}</strong><small>{order.source === 'woocommerce' ? `WooCommerce #${order.external_order_id ?? ''} · ` : ''}{order.customer_email}{order.customer_phone ? ` · ${order.customer_phone}` : ''} · {t(order.status)} · {new Date(order.created_at).toLocaleDateString('en-KE')}</small></span><div className="button-row">{order.status === 'pending_review' && <><button className="button button-small" disabled={busy} onClick={() => void updateStoreOrder(order, 'accepted')}>{t('Accept')}</button><button className="button button-small" disabled={busy} onClick={() => void updateStoreOrder(order, 'rejected')}>{t('Reject')}</button></>}{order.status === 'accepted' && !order.invoice_id && <button className="button button-small" disabled={busy} onClick={() => void convertStoreOrder(order)}>{t('Convert to invoice')}</button>}{order.status === 'invoiced' && order.invoice_id && <button className="button button-small" disabled={busy} onClick={() => void updateStoreOrder(order, 'fulfilled')}>{t('Mark fulfilled')}</button>}{order.invoice_id && <small>Invoice {order.invoice_id.slice(0, 8)}</small>}</div></div>)}
              {!storeOrders.length && <div className="empty-state">No online order requests yet.</div>}
            </section>
            <section className="module-card">
              <h2>{t('WooCommerce')}</h2>
              <p>Connect a WooCommerce REST API key to synchronize products and import orders as pending review. Configure <code>ONLINE_COMMERCE_ENCRYPTION_KEY</code> on the API server. Connection is not a payment integration.</p>
              {wooConnection && <p role="status">Connected to {wooConnection.store_url} · {wooConnection.enabled ? 'enabled' : 'disabled'}{wooConnection.last_synced_at ? ` · last sync ${new Date(wooConnection.last_synced_at).toLocaleString()}` : ''}</p>}
              {!wooEncryptionReady && <p className="form-error" role="alert">Secure credential storage is not configured on the API server.</p>}
              <form className="record-form-grid" onSubmit={saveWooCommerce}>
                <label className="field-label">WooCommerce store URL<input required type="url" placeholder="https://shop.example.com" value={wooCredentials.storeUrl} onChange={(event) => setWooCredentials({ ...wooCredentials, storeUrl: event.target.value })} /></label>
                <label className="field-label">REST API consumer key<input required autoComplete="off" value={wooCredentials.consumerKey} onChange={(event) => setWooCredentials({ ...wooCredentials, consumerKey: event.target.value })} /></label>
                <label className="field-label">REST API consumer secret<input required type="password" autoComplete="new-password" value={wooCredentials.consumerSecret} onChange={(event) => setWooCredentials({ ...wooCredentials, consumerSecret: event.target.value })} /></label>
                <div className="button-row"><button className="button button-primary" disabled={busy || !wooEncryptionReady}>{t('Save encrypted connection')}</button><button type="button" className="button button-secondary" disabled={busy || !wooConnection?.enabled} onClick={() => void syncWooCommerce('products')}>{t('Sync products')}</button><button type="button" className="button button-secondary" disabled={busy || !wooConnection?.enabled} onClick={() => void syncWooCommerce('orders')}>{t('Import new orders')}</button></div>
              </form>
            </section>
            <section className="module-card" id="team-permissions">
              <h2>Team &amp; Permissions</h2>
              <p>Add workspace users even when they are not employees. Invitations create business access only; they do not create payroll or employee records. Assign built-in or custom roles and edit each person’s effective access here.</p>
              <button className="button button-secondary" onClick={() => { setError(''); setInviteLink(''); setModal('invite') }}><Users size={15} /> Add user (not an employee)</button>
              <form className="module-card record-form-grid" onSubmit={(event) => void saveCustomRole(event)}>
                <h3>{editingCustomRoleKey ? `Edit role: ${customRoleDraft.name}` : 'Add a custom role'}</h3>
                <label className="field-label">Custom role name<input required minLength={2} maxLength={60} disabled={Boolean(editingCustomRoleKey)} value={customRoleDraft.name} onChange={(event) => setCustomRoleDraft({ ...customRoleDraft, name: event.target.value })} placeholder="e.g. Sales assistant" /></label>
                <div className="field-row">{([
                  ['operations.write', 'Operations'],
                  ['sales.write', 'Sales'],
                  ['inventory.write', 'Inventory'],
                  ['accounting.write', 'Accounting'],
                  ['banking.write', 'Banking'],
                  ['payroll.manage', 'Payroll'],
                  ['integrations.manage', 'Integrations'],
                  ['workspace.manage', 'Business settings'],
                  ['team.manage', 'Team management'],
                  ['store.manage', 'Online store'],
                ] as Array<[MemberPermission, string]>).map(([permission, label]) => <label className="field-label checkbox-row" key={permission}><input type="checkbox" checked={customRoleDraft.permissions.includes(permission)} onChange={(event) => toggleCustomRolePermission(permission, event.target.checked)} /> {label}</label>)}</div>
                <div className="button-row"><button className="button button-primary" disabled={busy || !customRoleDraft.name.trim()}>{editingCustomRoleKey ? 'Save role permissions' : 'Create custom role'}</button>{editingCustomRoleKey && <button type="button" className="button button-secondary" onClick={cancelCustomRoleEdit}>Cancel</button>}</div>
              </form>
              {customRoles.map((role) => <div className="transaction-row" key={role.id}><span><strong>{role.roleName}</strong><small>{role.permissions.length ? role.permissions.join(' · ') : 'Read-only access'}</small></span><button className="button button-small" onClick={() => editCustomRole(role)}>Edit permissions</button></div>)}
              {teamMembers.filter((member) => member.role !== 'admin').map((member) => {
                const role = memberRoleDrafts[member.userId] ?? member.role
                const permissionDraft = memberPermissionDrafts[member.userId] ?? member.defaultPermissions
                const isOverridden = memberPermissionOverrides[member.userId] ?? (member.permissions !== null)
                return <div className="team-permission-card" key={member.userId}>
                <div className="team-member-heading"><div><h3>{member.email || member.phone}</h3><p>Current role: {member.role}</p></div><span className="status-pill green">Active member</span></div>
                <label className="field-label">Assigned role<select value={role} disabled={busy} onChange={(event) => assignMemberRole(member.userId, event.target.value)}>
                  <option value="accountant">Accountant</option><option value="staff">Staff</option><option value="viewer">Viewer</option>
                  {customRoles.map((customRole) => <option key={customRole.roleKey} value={customRole.roleKey}>{customRole.roleName}</option>)}
                </select></label>
                <label className="field-label checkbox-row"><input type="checkbox" checked={isOverridden} disabled={busy} onChange={(event) => {
                  setMemberPermissionOverrides((current) => ({ ...current, [member.userId]: event.target.checked }))
                  if (event.target.checked && !(memberPermissionDrafts[member.userId]?.length)) {
                    setMemberPermissionDrafts((current) => ({ ...current, [member.userId]: permissionsForRole(role) }))
                  }
                }} /> Customize individual privileges instead of using this role’s defaults</label>
                <div className={`field-row team-permission-grid ${isOverridden ? '' : 'permissions-inherited'}`}>{([
                  ['operations.write', 'Operations'],
                  ['sales.write', 'Sales'],
                  ['inventory.write', 'Inventory'],
                  ['accounting.write', 'Accounting'],
                  ['banking.write', 'Banking'],
                  ['payroll.manage', 'Payroll'],
                  ['integrations.manage', 'Integrations'],
                  ['workspace.manage', 'Business settings'],
                  ['team.manage', 'Team management'],
                  ['store.manage', 'Online store'],
                ] as Array<[MemberPermission, string]>).map(([permission, label]) => <label className="field-label checkbox-row" key={permission}><input type="checkbox" disabled={!isOverridden || busy} checked={permissionDraft.includes(permission)} onChange={(event) => toggleMemberPermission(member.userId, permission, event.target.checked)} /> {label}</label>)}</div>
                <div className="button-row"><button className="button button-primary" disabled={busy} onClick={() => void saveMemberPermissions(member)}>{busy ? 'Saving…' : 'Save role & privileges'}</button><span className="dialog-note">{isOverridden ? 'Custom privileges will override role defaults.' : 'Using the selected role’s saved privileges.'}</span></div>
              </div>})}
              {!teamMembers.some((member) => member.role !== 'admin') && <div className="empty-state">Invite a team member to manage their access here.</div>}
            </section>
        </section> : page === 'Help' ? <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> HELP & SUPPORT · {dashboard?.workspaceName}</div>
          <h1>Customer help centre</h1>
          <p className="welcome-subtitle">Search by setting, feature, or item across the system and review the most common guidance for your team.</p>
          <div className="module-card">
            <label className="field-label">Search the system for a setting or feature
              <input value={helpSearch} onChange={(event) => setHelpSearch(event.target.value)} placeholder="Try: invoice, payroll, bank statement, settings..." />
            </label>
            <div className="help-results">
              {helpResults.map((item) => <div key={item.title} className="help-result"><strong>{item.title}</strong><small>{item.category}</small><p>{item.keywords.join(', ')}</p></div>)}
              {!helpResults.length && <div className="empty-state">No matching help topics found. Try a broader keyword like invoice, payroll, or settings.</div>}
            </div>
          </div>
          <div className="module-card">
            <details open>
              <summary>FAQ</summary>
              <ul className="help-list">
                <li>How do I add a business or switch workspaces? Use Add business from the sidebar or the business switcher.</li>
                <li>How do I create an invoice? Open Overview and click Create invoice.</li>
                <li>How do I add a transaction? Use Add transaction from Overview or the Accounting section.</li>
                <li>How do I manage payroll? Open Payroll and add employees, create a run, then review and post it.</li>
              </ul>
            </details>
            <details>
              <summary>Search for a specific item or setting</summary>
              <ul className="help-list">
                <li>Use the top search box to quickly filter records, settings, and help topics.</li>
                <li>Common searches: invoice, payroll, bank statement, receipt, settings, business name, customer, employee.</li>
                <li>Use the sidebar to jump directly to Settings, Payroll, Accounting, Sales, or Overview.</li>
              </ul>
            </details>
            <details>
              <summary>How to use the software</summary>
              <ol className="help-list ordered">
                <li>Set up your business by creating the admin account and business profile.</li>
                <li>Add employees, suppliers, and your first transactions or invoices.</li>
                <li>Review accounting entries, payroll runs, and cash flow from the main dashboard.</li>
                <li>Upload receipts, files, and bank statements into the intake queue for review.</li>
                <li>Use Settings to keep defaults, user security, and notifications aligned to your current business needs.</li>
              </ol>
            </details>
          </div>
        </section> : <section className="module-page">
          <div className="eyebrow"><span className="live-dot" /> WORKSPACE</div><h1>{page}</h1><p className="welcome-subtitle">{descriptions[page] ?? 'This module is not configured yet.'}</p>
          <div className="module-card"><div className="module-icon"><ShieldCheck size={23} /></div>
            <h2>{page === 'Kenya compliance' ? 'Integrations are inactive' : `${page} is not implemented yet`}</h2>
            <p>{page === 'Kenya compliance' ? 'KRA/eTIMS and bank feeds are not connected, and statutory filing is unavailable. The payroll module provides estimates only. Saved manual records remain available in your workspace.' : 'This area does not yet have live functionality. Use the overview to add a transaction or invoice to your workspace database.'}</p>
          </div>
          <div className="module-footnote"><ShieldCheck size={16} /> Only records you or an authorized integration save to this workspace are displayed.</div>
        </section>}
      </div>
    </main>

    {modal && <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !busy) setModal(null) }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-head"><div><div className="eyebrow">{dashboard?.workspaceName}</div><h2 id="dialog-title">{modal === 'invoice' ? invoicePreview ? 'Invoice preview' : 'Create an invoice' : modal === 'business' ? 'Add a business' : modal === 'invite' ? 'Invite workspace user' : modal === 'return' ? 'Record a return or credit' : 'Add a transaction'}</h2></div>
          <button className="icon-button" aria-label="Close dialog" onClick={() => setModal(null)}><X size={19} /></button>
        </div>
        {modal === 'business' ? <form onSubmit={createBusiness}>
          <label className="field-label">Business name<input required maxLength={120} value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create business'}</button></div>
        </form> : null}
        {modal === 'invite' ? <form onSubmit={inviteUser}>
          <p className="dialog-note">This invitation adds a user to this business workspace. It does not create an employee or payroll record.</p>
          <label className="field-label">Email<input type="email" required value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></label>
          <label className="field-label">Role<select value={invite.role} onChange={(event) => { const role = event.target.value; setInvite({ ...invite, role }); if (customRoles.some((item) => item.roleKey === role)) setInviteScope('single') }}>
            <option value="accountant">Accountant</option>
            <option value="staff">Staff</option>
            <option value="viewer">Viewer</option>
            {customRoles.map((role) => <option key={role.roleKey} value={role.roleKey}>{role.roleName} (custom)</option>)}
          </select></label>
          <fieldset className="field-label" style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
            <legend>Business access</legend>
            <label><input type="radio" name="invite-scope" checked={inviteScope === 'single'} onChange={() => setInviteScope('single')} /> This business only ({dashboard?.workspaceName})</label>
            <label><input type="radio" name="invite-scope" checked={inviteScope === 'all_owned'} disabled={customRoles.some((role) => role.roleKey === invite.role)} onChange={() => setInviteScope('all_owned')} /> All businesses I administer</label>
            <small>{customRoles.some((role) => role.roleKey === invite.role) ? 'Custom roles are specific to this business.' : 'All-business access applies only to businesses where you are an admin.'}</small>
          </fieldset>
          <p className="dialog-note"><ShieldCheck size={15} /> Invitations expire after seven days. Custom roles use this business’s saved permissions and apply to this business only. If email is not configured, copy and send the secure link yourself.</p>
          {inviteLink && <label className="field-label">Secure invitation link<input readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} /><small>Share only with the invited person. It expires in seven days and works once.</small></label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button></div>
        </form> : null}
        {modal === 'return' && returnInvoice ? <form onSubmit={saveSalesReturn}>
          <p className="dialog-note">Return against invoice {returnInvoice.id.slice(0, 8)} for {returnInvoice.customer}. This creates an internal credit note and ledger posting; any cash refund must be made separately through your normal payment method.</p>
          <label className="field-label">Reason<input required maxLength={500} value={returnInput.reason} onChange={(event) => setReturnInput({ ...returnInput, reason: event.target.value })} /></label>
          <label className="field-label">Cash refund to record (KSh)<input required type="number" min="0" step="0.01" value={returnInput.refundAmount} onChange={(event) => setReturnInput({ ...returnInput, refundAmount: event.target.value })} /><small>Must be no greater than the return value or cash previously collected and not already refunded.</small></label>
          <label className="checkbox-row"><input type="checkbox" checked={returnInput.restock} onChange={(event) => setReturnInput({ ...returnInput, restock: event.target.checked })} /> Restock returned inventory items at the original invoice location</label>
          <fieldset className="draft-line"><legend>Returned lines</legend>{returnLines.map((line) => <label className="field-label" key={line.id}>{line.description} · remaining {Number(line.quantity) - Number(line.returned_quantity)}{line.item_id ? ' · inventory item' : ''}<input type="number" min="0" max={Number(line.quantity) - Number(line.returned_quantity)} step="0.001" value={returnQuantities[line.id] ?? ''} onChange={(event) => setReturnQuantities((current) => ({ ...current, [line.id]: event.target.value }))} /></label>)}</fieldset>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Recording…' : 'Record return'}</button></div>
        </form> : null}
        {modal === 'invoice' && invoicePreview ? <article className="invoice-preview-card">
          <div className="invoice-preview-brand"><div><strong>KashFlow</strong><small>{dashboard?.workspaceName}</small></div><span>{invoicePreview.id ? `Invoice ${invoicePreview.id.slice(0, 8).toUpperCase()}` : 'INVOICE PREVIEW'}</span></div>
          <h2>Invoice</h2><div className="invoice-preview-grid"><span>Bill to<strong>{invoicePreview.customer}</strong><small>{invoicePreview.customer_email || 'No email address added'}</small></span><span>Due date<strong>{invoicePreview.due_date}</strong><small>Status: {invoicePreview.status || 'Draft'}</small></span></div>
          <div className="invoice-preview-line"><span>{invoicePreview.description}</span><strong>{money(invoicePreview.amount)}</strong></div><div className="invoice-preview-total"><span>Total due</span><strong>{money(invoicePreview.amount)}</strong></div>
          <p className="dialog-note"><ShieldCheck size={15} /> Internal business invoice preview—not an eTIMS fiscal tax invoice. {emailConfigured ? 'Send uses the configured Resend provider; accepted does not guarantee recipient delivery.' : 'Outbound provider delivery is not configured; the email-draft option opens your mail application.'}</p>
          <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => { setInvoicePreview(null); setModal(invoicePreview.id ? null : 'invoice') }}>{invoicePreview.id ? 'Close preview' : 'Edit invoice'}</button><button type="button" className="button button-secondary" onClick={() => window.print()}>Print</button>{invoicePreview.id && invoicePreview.customer_email && (emailConfigured ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void sendInvoiceEmail(invoicePreview.id)}>{busy ? 'Sending…' : 'Send invoice email'}</button> : <a className="button button-primary" href={`mailto:${encodeURIComponent(invoicePreview.customer_email)}?subject=${encodeURIComponent(`Invoice ${invoicePreview.id.slice(0, 8)} from ${dashboard?.workspaceName}`)}&body=${encodeURIComponent(`Hello ${invoicePreview.customer},\n\nPlease find invoice ${invoicePreview.id.slice(0, 8)} for ${money(invoicePreview.amount)} due ${invoicePreview.due_date}.\n\n${invoicePreview.description}\n\nRegards,\n${dashboard?.workspaceName}`)}`}>Open email draft</a>)}</div>
        </article> : null}
        {modal === 'invoice' && !invoicePreview ? <form onSubmit={saveInvoice}>
          <label className="field-label">Customer<input required maxLength={160} list="customer-records" value={invoice.customer} onChange={(event) => setInvoice({ ...invoice, customer: event.target.value })} /><datalist id="customer-records">{records.customers.map((customer) => <option key={customer.id} value={String(customer.data.name)} />)}</datalist></label>
          <label className="field-label">Customer email (for email draft)<input type="email" value={invoice.customerEmail} onChange={(event) => setInvoice({ ...invoice, customerEmail: event.target.value })} /></label>
          {invoiceLines.some((line) => line.itemId) && <label className="field-label">Stock location<select value={invoiceLocationId} onChange={(event) => setInvoiceLocationId(event.target.value)}>{inventoryLocations.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
          <DraftLineEditor lines={invoiceLines} inventoryItems={records.inventory} onChange={(index, key, value) => setInvoiceLines((lines) => lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line))} onAdd={() => setInvoiceLines((lines) => [...lines, { description: '', quantity: '1', unitPrice: '', discountAmount: '0', taxAmount: '0' }])} onRemove={(index) => setInvoiceLines((lines) => lines.filter((_, lineIndex) => lineIndex !== index))} />
          <p className="dialog-note">Invoice total: <strong>{money(draftDocumentTotal(invoiceLines))}</strong></p>
          <label className="field-label">Due date<input required type="date" value={invoice.dueDate} onChange={(event) => setInvoice({ ...invoice, dueDate: event.target.value })} /></label>
          <label className="field-label">M-Pesa phone (optional)
            <input type="tel" autoComplete="tel" placeholder="0712345678" value={paymentPhone} onChange={(event) => setPaymentPhone(event.target.value)} />
            <small>If Daraja is configured, saving sends an STK Push request for the invoice total. Amounts with fractional shillings may not be accepted by the provider.</small>
          </label>
          <p className="dialog-note"><ShieldCheck size={15} /> The invoice itself is not emailed and is not a KRA/eTIMS tax invoice. An optional phone number sends a separate M-Pesa payment prompt.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button type="button" className="button button-secondary" onClick={() => setInvoicePreview({ id: '', customer: invoice.customer, customer_email: invoice.customerEmail, description: invoiceLines.map((line) => line.description).filter(Boolean).join('; '), amount: String(draftDocumentTotal(invoiceLines)), due_date: invoice.dueDate, status: 'Draft' })}>Preview</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save invoice'}</button></div>
        </form> : null}
        {modal === 'transaction' ? <form onSubmit={saveTransaction}>
          <label className="field-label">Description<input required maxLength={240} value={transaction.description} onChange={(event) => setTransaction({ ...transaction, description: event.target.value })} /></label>
          <div className="field-row"><label className="field-label">Amount (KSh)<input required min="0.01" step="0.01" type="number" value={transaction.amount} onChange={(event) => setTransaction({ ...transaction, amount: event.target.value })} /></label>
            <label className="field-label">Type<select value={transaction.direction} onChange={(event) => setTransaction({ ...transaction, direction: event.target.value as 'expense' | 'income' })}><option value="expense">Expense</option><option value="income">Income</option></select></label>
          </div>
          <div className="field-row"><label className="field-label">Account<input required maxLength={80} value={transaction.account} onChange={(event) => setTransaction({ ...transaction, account: event.target.value })} /></label>
            <label className="field-label">Date<input required type="date" value={transaction.date} onChange={(event) => setTransaction({ ...transaction, date: event.target.value })} /></label>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save transaction'}</button></div>
        </form> : null}
      </div>
    </div>}
    {toast && <div className="toast"><span><Check size={15} /></span>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>
}

export default App
