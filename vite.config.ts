import { defineElectronConfig } from './src/vite'

export default defineElectronConfig({
  root: './playground',
  buildVersionJson: true,
  bytecode: {
    preload: false,
  },
  entry: {
    files: ['./entry.ts', './native.ts'],
  },
  localDevUpdate: true,
  main: {
    files: './main.ts',
  },
  preload: {
    files: './preload.ts',
  },
  renderer: {},
  updater: {},
})
