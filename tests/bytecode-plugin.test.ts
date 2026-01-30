import { describe, expect, it } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { build } from 'vite'

import { bytecodePlugin } from '../src/vite/bytecode'
import { defaultExternal } from '../src/vite/core'

describe(() => {
  it('basic plugin usage', async () => {
    const plugin = bytecodePlugin('main', false, {
      enable: true,
      beforeCompile(code, id) {
        writeFileSync(id.replace(/\.cjs$/, '.origin.cjs'), code, 'utf-8')
      },
    })
    const outDir = 'tests/dist'
    const result = await build({
      configFile: false,
      publicDir: false,
      plugins: [plugin],
      mode: 'build',
      define: {
        __EIU_IS_DEV__: JSON.stringify(false),
        __EIU_IS_ESM__: JSON.stringify(false),
      },
      build: {
        lib: {
          entry: { test: 'playground/main.ts' },
          formats: ['cjs'],
        },
        outDir,
        rolldownOptions: {
          external: defaultExternal,
          treeshake: {
            moduleSideEffects: false,
            propertyReadSideEffects: false,
          },
          output: {
            minify: true,
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
