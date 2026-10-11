const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kashflowWorkspace', {
  getToken: () => ipcRenderer.invoke('kashflow:workspace-token'),
  setToken: (token) => ipcRenderer.invoke('kashflow:workspace-token-update', token),
})
