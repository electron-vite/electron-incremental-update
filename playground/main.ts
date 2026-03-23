import { app, BrowserWindow } from 'electron'

import { startupWithUpdater } from '../dist/index.cjs'
import {
  beautifyDevTools,
  getAppVersion,
  getEntryVersion,
  getPathFromAppNameAsar,
  getPathFromPreload,
  loadPage,
  requireNative,
} from '../dist/utils.cjs'

export default startupWithUpdater(() => {
  console.table({
    [`${app.name}.asar path:`]: getPathFromAppNameAsar(),
    'app version:': getAppVersion(),
    'entry (installer) version:': getEntryVersion(),
    'electron version:': process.versions.electron,
  })
  app
    .whenReady()
    .then(() => import('./utils'))
    .then((util) => console.log(util.data))
    .then(() => requireNative('native'))
    .then(() => {
      console.log('This is a secret string')
      const win = new BrowserWindow({
        title: 'Main window1',
        webPreferences: { preload: getPathFromPreload('preload.js') },
      })
      loadPage(win)
      beautifyDevTools(win, { mono: 'Maple Mono NF CN, Maple Mono', sans: 'Mapple, -apple-system' })
    })
})
