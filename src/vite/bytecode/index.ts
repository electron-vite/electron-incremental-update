import path from 'node:path'

import type { MultiEnvElectronOptions } from 'vite-plugin-electron/multi-env'

import type { Promisable } from '../../utils/type'
import { bytecodeId, bytecodeLog } from '../constant'

import { bytecodeModuleLoaderCode } from './code'
import {
  bytecodeModuleLoader,
  compileToBytecode,
  createPrepareContext,
  prepare,
  useStrict,
} from './utils'

/** Options for bytecode compilation */
export interface BytecodeOptions {
  /**
   * Enable bytecode compilation
   * @default true
   */
  enable?: boolean
  /**
   * Enable in preload script. Remember to set `sandbox: false` when creating window
   */
  preload?: boolean
  /**
   * Custom electron binary path for bytecode generation
   */
  electronPath?: string
  /**
   * Before transformed code compile function. If return `Falsy` value, it will be ignored
   * @param code - Transformed code
   * @param id - File path
   * @returns Transformed code or falsy to ignore
   */
  beforeCompile?: (code: string, id: string) => Promisable<string | null | undefined | void>
}

function getBytecodeLoaderBlock(chunkFileName: string): string {
  const loaderFileName = path.posix.relative(
    path.posix.dirname(chunkFileName),
    bytecodeModuleLoader,
  )
  return `require("${loaderFileName.startsWith('.') ? loaderFileName : `./${loaderFileName}`}")`
}

export function bytecodePlugin(
  env: 'preload' | 'main' | 'entry',
  minify: boolean,
  isESM: boolean,
  options: BytecodeOptions,
): MultiEnvElectronOptions['plugins'] | null {
  const { enable, preload = false, electronPath, beforeCompile } = options
  if (!enable) {
    return null
  }

  if (env === 'preload' && !preload) {
    if (preload === undefined) {
      bytecodeLog.warn(
        '`bytecodePlugin` is skipped in preload. Set `bytecode: { preload: false }` to disable this warning, or `bytecode: { preload: true }` and set `sandbox: false` in BrowserWindow to enable bytecode in preload.',
        { timestamp: true },
      )
    }
    return null
  }

  if (isESM) {
    throw new Error(
      '`bytecodePlugin` requires CommonJS. Set "type": "commonjs" in package.json and use .cjs extensions',
    )
  }

  let hasJsChunks = false

  return {
    name: bytecodeId,

    async generateBundle(outputOptions, bundle) {
      // Only emit loader if actual JS chunks exist (skip if only assets)
      hasJsChunks = Object.values(bundle).some(
        (file) =>
          file.type === 'chunk' &&
          (file.fileName.endsWith('.js') || file.fileName.endsWith('.cjs')),
      )

      if (hasJsChunks) {
        this.emitFile({
          type: 'asset',
          source: `${bytecodeModuleLoaderCode}\n`,
          name: 'Bytecode Loader',
          fileName: bytecodeModuleLoader,
        })
      }

      if (!hasJsChunks) {
        return
      }

      const outputDir =
        outputOptions.dir ?? (outputOptions.file && path.dirname(outputOptions.file))

      // Precompute non-entry basenames ONCE (critical for prepare())
      const nonEntryBasenames = Object.values(bundle)
        .filter(
          (f): f is (typeof bundle)[string] & { type: 'chunk' } => f.type === 'chunk' && !f.isEntry,
        )
        .map((c) => path.posix.basename(c.fileName))
      const prepareContext = createPrepareContext(nonEntryBasenames)

      // Process chunks concurrently with controlled parallelism
      await Promise.all(
        Object.entries(bundle).map(async ([fileName, item]) => {
          if (item.type !== 'chunk' || fileName === bytecodeModuleLoader) {
            return
          }

          const chunk = item as any
          const bytecodeFileName = `${fileName}c`
          const absPath = outputDir ? path.join(outputDir, fileName) : fileName

          // 1. Prepare code (minify + runtime cleanup)
          let code = prepare(chunk.code, minify, prepareContext)?.code || chunk.code

          // 2. Optional transformation hook
          if (beforeCompile) {
            const hookResult = await beforeCompile(code, absPath)
            if (hookResult) {
              code = hookResult
            }
          }

          // 3. Compile to bytecode (critical path)
          const bytecode = await compileToBytecode(code, absPath, electronPath)
          if (typeof bytecode === 'string') {
            throw new TypeError(bytecode)
          }

          // 4. Emit bytecode file (.jsc/.cjsc)
          this.emitFile({
            type: 'asset',
            source: bytecode,
            fileName: bytecodeFileName,
          })

          // 5. Handle JS chunk replacement
          if (chunk.isEntry) {
            // Entry: Keep JS as loader stub
            const loaderBlock = getBytecodeLoaderBlock(fileName)
            chunk.code = `${useStrict}\n${loaderBlock}\nmodule.exports=require("./${path.posix.basename(fileName)}c");\n`
          } else {
            // Non-entry: Remove JS from bundle before it is written
            delete bundle[fileName]
          }
        }),
      )
    },
  }
}
