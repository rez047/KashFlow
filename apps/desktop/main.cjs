const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const apiBase = (process.env.KASHFLOW_API_BASE_URL || 'https://kashflow-api.onrender.com').replace(/\/$/, '')
const devServer = process.env.KASHFLOW_DESKTOP_DEV_SERVER || 'http://127.0.0.1:5173'
const vaultFile = () => path.join(app.getPath('userData'), 'inventory.vault')
const secureStorageReady = () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')

function loadVault() {
  const file = vaultFile()
  if (!fs.existsSync(file)) return {}
  if (!secureStorageReady()) throw new Error('OS-backed encryption is not available on this computer. KashFlow did not open the saved business vault.')
  const encoded = fs.readFileSync(file)
  const content = safeStorage.decryptString(encoded)
  return JSON.parse(content)
}

function saveVault(value) {
  if (!secureStorageReady()) throw new Error('OS-backed encryption is not available on this computer. Your changes were not saved.')
  const file = vaultFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 })
  fs.renameSync(temporary, file)
}

ipcMain.handle('kashflow:load-vault', () => loadVault())
ipcMain.handle('kashflow:save-vault', (_event, value) => {
  if (!value || typeof value !== 'object' || typeof value.token !== 'string' || !Array.isArray(value.counts)) throw new Error('The local vault data is invalid and was not saved.')
  saveVault(value)
})
ipcMain.handle('kashflow:request', async (_event, input) => {
  if (!input || typeof input.path !== 'string' || !input.path.startsWith('/v1/')) throw new Error('Only KashFlow API requests are allowed from this app.')
  const method = input.options?.method || 'GET'
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('This API method is not available in the desktop app.')
  const response = await fetch(`${apiBase}${input.path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Kashflow-Client': 'native', ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}) },
    ...(input.options?.body === undefined ? {} : { body: JSON.stringify(input.options.body) }),
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 204) return { ok: response.ok, status: response.status, data: {} }
  const data = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, data }
})
ipcMain.handle('kashflow:ping', async () => {
  try {
    const response = await fetch(`${apiBase}/v1/auth/status`, { signal: AbortSignal.timeout(5000) })
    return response.ok
  } catch { return false }
})
ipcMain.handle('kashflow:version', () => app.getVersion())

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 690,
    backgroundColor: '#f5f5f1',
    title: 'KashFlow Field',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) event.preventDefault()
  })
  if (!app.isPackaged) void window.loadURL(devServer)
  else void window.loadFile(path.join(__dirname, 'dist', 'index.html'))
}

app.whenReady().then(() => {
  app.setAppUserModelId('ke.kashflow.desktop')
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
