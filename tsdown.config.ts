import { build, defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      index: './src/entry/index.ts',
      utils: './src/utils/index.ts',
      provider: './src/provider/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: { oxc: true },
    css: {
      minify: true,
    },
    deps: {
      skipNodeModulesBundle: true,
    },
    outputOptions: {
      polyfillRequire: false,
    },
    exports: true,
    plugins: [
      {
        name: 'inline-script',
        load: {
          order: 'pre',
          async handler(id) {
            if (!id.endsWith('?inject')) {
              return
            }

            const result = await build({
              entry: id.replace('?inject', ''),
              clean: false,
              config: false,
              minify: true,
              write: false,
            })
            const c = result[0].chunks[1]
            if (c?.type === 'chunk') {
              return `export default '${c.code.replace('export{};', '')}'`
            }
          },
        },
      },
    ],
  },
  {
    entry: {
      vite: './src/vite/index.ts',
    },
    format: 'esm',
    dts: { oxc: true },
    exports: true,
    deps: {
      skipNodeModulesBundle: true,
    },
  },
])
