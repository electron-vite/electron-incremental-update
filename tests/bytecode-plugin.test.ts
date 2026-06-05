import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import { build } from 'vite'

import { bytecodePlugin } from '../src/vite/bytecode'
import { defaultExternal } from '../src/vite/constant'

describe(() => {
  it('basic plugin usage', async () => {
    const plugin = bytecodePlugin('main', false, false, {
      enable: true,
    })
    const outDir = 'tests/dist'
    rmSync(outDir, { recursive: true, force: true })

    await build({
      configFile: false,
      publicDir: false,
      plugins: [plugin as any],
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

    const files = readdirSync(outDir)
    const entryStub = readFileSync(path.join(outDir, 'test.cjs'), 'utf-8')
    const dynamicBytecode = files.find((file) => file.startsWith('utils-') && file.endsWith('.cjsc'))
    const dynamicSource = files.find(
      (file) => file.startsWith('utils-') && (file.endsWith('.js') || file.endsWith('.cjs')),
    )

    expect(existsSync(path.join(outDir, '__loader__.js'))).toBe(true)
    expect(existsSync(path.join(outDir, 'test.cjsc'))).toBe(true)
    expect(entryStub).toContain('module.exports=require("./test.cjsc")')
    expect(dynamicBytecode).toBeDefined()
    expect(dynamicSource).toBeUndefined()
  })
})
