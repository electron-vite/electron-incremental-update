import { app, BrowserWindow } from 'electron'

import { startupWithUpdater } from '../src/entry'

export default startupWithUpdater(() => {
  app
    .whenReady()
    .then(() => import('./utils'))
    .then((util) => console.log(util.data))
    .then(() => {
      new BrowserWindow({
        title: 'Main window',
      })
    })
})
