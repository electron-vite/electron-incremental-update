import { defineElectronConfig } from './src/vite'

export default defineElectronConfig({
  root: './playground',
  bytecode: true,
  parallel: true,
  entry: {
    files: ['./entry.ts', './native.ts'],
  },
  main: {
    files: './main.ts',
  },
  preload: {
    files: './preload.ts',
  },
  renderer: {},
  updater: {},
})
