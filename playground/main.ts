import { app, BrowserWindow } from 'electron'

import { startupWithUpdater } from '../src/entry'
import { getPathFromPreload, loadPage, requireNative } from '../src/utils'

export default startupWithUpdater(() => {
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
