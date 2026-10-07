import { useEffect, useState } from 'react'

type SupplierBill = {
  id: string
  supplier: string
  description: string
  amount: string
  amount_paid?: string
  amount_due?: string
  bill_date: string
  due_date: string
  status: string
  approval_status?: string
}

type BillLine = {
  id: string
  line_number: number
  description: string
  quantity: string
  unit_price: string
  discount_amount: string
  tax_amount: string
  recoverable_tax_amount: string
  total_amount: string
}

type BillInfo = SupplierBill & {
  supplier_email: string
  business_name: string
}

type EmailEvent = {
  id: string
  recipient: string
  provider: string
  status: string
  provider_message_id?: string | null
  failure_reason?: string | null
  created_at: string
}

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'
).replace(/\/$/, '')

function money(value: string | number) {
  return `KSh ${Number(value).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function SupplierBillEmailSection({
  bill,
}: {
  bill: SupplierBill
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [info, setInfo] = useState<BillInfo | null>(null)
  const [lines, setLines] = useState<BillLine[]>([])
  const [events, setEvents] = useState<EmailEvent[]>([])
  const [recipient, setRecipient] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function load() {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(
        `${API_BASE}/v1/bills/${bill.id}/email-info`,
        {
          credentials: 'include',
        },
      )

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(
          payload.error || 'Could not load supplier bill information.',
        )
      }

      setInfo(payload.bill)
      setLines(payload.lines || [])
      setRecipient(payload.bill.supplier_email || '')
      setMessage(
        `Hello ${payload.bill.supplier},

Please find the supplier bill recorded by ${payload.bill.business_name}.

This email contains the complete bill details together with the total amount, amount paid and remaining balance.`,
      )

      const historyResponse = await fetch(
        `${API_BASE}/v1/bills/${bill.id}/email-history`,
        {
          credentials: 'include',
        },
      )

      if (historyResponse.ok) {
        const history = await historyResponse.json()
        setEvents(history.events || [])
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not load supplier bill information.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && !info) {
      void load()
    }
  }, [open])

  async function send() {
    if (!recipient.trim()) {
      setError('Enter the supplier email address.')
      return
    }

    setSending(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch(
        `${API_BASE}/v1/bills/${bill.id}/email`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipient: recipient.trim(),
            message,
          }),
        },
      )

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(
          payload.error || 'Could not send the supplier bill.',
        )
      }

      setSuccess(
        `Supplier bill accepted for delivery to ${recipient.trim()}.`,
      )

      const historyResponse = await fetch(
        `${API_BASE}/v1/bills/${bill.id}/email-history`,
        {
          credentials: 'include',
        },
      )

      if (historyResponse.ok) {
        const history = await historyResponse.json()
        setEvents(history.events || [])
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not send the supplier bill.',
      )
    } finally {
      setSending(false)
    }
  }

  const total = Number(info?.amount ?? bill.amount)
  const paid = Number(info?.amount_paid ?? bill.amount_paid ?? 0)
  const remaining = Math.max(
    0,
    Number(info?.amount_due ?? bill.amount_due ?? total - paid),
  )

  return (
    <div
      style={{
        marginTop: 12,
        borderTop: '1px solid var(--border, #e5e7eb)',
        paddingTop: 12,
      }}
    >
      <button
        type="button"
        className="button button-small"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide supplier email section' : 'Send bill to supplier'}
      </button>

      {open && (
        <div
          style={{
            marginTop: 14,
            padding: 18,
            borderRadius: 14,
            background: 'var(--surface-muted, #f8fafc)',
            border: '1px solid var(--border, #e5e7eb)',
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <strong>Supplier Bill Email</strong>
            <p
              style={{
                margin: '5px 0 0',
                fontSize: 13,
                opacity: 0.7,
              }}
            >
              Send the complete recorded bill to the supplier, including
              total amount, paid amount and remaining balance.
            </p>
          </div>

          {loading && (
            <p className="dialog-note">
              Loading the complete supplier bill...
            </p>
          )}

          {!loading && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit,minmax(150px,1fr))',
                  gap: 10,
                  marginBottom: 18,
                }}
              >
                <div className="module-card">
                  <small>Total amount</small>
                  <strong>{money(total)}</strong>
                </div>

                <div className="module-card">
                  <small>Paid</small>
                  <strong>{money(paid)}</strong>
                </div>

                <div className="module-card">
                  <small>Remaining</small>
                  <strong>{money(remaining)}</strong>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit,minmax(180px,1fr))',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div>
                  <small>Supplier</small>
                  <div><strong>{info?.supplier}</strong></div>
                </div>

                <div>
                  <small>Bill date</small>
                  <div><strong>{info?.bill_date}</strong></div>
                </div>

                <div>
                  <small>Due date</small>
                  <div><strong>{info?.due_date}</strong></div>
                </div>

                <div>
                  <small>Status</small>
                  <div>
                    <strong>
                      {info?.approval_status === 'pending'
                        ? 'Awaiting approval'
                        : info?.approval_status === 'rejected'
                          ? 'Rejected'
                          : info?.status}
                    </strong>
                  </div>
                </div>
              </div>

              {lines.length > 0 && (
                <div style={{ overflowX: 'auto', marginBottom: 18 }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr>
                        <th align="left">Description</th>
                        <th align="right">Qty</th>
                        <th align="right">Unit price</th>
                        <th align="right">Discount</th>
                        <th align="right">Tax</th>
                        <th align="right">Recoverable tax</th>
                        <th align="right">Total</th>
                      </tr>
                    </thead>

                    <tbody>
                      {lines.map((line) => (
                        <tr key={line.id}>
                          <td>{line.description}</td>
                          <td align="right">{line.quantity}</td>
                          <td align="right">{money(line.unit_price)}</td>
                          <td align="right">
                            {money(line.discount_amount)}
                          </td>
                          <td align="right">{money(line.tax_amount)}</td>
                          <td align="right">
                            {money(line.recoverable_tax_amount)}
                          </td>
                          <td align="right">
                            <strong>{money(line.total_amount)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <label className="field-label">
                Supplier email
                <input
                  type="email"
                  value={recipient}
                  onChange={(event) =>
                    setRecipient(event.target.value)
                  }
                  placeholder="supplier@example.com"
                />
              </label>

              <label className="field-label">
                Email message
                <textarea
                  rows={7}
                  maxLength={5000}
                  value={message}
                  onChange={(event) =>
                    setMessage(event.target.value)
                  }
                />
              </label>

              <p className="dialog-note">
                The email automatically includes the complete bill
                information and the financial summary:
                <strong> Total</strong>, <strong>Paid</strong>, and
                <strong> Remaining</strong>.
              </p>

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}

              {success && (
                <p className="dialog-note">
                  ✓ {success}
                </p>
              )}

              <div className="button-row">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={sending || !recipient.trim()}
                  onClick={() => void send()}
                >
                  {sending ? 'Sending…' : 'Send supplier bill'}
                </button>
              </div>

              {events.length > 0 && (
                <details style={{ marginTop: 18 }}>
                  <summary>
                    Email history ({events.length})
                  </summary>

                  <div style={{ marginTop: 10 }}>
                    {events.map((event) => (
                      <div
                        key={event.id}
                        className="transaction-row"
                      >
                        <span>
                          <strong>{event.recipient}</strong>
                          <small>
                            {new Date(
                              event.created_at,
                            ).toLocaleString('en-KE')}
                          </small>
                        </span>

                        <strong>
                          {event.status === 'accepted'
                            ? 'Accepted'
                            : 'Failed'}
                        </strong>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}