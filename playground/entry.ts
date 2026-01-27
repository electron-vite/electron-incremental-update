import { createElectronApp } from '../src/entry'

createElectronApp({
  beforeStart(mainFilePath, logger) {
    logger?.info(mainFilePath)
  },
  updater: {
    logger: console,
  },
})
