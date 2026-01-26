import { contextBridge } from 'electron/renderer'

contextBridge.exposeInMainWorld('electron', {
  env: process.env,
})
