import type { Promisable } from '@subframe7536/type-utils'
import type { Plugin, ResolvedConfig } from 'vite'

import fs from 'node:fs'
import path from 'node:path'
import { normalizePath } from 'vite'

import { bytecodeId, bytecodeLog } from '../constant'
import { readableSize } from '../utils/file'
import { bytecodeModuleLoaderCode } from './code'
import {
  bytecodeModuleLoader,
  compileToBytecode,
  prepare,
  toRelativePath,
  useStrict,
} from './utils'

/** Options for bytecode compilation */
export interface BytecodeOptions {
  /** Enable bytecode compilation */
  enable: boolean
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

const LOADER_REQUIRE = `require("${toRelativePath(bytecodeModuleLoader, '')}")`

function getBytecodeLoaderBlock(chunkFileName: string): string {
  return LOADER_REQUIRE.replace(/['"]$/, `/${toRelativePath('', normalizePath(chunkFileName))}"`)
}

export function bytecodePlugin(
  env: 'preload' | 'main',
  minify: boolean,
  isESM: boolean,
  options: BytecodeOptions,
): Plugin | null {
  const { enable, preload = false, electronPath, beforeCompile } = options

  // Early validation (fail fast)
  if (!enable) {
    return null
  }

  if (!preload && env === 'preload') {
    bytecodeLog.warn(
      '`bytecodePlugin` is skipped in preload. Enable with "preload: true" and set `sandbox: false` in BrowserWindow',
      { timestamp: true },
    )
    return null
  }

  if (isESM) {
    throw new Error(
      '`bytecodePlugin` requires CommonJS. Set "type": "commonjs" in package.json and use .cjs extensions',
    )
  }

  let config: ResolvedConfig
  const bytecodeFiles: { name: string; size: number }[] = []

  return {
    name: bytecodeId,
    apply: 'build',
    enforce: 'post',

    configResolved(resolvedConfig) {
      config = resolvedConfig
    },

    generateBundle(_, bundle) {
      // Only emit loader if actual JS chunks exist (skip if only assets)
      const hasJsChunks = Object.values(bundle).some(
        (file) =>
          file.type === 'chunk' &&
          (file.fileName.endsWith('.js') || file.fileName.endsWith('.cjs')),
      )

      if (hasJsChunks) {
        this.emitFile({
          type: 'asset',
          source: bytecodeModuleLoaderCode + '\n',
          name: 'Bytecode Loader',
          fileName: bytecodeModuleLoader,
        })
      }
    },

    // Optimized: Unified processing with minimal I/O and no graph traversal
    async writeBundle({ dir }, output) {
      if (!dir) {
        return
      }

      // Precompute non-entry basenames ONCE (critical for prepare())
      const nonEntryBasenames = Object.values(output)
        .filter(
          (f): f is (typeof output)[string] & { type: 'chunk' } => f.type === 'chunk' && !f.isEntry,
        )
        .map((c) => path.basename(c.fileName))

      // Process chunks concurrently with controlled parallelism
      await Promise.all(
        Object.entries(output).map(async ([fileName, item]) => {
          if (item.type !== 'chunk' || fileName === bytecodeModuleLoader) {
            return
          }

          const chunk = item as any
          const absPath = path.join(dir, fileName)

          // 1. Prepare code (minify + runtime cleanup)
          let code = prepare(chunk.code, minify, nonEntryBasenames)?.code || chunk.code

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
            throw new Error(bytecode)
          }

          // 4. Write bytecode file (.jsc)
          const bytecodePath = `${absPath}c`
          fs.writeFileSync(bytecodePath, bytecode)
          bytecodeFiles.push({ name: `${fileName}c`, size: bytecode.length })

          // 5. Handle JS file replacement
          if (chunk.isEntry) {
            // Entry: Replace JS with loader stub
            const loaderBlock = getBytecodeLoaderBlock(fileName)
            const stub = `${useStrict}\n${loaderBlock}\nmodule.exports=require("./${path.basename(fileName)}c");\n`
            fs.writeFileSync(absPath, stub)
          } else {
            // Non-entry: Remove JS from bundle (only .jsc remains)
            delete output[fileName]
          }
        }),
      )
    },

    // Optimized: Batch logging with single I/O operation
    closeBundle() {
      if (bytecodeFiles.length === 0) {
        return
      }

      const outDir = normalizePath(path.relative(config.root, config.build.outDir)) + '/'

      const logs = bytecodeFiles.map((f) => `- ${outDir}${f.name} [${readableSize(f.size)}]`)

      bytecodeLog.info(
        [
          `${bytecodeFiles.length} bundle${bytecodeFiles.length === 1 ? '' : 's'} compiled to bytecode:`,
          ...logs,
        ].join('\n'),
        { timestamp: true },
      )
    },
  }
}
