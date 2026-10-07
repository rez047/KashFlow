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

  const statusLabel =
    info?.approval_status === 'pending'
      ? 'Awaiting approval'
      : info?.approval_status === 'rejected'
        ? 'Rejected'
        : info?.status

  return (
    <>
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
          onClick={() => setOpen(true)}
        >
          Send bill to supplier
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`supplier-bill-email-title-${bill.id}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false)
            }
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'rgba(15, 23, 42, 0.58)',
            backdropFilter: 'blur(3px)',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              width: 'min(920px, 100%)',
              maxHeight: 'calc(100vh - 48px)',
              overflowY: 'auto',
              background: 'var(--surface, #ffffff)',
              color: 'var(--text, inherit)',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 18,
              boxShadow:
                '0 24px 70px rgba(15, 23, 42, 0.22)',
            }}
          >
            {/* Header */}
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '18px 22px',
                background: 'var(--surface, #ffffff)',
                borderBottom:
                  '1px solid var(--border, #e5e7eb)',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: '-0.01em',
                  }}
                  id={`supplier-bill-email-title-${bill.id}`}
                >
                  Send Bill to Supplier
                </div>

                <div
                  style={{
                    marginTop: 4,
                    fontSize: 13,
                    opacity: 0.65,
                  }}
                >
                  Send the recorded bill and payment summary directly
                  to the supplier.
                </div>
              </div>

              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  border:
                    '1px solid var(--border, #e5e7eb)',
                  background:
                    'var(--surface-muted, #f8fafc)',
                  cursor: 'pointer',
                  fontSize: 20,
                  lineHeight: 1,
                  opacity: 0.75,
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: 22 }}>
              {loading && (
                <div
                  style={{
                    padding: '50px 20px',
                    textAlign: 'center',
                    opacity: 0.7,
                  }}
                >
                  Loading the complete supplier bill...
                </div>
              )}

              {!loading && (
                <>
                  {/* Financial summary */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(3, minmax(0, 1fr))',
                      gap: 12,
                      marginBottom: 20,
                    }}
                  >
                    <div
                      style={{
                        padding: '16px 18px',
                        borderRadius: 12,
                        background:
                          'var(--surface-muted, #f8fafc)',
                        border:
                          '1px solid var(--border, #e5e7eb)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          opacity: 0.62,
                          marginBottom: 7,
                        }}
                      >
                        Total amount
                      </div>

                      <div
                        style={{
                          fontSize: 19,
                          fontWeight: 700,
                        }}
                      >
                        {money(total)}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '16px 18px',
                        borderRadius: 12,
                        background:
                          'var(--surface-muted, #f8fafc)',
                        border:
                          '1px solid var(--border, #e5e7eb)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          opacity: 0.62,
                          marginBottom: 7,
                        }}
                      >
                        Paid
                      </div>

                      <div
                        style={{
                          fontSize: 19,
                          fontWeight: 700,
                        }}
                      >
                        {money(paid)}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '16px 18px',
                        borderRadius: 12,
                        background:
                          'var(--surface-muted, #f8fafc)',
                        border:
                          '1px solid var(--border, #e5e7eb)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          opacity: 0.62,
                          marginBottom: 7,
                        }}
                      >
                        Remaining
                      </div>

                      <div
                        style={{
                          fontSize: 19,
                          fontWeight: 700,
                        }}
                      >
                        {money(remaining)}
                      </div>
                    </div>
                  </div>

                  {/* Bill information */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(4, minmax(0, 1fr))',
                      gap: 16,
                      padding: '16px 18px',
                      marginBottom: 20,
                      border:
                        '1px solid var(--border, #e5e7eb)',
                      borderRadius: 12,
                    }}
                  >
                    <div>
                      <small style={{ opacity: 0.6 }}>
                        Supplier
                      </small>
                      <div
                        style={{
                          marginTop: 4,
                          fontWeight: 600,
                        }}
                      >
                        {info?.supplier || '—'}
                      </div>
                    </div>

                    <div>
                      <small style={{ opacity: 0.6 }}>
                        Bill date
                      </small>
                      <div
                        style={{
                          marginTop: 4,
                          fontWeight: 600,
                        }}
                      >
                        {info?.bill_date || '—'}
                      </div>
                    </div>

                    <div>
                      <small style={{ opacity: 0.6 }}>
                        Due date
                      </small>
                      <div
                        style={{
                          marginTop: 4,
                          fontWeight: 600,
                        }}
                      >
                        {info?.due_date || '—'}
                      </div>
                    </div>

                    <div>
                      <small style={{ opacity: 0.6 }}>
                        Status
                      </small>
                      <div
                        style={{
                          marginTop: 4,
                          fontWeight: 600,
                        }}
                      >
                        {statusLabel || '—'}
                      </div>
                    </div>
                  </div>

                  {/* Bill lines */}
                  {lines.length > 0 && (
                    <div style={{ marginBottom: 22 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          marginBottom: 9,
                        }}
                      >
                        Bill details
                      </div>

                      <div
                        style={{
                          overflowX: 'auto',
                          border:
                            '1px solid var(--border, #e5e7eb)',
                          borderRadius: 12,
                        }}
                      >
                        <table
                          style={{
                            width: '100%',
                            minWidth: 720,
                            borderCollapse: 'collapse',
                            fontSize: 12.5,
                          }}
                        >
                          <thead>
                            <tr>
                              <th
                                align="left"
                                style={{
                                  padding: '11px 12px',
                                  borderBottom:
                                    '1px solid var(--border, #e5e7eb)',
                                  background:
                                    'var(--surface-muted, #f8fafc)',
                                }}
                              >
                                Description
                              </th>

                              <th
                                align="right"
                                style={{
                                  padding: '11px 10px',
                                  borderBottom:
                                    '1px solid var(--border, #e5e7eb)',
                                  background:
                                    'var(--surface-muted, #f8fafc)',
                                }}
                              >
                                Qty
                              </th>

                              <th
                                align="right"
                                style={{
                                  padding: '11px 10px',
                                  borderBottom:
                                    '1px solid var(--border, #e5e7eb)',
                                  background:
                                    'var(--surface-muted, #f8fafc)',
                                }}
                              >
                                Unit price
                              </th>

                              <th
                                align="right"
                                style={{
                                  padding: '11px 10px',
                                  borderBottom:
                                    '1px solid var(--border, #e5e7eb)',
                                  background:
                                    'var(--surface-muted, #f8fafc)',
                                }}
                              >
                                Discount
                              </th>

                              <th
                                align="right"
                                style={{
                                  padding: '11px 10px',
                                  borderBottom:
                                    '1px solid var(--border, #e5e7eb)',
                                  background:
                                    'var(--surface-muted, #f8fafc)',
                                }}
                              >
                                Tax
                              </th>

                              <th
                                align="right"
                                style={{
                                  padding: '11px 10px',
                                  borderBottom:
                                    '1px solid var(--border, #e5e7eb)',
                                  background:
                                    'var(--surface-muted, #f8fafc)',
                                }}
                              >
                                Recoverable tax
                              </th>

                              <th
                                align="right"
                                style={{
                                  padding: '11px 12px',
                                  borderBottom:
                                    '1px solid var(--border, #e5e7eb)',
                                  background:
                                    'var(--surface-muted, #f8fafc)',
                                }}
                              >
                                Total
                              </th>
                            </tr>
                          </thead>

                          <tbody>
                            {lines.map((line) => (
                              <tr key={line.id}>
                                <td
                                  style={{
                                    padding: '11px 12px',
                                    borderBottom:
                                      '1px solid var(--border, #e5e7eb)',
                                  }}
                                >
                                  {line.description}
                                </td>

                                <td
                                  align="right"
                                  style={{
                                    padding: '11px 10px',
                                    borderBottom:
                                      '1px solid var(--border, #e5e7eb)',
                                  }}
                                >
                                  {line.quantity}
                                </td>

                                <td
                                  align="right"
                                  style={{
                                    padding: '11px 10px',
                                    borderBottom:
                                      '1px solid var(--border, #e5e7eb)',
                                  }}
                                >
                                  {money(line.unit_price)}
                                </td>

                                <td
                                  align="right"
                                  style={{
                                    padding: '11px 10px',
                                    borderBottom:
                                      '1px solid var(--border, #e5e7eb)',
                                  }}
                                >
                                  {money(line.discount_amount)}
                                </td>

                                <td
                                  align="right"
                                  style={{
                                    padding: '11px 10px',
                                    borderBottom:
                                      '1px solid var(--border, #e5e7eb)',
                                  }}
                                >
                                  {money(line.tax_amount)}
                                </td>

                                <td
                                  align="right"
                                  style={{
                                    padding: '11px 10px',
                                    borderBottom:
                                      '1px solid var(--border, #e5e7eb)',
                                  }}
                                >
                                  {money(
                                    line.recoverable_tax_amount,
                                  )}
                                </td>

                                <td
                                  align="right"
                                  style={{
                                    padding: '11px 12px',
                                    borderBottom:
                                      '1px solid var(--border, #e5e7eb)',
                                    fontWeight: 700,
                                  }}
                                >
                                  {money(line.total_amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Email section */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'minmax(0, 1fr) minmax(0, 1.6fr)',
                      gap: 16,
                      marginBottom: 14,
                    }}
                  >
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
                        rows={5}
                        maxLength={5000}
                        value={message}
                        onChange={(event) =>
                          setMessage(event.target.value)
                        }
                      />
                    </label>
                  </div>

                  <div
                    style={{
                      padding: '11px 13px',
                      marginBottom: 14,
                      borderRadius: 9,
                      background:
                        'var(--surface-muted, #f8fafc)',
                      border:
                        '1px solid var(--border, #e5e7eb)',
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      opacity: 0.78,
                    }}
                  >
                    The email automatically includes the complete bill
                    information and the financial summary:
                    <strong> Total</strong>, <strong>Paid</strong>,
                    and <strong> Remaining</strong>.
                  </div>

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

                  {/* Footer */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      paddingTop: 6,
                    }}
                  >
                    <button
                      type="button"
                      className="button"
                      onClick={() => setOpen(false)}
                      disabled={sending}
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      className="button button-primary"
                      disabled={
                        sending || !recipient.trim()
                      }
                      onClick={() => void send()}
                    >
                      {sending
                        ? 'Sending…'
                        : 'Send supplier bill'}
                    </button>
                  </div>

                  {/* Email history */}
                  {events.length > 0 && (
                    <details
                      style={{
                        marginTop: 20,
                        paddingTop: 14,
                        borderTop:
                          '1px solid var(--border, #e5e7eb)',
                      }}
                    >
                      <summary
                        style={{
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: 13,
                        }}
                      >
                        Email history ({events.length})
                      </summary>

                      <div style={{ marginTop: 10 }}>
                        {events.map((event) => (
                          <div
                            key={event.id}
                            className="transaction-row"
                          >
                            <span>
                              <strong>
                                {event.recipient}
                              </strong>

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
          </div>
        </div>
      )}
    </>
  )
}