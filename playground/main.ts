import { app, BrowserWindow } from 'electron'

import { startupWithUpdater } from '../src/entry'
import {
  getAppVersion,
  getEntryVersion,
  getPathFromAppNameAsar,
  getPathFromPreload,
  loadPage,
  requireNative,
} from '../src/utils'

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
    })
})
