import { rmSync } from 'node:fs'

import { build, defineConfig } from 'tsdown'

async function transformJS(path: string) {
  const result = await build({
    entry: path,
    minify: true,
    write: false,
    dts: false,
    config: false,
  })

  const chunk = result[0].chunks[0]
  if (chunk.type === 'chunk') {
    return chunk.code
  }
  throw new Error('Not chunk')
}
async function transformCSS(path: string) {
  const result = await build({
    entry: path,
    minify: true,
    write: false,
    dts: false,
    config: false,
  })

  const chunk = result[0].chunks[1]
  if (chunk.type === 'asset') {
    return chunk.source.toString().replace(/\s+/g, ' ')
  }
  throw new Error('Not asset')
}

rmSync('./dist', { recursive: true, force: true })
const fontCSS = await transformCSS('./src/utils/devtools/font.css')
const scrollbarCSS = await transformCSS('./src/utils/devtools/scrollbar.css')
const JS = await transformJS('./src/utils/devtools/js.ts')

export default defineConfig([
  {
    entry: {
      index: './src/entry/index.ts',
      utils: './src/utils/index.ts',
      provider: './src/provider/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: { oxc: true },
    exports: true,
    external: 'electron',
    define: {
      __FONT_CSS__: JSON.stringify(fontCSS?.replace(/\n/g, '') || ''),
      __SCROLLBAR_CSS__: JSON.stringify(scrollbarCSS?.replace(/\n/g, '') || ''),
      __JS__: JSON.stringify(JS?.replace(/\n/g, '').replace('export{};', '') || ''),
    },
  },
  {
    entry: {
      vite: './src/vite/index.ts',
    },
    format: 'esm',
    dts: { oxc: true },
    exports: true,
    external: ['electron', 'vite'],
  },
])
