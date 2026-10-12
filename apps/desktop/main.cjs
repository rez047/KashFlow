const { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } = require('electron')
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
let fullWorkspaceWindow = null
let fieldWindow = null

function configuredWorkspaceUrl() {
  const target = new URL(process.env.KASHFLOW_WORKSPACE_URL || 'https://kashflow-frontend.onrender.com')
  if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) {
    throw new Error('The full workspace address must use HTTPS.')
  }
  return target
}

function isFullWorkspaceRequest(event) {
  if (!fullWorkspaceWindow || fullWorkspaceWindow.isDestroyed() || event.sender !== fullWorkspaceWindow.webContents || event.senderFrame !== event.sender.mainFrame) return false
  try { return new URL(event.senderFrame.url).origin === configuredWorkspaceUrl().origin } catch { return false }
}

ipcMain.handle('kashflow:workspace-token', (event) => {
  if (!isFullWorkspaceRequest(event)) throw new Error('This desktop session cannot be read from this page.')
  return loadVault().token || ''
})
ipcMain.handle('kashflow:workspace-token-update', (event, token) => {
  if (!isFullWorkspaceRequest(event)) throw new Error('This desktop session cannot be updated from this page.')
  if (typeof token !== 'string' || token.length > 1000) throw new Error('The workspace session response is invalid.')
  saveVault({ ...loadVault(), token })
  for (const window of BrowserWindow.getAllWindows()) {
    if (window !== fullWorkspaceWindow && !window.isDestroyed()) window.webContents.send('kashflow:workspace-token-changed', token)
  }
})

async function openWorkspaceWindow() {
  const workspaceUrl = configuredWorkspaceUrl()
  if (fullWorkspaceWindow && !fullWorkspaceWindow.isDestroyed()) {
    fullWorkspaceWindow.focus()
    return
  }

  fullWorkspaceWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#f5f5f1',
    title: 'KashFlow · Business Suite',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'workspace-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const workspaceSession = fullWorkspaceWindow.webContents.session
  workspaceSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    contents === fullWorkspaceWindow?.webContents &&
    permission === 'media' &&
    origin === workspaceUrl.origin &&
    details.mediaType === 'video'
  )
  workspaceSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    let requesterOrigin = ''
    try { requesterOrigin = new URL(details.requestingUrl).origin } catch { /* Reject malformed origins. */ }
    const videoOnly = permission === 'media' && 'mediaTypes' in details && details.mediaTypes?.includes('video') && !details.mediaTypes.includes('audio')
    callback(contents === fullWorkspaceWindow?.webContents && details.isMainFrame && requesterOrigin === workspaceUrl.origin && videoOnly)
  })
  fullWorkspaceWindow.once('ready-to-show', () => fullWorkspaceWindow?.show())
  fullWorkspaceWindow.on('closed', () => { fullWorkspaceWindow = null })
  fullWorkspaceWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:' || target.protocol === 'mailto:') void shell.openExternal(url).catch(() => undefined)
    } catch { /* Ignore malformed external links. */ }
    return { action: 'deny' }
  })
  fullWorkspaceWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url)
      if (target.origin !== workspaceUrl.origin) {
        event.preventDefault()
        if (target.protocol === 'https:' || target.protocol === 'mailto:') void shell.openExternal(url).catch(() => undefined)
      }
    } catch { event.preventDefault() }
  })
  try {
    await fullWorkspaceWindow.loadURL(workspaceUrl.href)
  } catch (error) {
    if (fullWorkspaceWindow && !fullWorkspaceWindow.isDestroyed()) fullWorkspaceWindow.destroy()
    fullWorkspaceWindow = null
    throw error
  }
}

ipcMain.handle('kashflow:open-workspace', () => openWorkspaceWindow())

function createFieldWindow() {
  if (fieldWindow && !fieldWindow.isDestroyed()) {
    fieldWindow.focus()
    return fieldWindow
  }
  fieldWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 690,
    backgroundColor: '#f5f5f1',
    title: 'KashFlow · Offline Field Tools',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  fieldWindow.once('ready-to-show', () => fieldWindow?.show())
  fieldWindow.on('closed', () => { fieldWindow = null })
  fieldWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  fieldWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) event.preventDefault()
  })
  if (!app.isPackaged) void fieldWindow.loadURL(devServer)
  else void fieldWindow.loadFile(path.join(__dirname, 'dist', 'index.html'))
  return fieldWindow
}

function installWorkspaceMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    {
      label: 'Workspace',
      submenu: [
        { label: 'Full business suite', accelerator: 'CmdOrCtrl+1', click: () => { void openWorkspaceWindow().catch(() => createFieldWindow()) } },
        { label: 'Offline field tools', accelerator: 'CmdOrCtrl+2', click: () => createFieldWindow() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  app.setAppUserModelId('ke.kashflow.desktop')
  installWorkspaceMenu()
  void openWorkspaceWindow().catch(() => createFieldWindow())
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void openWorkspaceWindow().catch(() => createFieldWindow()) })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
