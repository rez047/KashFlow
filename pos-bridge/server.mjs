import { connect } from 'node:net'
import { createServer as createHttpServer } from 'node:http'

const printerHost = process.env.POS_PRINTER_HOST?.trim()
const printerPort = Number(process.env.POS_PRINTER_PORT || 9100)
const listenPort = Number(process.env.POS_BRIDGE_PORT || 17371)
const allowedOrigin = process.env.POS_ALLOWED_ORIGIN?.trim()
const businessName = process.env.POS_BUSINESS_NAME?.trim() || 'KashFlow business'

if (!printerHost || !allowedOrigin || !Number.isInteger(printerPort) || printerPort < 1 || printerPort > 65_535 || !Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65_535) {
  console.error('Configure POS_PRINTER_HOST, POS_ALLOWED_ORIGIN, and valid optional POS_PRINTER_PORT/POS_BRIDGE_PORT values.')
  process.exit(1)
}

const esc = (...bytes) => Buffer.from(bytes)
// eslint-disable-next-line no-control-regex
const clean = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[^\x20-\x7e]/g, '?').trim().slice(0, limit)

function wrap(text, width = 32) {
  const words = text.split(/\s+/)
  const rows = []
  let row = ''
  for (const word of words) {
    if (row && `${row} ${word}`.length > width) { rows.push(row); row = word }
    else row = row ? `${row} ${word}` : word
  }
  if (row) rows.push(row)
  return rows
}

function buildReceipt(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.lines) || input.lines.length > 100) throw new Error('Receipt must contain up to 100 sale lines.')
  const invoiceId = clean(input.invoiceId, 80)
  const customer = clean(input.customer || 'Walk-in customer', 80)
  const receiptBusinessName = clean(input.businessName || businessName, 80)
  const lines = input.lines.map((line) => {
    const description = clean(line.description, 100)
    const quantity = Number(line.quantity)
    const unitPrice = Number(line.unitPrice)
    if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Receipt line data is invalid.')
    return { description, quantity, unitPrice }
  })
  const expected = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount < 0 || Math.abs(expected - amount) > 0.02) throw new Error('Receipt total does not match its lines.')
  const amountPaid = Number(input.amountPaid ?? 0)
  const balanceDue = Number(input.balanceDue ?? Math.max(0, amount - amountPaid))
  if (!Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > amount + 0.02 || !Number.isFinite(balanceDue) || balanceDue < 0 || Math.abs(amountPaid + balanceDue - amount) > 0.02) throw new Error('Receipt payment totals are invalid.')
  const paymentMethod = clean(input.paymentMethod || 'unrecorded', 40)
  const paymentStatus = clean(input.status || 'Payment not recorded', 120)
  const date = clean(input.createdAt ? new Date(input.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }) : new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }), 60)
  const email = clean(input.customerEmail, 100)
  const phone = clean(input.customerPhone, 40)

  const chunks = [esc(0x1b, 0x40), esc(0x1b, 0x61, 1)]
  chunks.push(Buffer.from(`${receiptBusinessName}\n`, 'ascii'))
  chunks.push(Buffer.from('INTERNAL SALES RECEIPT\n', 'ascii'))
  chunks.push(esc(0x1b, 0x61, 0))
  chunks.push(Buffer.from(`Receipt date: ${date}\nInvoice: ${invoiceId}\nCustomer: ${customer}\n`, 'ascii'))
  if (email) chunks.push(Buffer.from(`Email: ${email}\n`, 'ascii'))
  if (phone) chunks.push(Buffer.from(`Phone: ${phone}\n`, 'ascii'))
  chunks.push(Buffer.from('--------------------------------\n', 'ascii'))
  for (const line of lines) {
    const total = (line.quantity * line.unitPrice).toFixed(2)
    for (const row of wrap(line.description)) chunks.push(Buffer.from(`${row}\n`, 'ascii'))
    chunks.push(Buffer.from(`  ${line.quantity} x KSh ${line.unitPrice.toFixed(2)}  KSh ${total}\n`, 'ascii'))
  }
  chunks.push(Buffer.from('--------------------------------\n', 'ascii'))
  chunks.push(esc(0x1b, 0x61, 2))
  chunks.push(Buffer.from(`TOTAL  KSh ${amount.toFixed(2)}\n`, 'ascii'))
  chunks.push(esc(0x1b, 0x61, 0))
  chunks.push(Buffer.from(`Payment: ${paymentMethod}\nPaid: KSh ${amountPaid.toFixed(2)}\nBalance due: KSh ${balanceDue.toFixed(2)}\nStatus: ${paymentStatus}\n`, 'ascii'))
  chunks.push(Buffer.from('\nCustomer receipt. Internal record only; not an eTIMS tax invoice.\n\n\n', 'ascii'))
  chunks.push(esc(0x1d, 0x56, 0))
  return Buffer.concat(chunks)
}

function sendToPrinter(bytes) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: printerHost, port: printerPort })
    const timer = setTimeout(() => socket.destroy(new Error('Printer connection timed out.')), 5000)
    socket.once('connect', () => socket.end(bytes))
    socket.once('error', reject)
    socket.once('close', (hadError) => {
      clearTimeout(timer)
      if (!hadError) resolve()
    })
  })
}

const server = createHttpServer(async (request, response) => {
  const origin = request.headers.origin
  const host = request.headers.host ?? ''
  if (host !== `127.0.0.1:${listenPort}` && host !== `localhost:${listenPort}`) {
    response.writeHead(403).end('Local bridge host not allowed.')
    return
  }
  if (origin && origin !== allowedOrigin) {
    response.writeHead(403).end('Browser origin not allowed.')
    return
  }
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (request.headers['access-control-request-private-network'] === 'true') {
      response.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
  }
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'ok', printerConfigured: true }))
    return
  }
  if (request.method !== 'POST' || !['/receipt', '/cash-drawer'].includes(request.url ?? '')) {
    response.writeHead(404).end('Not found.')
    return
  }

  try {
    let body = ''
    for await (const chunk of request) {
      body += chunk
      if (body.length > 65_536) throw new Error('Request body is too large.')
    }
    const input = body ? JSON.parse(body) : {}
    const bytes = request.url === '/cash-drawer'
      ? esc(0x1b, 0x70, 0, 60, 120)
      : buildReceipt(input)
    await sendToPrinter(bytes)
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'sent_to_printer' }))
  } catch (error) {
    const message = error instanceof SyntaxError ? 'Request body must be valid JSON.' : error instanceof Error ? error.message : 'Printer operation failed.'
    response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message }))
  }
})

server.listen(listenPort, '127.0.0.1', () => {
  console.info(`KashFlow local POS bridge listening on 127.0.0.1:${listenPort}; printer target ${printerHost}:${printerPort}`)
})
