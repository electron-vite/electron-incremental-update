import { defineElectronConfig } from '../src/vite'

export default defineElectronConfig({
  entry: { files: ['./entry.ts', './native.ts'] },
  main: { files: './main.ts' },
  preload: { files: './preload.ts' },
  // todo)) new `root` in top level. create package.json if not exist
  renderer: {},
  updater: {},
})
