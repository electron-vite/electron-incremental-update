import { createElectronApp } from '../dist/index.mjs'

createElectronApp({
  beforeStart(mainFilePath, logger) {
    logger?.info(mainFilePath)
  },
  updater: {
    logger: console,
  },
})
