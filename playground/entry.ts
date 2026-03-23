import { createElectronApp } from '../dist/index.cjs'

createElectronApp({
  beforeStart(mainFilePath, logger) {
    logger?.info(mainFilePath)
  },
  updater: {
    logger: console,
  },
})
