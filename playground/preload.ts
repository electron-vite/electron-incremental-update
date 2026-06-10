import { contextBridge, ipcRenderer } from 'electron/renderer'

contextBridge.exposeInMainWorld('electron', {
  env: process.env.NODE_ENV,
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    restart: () => ipcRenderer.invoke('update:restart'),
    onState: (callback: (state: unknown) => void) => {
      const listener = (_: Electron.IpcRendererEvent, state: unknown) => callback(state)
      ipcRenderer.on('update:state', listener)
      return () => ipcRenderer.off('update:state', listener)
    },
  },
})
