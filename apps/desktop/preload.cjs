const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kashflowDesktop', {
  loadVault: () => ipcRenderer.invoke('kashflow:load-vault'),
  saveVault: (value) => ipcRenderer.invoke('kashflow:save-vault', value),
  request: (path, token, options) => ipcRenderer.invoke('kashflow:request', { path, token, options }),
  ping: () => ipcRenderer.invoke('kashflow:ping'),
  version: () => ipcRenderer.invoke('kashflow:version'),
  openWorkspace: () => ipcRenderer.invoke('kashflow:open-workspace'),
  setWorkspaceView: (visible, bounds) => ipcRenderer.invoke('kashflow:set-workspace-view', { visible, bounds }),
  onWorkspaceNavigation: (callback) => {
    const listener = (_event, destination) => callback(destination)
    ipcRenderer.on('kashflow:workspace-navigation', listener)
    return () => ipcRenderer.removeListener('kashflow:workspace-navigation', listener)
  },
  onWorkspaceLoadError: (callback) => {
    const listener = (_event, message) => callback(message)
    ipcRenderer.on('kashflow:workspace-load-error', listener)
    return () => ipcRenderer.removeListener('kashflow:workspace-load-error', listener)
  },
  onWorkspaceTokenChanged: (callback) => {
    const listener = (_event, token) => callback(token)
    ipcRenderer.on('kashflow:workspace-token-changed', listener)
    return () => ipcRenderer.removeListener('kashflow:workspace-token-changed', listener)
  },
})
