import { useEffect, useState, type FormEvent } from 'react'
import { languages, useTranslation, type LanguageCode } from './i18n'

type StoreProduct = { id: string; name: string; sku: string; price: number; inStock: boolean }
type StoreInfo = { slug: string; title: string; description: string; businessName: string }
type CartEntry = { product: StoreProduct; quantity: number }

function formatMoney(value: string | number) {
  return `KSh ${Number(value).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function LanguageControl() {
  const { language, setLanguage, t } = useTranslation()
  return <label className="language-picker"><span>{t('Language')}</span><select aria-label={t('Language')} value={language} onChange={(event) => setLanguage(event.target.value as LanguageCode)}>{languages.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
}

async function publicRequest<T>(apiBase: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

function Storefront({ apiBase, slug }: { apiBase: string; slug: string }) {
  const { t } = useTranslation()
  const [store, setStore] = useState<StoreInfo | null>(null)
  const [products, setProducts] = useState<StoreProduct[]>([])
  const [cart, setCart] = useState<Record<string, CartEntry>>({})
  const [contact, setContact] = useState({ customerName: '', customerEmail: '', customerPhone: '' })
  const [portalUrl, setPortalUrl] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const total = Object.values(cart).reduce((sum, row) => sum + row.product.price * row.quantity, 0)

  useEffect(() => {
    void publicRequest<{ store: StoreInfo; products: StoreProduct[] }>(apiBase, `/v1/public/stores/${encodeURIComponent(slug)}`)
      .then((result) => { setStore(result.store); setProducts(result.products) })
      .catch((reason: unknown) => setError(t(reason instanceof Error ? reason.message : 'Could not load this store.')))
  }, [apiBase, slug, t])

  function addProduct(product: StoreProduct) {
    setCart((current) => {
      const existing = current[product.id]?.quantity ?? 0
      if (!product.inStock || existing >= 100) return current
      return { ...current, [product.id]: { product, quantity: existing + 1 } }
    })
  }

  function changeCartQuantity(productId: string, change: number) {
    setCart((current) => {
      const entry = current[productId]
      if (!entry) return current
      const quantity = entry.quantity + change
      const next = { ...current }
      if (quantity <= 0) delete next[productId]
      else next[productId] = { ...entry, quantity: Math.min(100, quantity) }
      return next
    })
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const result = await publicRequest<{ order: { portalUrl: string }; message: string }>(apiBase, `/v1/public/stores/${encodeURIComponent(slug)}/orders`, {
        method: 'POST',
        body: JSON.stringify({ ...contact, lines: Object.values(cart).map(({ product, quantity }) => ({ itemId: product.id, quantity })) }),
      })
      setPortalUrl(result.order.portalUrl)
      setMessage(result.message)
      setCart({})
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not submit this order.') }
    finally { setBusy(false) }
  }

  if (!store && !error) return <main className="public-store-shell"><p role="status">{t('Loading store…')}</p></main>
  if (!store) return <main className="public-store-shell"><h1>{t('Store unavailable')}</h1><p className="form-error" role="alert">{error}</p></main>

  return <main className="public-store-shell">
    <header className="public-store-header"><div className="brand-row"><div className="brand-mark">K</div><div className="brand-name">Kash<span>Flow</span><small>{t('BUSINESS SUITE')}</small></div></div><p>{store.businessName}</p><LanguageControl /></header>
    <section className="public-store-intro"><div className="eyebrow">{t('ONLINE STORE')}</div><h1>{store.title}</h1><p>{store.description}</p></section>
    {message && <div className="module-card" role="status"><strong>{t('Order request received')}</strong><p>{message}</p>{portalUrl && <a className="button button-primary" href={portalUrl}>{t('Track your order')}</a>}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="public-store-layout">
      <section className="public-product-grid" aria-label={t('Products')}>
        {products.map((product) => <article className="module-card public-product-card" key={product.id}>
          <h2>{product.name}</h2>{product.sku && <small>SKU {product.sku}</small>}
          <strong>{formatMoney(product.price)}</strong>
          <span className={`status-pill ${product.inStock ? 'green' : 'amber'}`}>{product.inStock ? t('Available to request') : t('Currently unavailable')}</span>
          <button className="button button-secondary" disabled={!product.inStock || busy} onClick={() => addProduct(product)}>{t('Add to order')}</button>
        </article>)}
        {!products.length && <div className="empty-state">{t('There are no products currently listed for sale.')}</div>}
      </section>
      <aside className="module-card public-checkout">
        <h2>{t('Your order request')}</h2>
        {Object.values(cart).map(({ product, quantity }) => <div className="transaction-row" key={product.id}><span>{product.name} × {quantity}</span><strong>{formatMoney(product.price * quantity)}</strong><div className="button-row"><button type="button" className="button button-small" aria-label={`${t('Decrease quantity')} ${product.name}`} onClick={() => changeCartQuantity(product.id, -1)}>−</button><button type="button" className="button button-small" aria-label={`${t('Increase quantity')} ${product.name}`} disabled={quantity >= 100} onClick={() => changeCartQuantity(product.id, 1)}>+</button><button type="button" className="button button-small" onClick={() => changeCartQuantity(product.id, -quantity)} aria-label={`${t('Remove')} ${product.name}`}>{t('Remove')}</button></div></div>)}
        {!Object.keys(cart).length && <p>{t('Your order is empty.')}</p>}
        <div className="transaction-row"><strong>{t('Subtotal')}</strong><strong>{formatMoney(total)}</strong></div>
        <p className="dialog-note">{t('This submits an order request, not an online payment. The seller must confirm stock, delivery charges, any applicable tax, and payment arrangements. Listed prices exclude shipping and tax.')}</p>
        <form onSubmit={submitOrder}>
          <label className="field-label">{t('Your name')}<input required maxLength={160} autoComplete="name" value={contact.customerName} onChange={(event) => setContact({ ...contact, customerName: event.target.value })} /></label>
          <label className="field-label">{t('Email')}<input required type="email" maxLength={254} autoComplete="email" value={contact.customerEmail} onChange={(event) => setContact({ ...contact, customerEmail: event.target.value })} /></label>
          <label className="field-label">{t('Phone (optional)')}<input type="tel" maxLength={30} autoComplete="tel" value={contact.customerPhone} onChange={(event) => setContact({ ...contact, customerPhone: event.target.value })} /></label>
          <button className="button button-primary" disabled={busy || !Object.keys(cart).length}>{busy ? t('Submitting…') : t('Submit order request')}</button>
        </form>
      </aside>
    </div>
    <footer className="public-store-footer">{t('Order and tracking details are private to the customer holding the secure tracking link. KashFlow does not collect online payment or file tax invoices from this page.')}</footer>
  </main>
}

function CustomerOrderPortal({ apiBase, token }: { apiBase: string; token: string }) {
  const { t } = useTranslation()
  const [order, setOrder] = useState<{ id: string; status: string; total: string; created_at: string } | null>(null)
  const [lines, setLines] = useState<Array<{ product_name: string; sku: string; quantity: string; unit_price: string; total: string }>>([])
  const [error, setError] = useState('')

  useEffect(() => {
    void publicRequest<{ order: typeof order; lines: typeof lines }>(apiBase, `/v1/public/orders/${encodeURIComponent(token)}`)
      .then((result) => { setOrder(result.order); setLines(result.lines) })
      .catch((reason: unknown) => setError(t(reason instanceof Error ? reason.message : 'Could not load order status.')))
  }, [apiBase, token, t])

  return <main className="public-store-shell public-portal">
    <header className="public-store-header"><div className="brand-row"><div className="brand-mark">K</div><div className="brand-name">Kash<span>Flow</span><small>{t('BUSINESS SUITE')}</small></div></div><LanguageControl /></header>
    <section className="module-card">
      <div className="eyebrow">{t('CUSTOMER ORDER TRACKING')}</div><h1>{t('Your order')}</h1>
      {error ? <p className="form-error" role="alert">{error}</p> : !order ? <p role="status">{t('Loading order…')}</p> : <>
        <p>{t('Order')} {order.id.slice(0, 8).toUpperCase()} · {t('placed')} {new Date(order.created_at).toLocaleDateString()}</p>
        <p className="status-pill amber">{t(order.status)}</p>
        {lines.map((line, index) => <div className="transaction-row" key={`${line.sku}-${index}`}><span>{line.product_name} × {line.quantity}</span><strong>{formatMoney(line.total)}</strong></div>)}
        <div className="transaction-row"><strong>{t('Order subtotal')}</strong><strong>{formatMoney(order.total)}</strong></div>
        <p className="dialog-note">{t('This page reports the seller’s current order status. It does not confirm payment, delivery, or a tax invoice.')}</p>
      </>}
    </section>
  </main>
}

function CustomerInvoicePortal({ apiBase, token }: { apiBase: string; token: string }) {
  const { t } = useTranslation()
  const [invoice, setInvoice] = useState<{
    id: string; customer: string; description: string; amount: string; amountPaid: string; amountDue: string;
    dueDate: string; status: string; businessName: string; expiresAt: string
  } | null>(null)
  const [lines, setLines] = useState<Array<{ description: string; quantity: string; unit_price: string; total_amount: string }>>([])
  const [error, setError] = useState('')

  useEffect(() => {
    void publicRequest<{ invoice: NonNullable<typeof invoice>; lines: typeof lines }>(apiBase, `/v1/public/invoices/${encodeURIComponent(token)}`)
      .then((result) => { setInvoice(result.invoice); setLines(result.lines) })
      .catch((reason: unknown) => setError(reason instanceof Error ? t(reason.message) : t('Invoice link is invalid or has expired.')))
  }, [apiBase, token, t])

  if (!invoice && !error) return <main className="public-store-shell"><p role="status">{t('Loading invoice…')}</p></main>
  if (!invoice) return <main className="public-store-shell"><h1>{t('Invoice unavailable')}</h1><p className="form-error" role="alert">{error}</p></main>

  return <main className="public-store-shell">
    <header className="public-store-header"><div className="brand-row"><div className="brand-mark">K</div><div className="brand-name">Kash<span>Flow</span><small>{t('BUSINESS SUITE')}</small></div></div><p>{invoice.businessName}</p><LanguageControl /></header>
    <section className="public-store-intro"><div className="eyebrow">{t('CUSTOMER INVOICE')}</div><h1>{t('Invoice')} {invoice.id.slice(0, 8).toUpperCase()}</h1><p>{t('For')} {invoice.customer} · {t('Due')} {invoice.dueDate}</p></section>
    <section className="module-card public-checkout">
      <span className={`status-pill ${invoice.status === 'paid' ? 'green' : 'amber'}`}>{t(invoice.status)}</span>
      <h2>{invoice.description}</h2>
      {lines.map((line, index) => <div className="transaction-row" key={`${line.description}-${index}`}><span>{line.description} × {line.quantity}</span><strong>{formatMoney(line.total_amount)}</strong></div>)}
      <div className="transaction-row"><strong>{t('Invoice total')}</strong><strong>{formatMoney(invoice.amount)}</strong></div>
      <div className="transaction-row"><span>{t('Recorded payments')}</span><strong>{formatMoney(invoice.amountPaid)}</strong></div>
      <div className="transaction-row"><strong>{t('Balance due')}</strong><strong>{formatMoney(invoice.amountDue)}</strong></div>
      <p className="dialog-note">{t('This is an internal invoice view, not a KRA/eTIMS tax invoice. It does not accept or confirm payments. Contact the seller to arrange payment and confirm the status.')}</p>
    </section>
  </main>
}

export function OnlineStoreApp({ apiBase, pathname }: { apiBase: string; pathname: string }) {
  const { t } = useTranslation()
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'store' && parts[1]) return <Storefront apiBase={apiBase} slug={parts[1]} />
  if (parts[0] === 'portal' && parts[1]) return <CustomerOrderPortal apiBase={apiBase} token={parts[1]} />
  if (parts[0] === 'invoice' && parts[1]) return <CustomerInvoicePortal apiBase={apiBase} token={parts[1]} />
  return <main className="public-store-shell"><h1>{t('Page not found')}</h1><a href="/">{t('Return to KashFlow')}</a></main>
}
