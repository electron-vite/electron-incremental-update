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
            const chunk = result[0].chunks.find((item) => item.type === 'chunk')
            if (chunk) {
              const code = chunk.code.replace('export{};', '')
              return `export default ${JSON.stringify(code)}`
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
