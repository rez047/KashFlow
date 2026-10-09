const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kashflowDesktop', {
  loadVault: () => ipcRenderer.invoke('kashflow:load-vault'),
  saveVault: (value) => ipcRenderer.invoke('kashflow:save-vault', value),
  request: (path, token, options) => ipcRenderer.invoke('kashflow:request', { path, token, options }),
  ping: () => ipcRenderer.invoke('kashflow:ping'),
  version: () => ipcRenderer.invoke('kashflow:version'),
})
