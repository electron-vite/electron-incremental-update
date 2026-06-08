import { app, BrowserWindow, ipcMain } from 'electron'

import { startupWithUpdater } from '../dist/index.mjs'
import {
  beautifyDevTools,
  getAppVersion,
  getEntryVersion,
  getPathFromAppNameAsar,
  getPathFromPreload,
  loadPage,
  requireNative,
} from '../dist/utils.mjs'

let mainWindow: BrowserWindow | undefined

export default startupWithUpdater(async (updater) => {
  const sendUpdateState = (state: Record<string, unknown>): void => {
    console.log('Update state:', state)
    mainWindow?.webContents.send('update:state', state)
  }

  const sendReadyState = (): void => {
    sendUpdateState({
      appVersion: getAppVersion(),
      enabled: !!updater.provider,
      entryVersion: getEntryVersion(),
      status: updater.provider ? 'ready' : 'disabled',
    })
  }

  console.table({
    [`${app.name}.asar path:`]: getPathFromAppNameAsar(),
    'app version:': getAppVersion(),
    'entry (installer) version:': getEntryVersion(),
    'electron version:': process.versions.electron,
  })

  updater.on('update-available', ({ appVersion, entryVersion, version }) => {
    sendUpdateState({
      appVersion,
      entryVersion,
      status: 'available',
      version,
    })
  })
  updater.on('download-progress', (info) => {
    sendUpdateState({ progress: info, status: 'downloading' })
  })
  updater.on('update-downloaded', () => {
    sendUpdateState({ status: 'downloaded' })
  })
  updater.on('update-not-available', (code, message, info) => {
    sendUpdateState({
      appVersion: info?.appVersion ?? getAppVersion(),
      code,
      entryVersion: info?.entryVersion ?? getEntryVersion(),
      message,
      status: 'not-available',
      version: info?.version,
    })
  })
  updater.on('error', (error) => {
    sendUpdateState({ error: error.message, status: 'error' })
  })

  ipcMain.handle('update:check', async () => {
    sendUpdateState({ status: 'checking' })
    return await updater.checkForUpdates()
  })
  ipcMain.handle('update:download', async () => {
    sendUpdateState({ status: 'downloading' })
    return await updater.downloadUpdate()
  })
  ipcMain.handle('update:restart', () => {
    updater.quitAndInstall()
  })

  await app
    .whenReady()
    .then(() => import('./utils'))
    .then((util) => console.log(util.data))
    .then(() => requireNative('native'))
    .then(() => {
      console.log('This is a secret string')
      mainWindow = new BrowserWindow({
        title: 'Main window1',
        webPreferences: { preload: getPathFromPreload('preload.js') },
      })
      loadPage(mainWindow)
      beautifyDevTools(mainWindow, {
        mono: 'Maple Mono NF CN, Maple Mono',
        sans: 'Mapple, -apple-system',
      })
      mainWindow.webContents.on('did-finish-load', sendReadyState)
      mainWindow.webContents.openDevTools()
    })

  if (updater.provider) {
    sendUpdateState({ status: 'checking' })
    await updater.checkForUpdates()
  }

  app.on('window-all-closed', app.quit)
})
