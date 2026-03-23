import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      index: './src/entry/index.ts',
      utils: './src/utils/index.ts',
      provider: './src/provider/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: { oxc: true },
    deps: {
      onlyBundle: ['@subframe7536/type-utils'],
      neverBundle: ['electron'],
    },
    outputOptions: {
      polyfillRequire: false,
    },
    exports: true,
  },
  {
    entry: {
      vite: './src/vite/index.ts',
    },
    format: 'esm',
    dts: { oxc: true },
    exports: true,
    deps: {
      onlyBundle: ['@subframe7536/type-utils'],
      neverBundle: ['electron', 'vite'],
    },
  },
])
