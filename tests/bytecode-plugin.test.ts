import { describe, expect, it } from 'bun:test'
import { build } from 'vite'

import { bytecodePlugin } from '../src/vite/bytecode'
import { defaultExternal } from '../src/vite/core'

describe(() => {
  it('basic plugin usage', async () => {
    const plugin = bytecodePlugin('main', false, { enable: true })

    const outDir = 'tests/dist'
    const result = await build({
      configFile: false,
      publicDir: false,
      plugins: [plugin],
      mode: 'build',
      build: {
        lib: {
          entry: { test: 'playground/main.ts' },
          formats: ['cjs'],
        },
        outDir,
        rolldownOptions: {
          external: defaultExternal,
          output: {
            minify: { compress: true, codegen: { removeWhitespace: false } },
          },
        },
      },
    })

    expect(result).toMatchInlineSnapshot(`
      [
        RolldownOutputImpl {
          "bindingOutputs": {
            "assets": [
              BindingOutputAsset {},
            ],
            "chunks": [
              BindingOutputChunk {},
              BindingOutputChunk {},
            ],
          },
          "output": [native code],
        },
      ]
    `)
  })
})
