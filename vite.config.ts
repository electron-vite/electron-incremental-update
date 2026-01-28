import { defineElectronConfig } from './src/vite'

export default defineElectronConfig({
  root: './playground',
  entry: { files: ['./entry.ts', './native.ts'] },
  main: {
    files: './main.ts',
  },
  // preload: { files: './preload.ts' },
  renderer: {},
  updater: {},
})
