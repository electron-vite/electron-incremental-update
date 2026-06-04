import { defineElectronConfig } from './src/vite'

export default defineElectronConfig({
  bytecode: true,
  entry: {
    files: ['./entry.ts', './native.ts'],
  },
  main: {
    files: './main.ts',
  },
  preload: {
    files: './preload.ts',
  },
  renderer: {
    root: './playground',
  },
  updater: {},
})
