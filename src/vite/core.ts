import type { AnyFunction } from '@subframe7536/type-utils'
import type { ChildProcessWithoutNullStreams, StdioOptions } from 'node:child_process'
import type { InlineConfig, PluginOption } from 'vite'

import { isCI } from 'ci-info'
import { getPackageInfoSync, loadPackageJSON } from 'local-pkg'
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { mergeConfig, normalizePath } from 'vite'

import type { ElectronOptions } from './electron/core'
import type { RolldownOptions } from './electron/utils'
import type { ElectronWithUpdaterOptions, PKG } from './option'

import { buildAsar, buildUpdateJson } from './build'
import { bytecodePlugin } from './bytecode'
import { id, log } from './constant'
import electron from './electron/core'
import { notBundle } from './electron/plugin'
import { parseOptions } from './option'
import { copyAndSkipIfExist } from './utils'

export interface ElectronSimpleOptions {
  main: ElectronOptions
  preload?: Omit<ElectronOptions, 'entry'> & {
    /**
     * Shortcut of `build.rolldownOptions.input`.
     *
     * Preload scripts may contain Web assets, so use the `build.rolldownOptions.input` instead `build.lib.entry`.
     */
    input: RolldownOptions['input']
  }
}

type StartupFn = NonNullable<NonNullable<ElectronSimpleOptions['main']>['onstart']>

/**
 * Startup function for debug
 * @see {@link https://github.com/electron-vite/electron-vite-vue/blob/main/vite.config.ts electron-vite-vue template}
 * @example
 * import { debugStartup, buildElectronPluginOptions } from 'electron-incremental-update/vite'
 * const options = buildElectronPluginOptions({
 *   // ...
 *   main: {
 *     // ...
 *     startup: debugStartup
 *   },
 * })
 */
export const debugStartup: StartupFn = async (args: Parameters<StartupFn>[0]) => {
  if (process.env.VSCODE_DEBUG) {
    // For `.vscode/.debug.script.mjs`
    console.log('[startup] Electron App')
  } else {
    await args.startup()
  }
}

/**
 * Startup function to filter unwanted error message
 * @see {@link https://github.com/electron/electron/issues/46903#issuecomment-2848483520 reference}
 * @example
 * import { filterErrorMessageStartup, buildElectronPluginOptions } from 'electron-incremental-update/vite'
 * const options = buildElectronPluginOptions({
 *   // ...
 *   main: {
 *     // ...
 *     startup: args => filterErrorMessageStartup(
 *       args,
 *       // ignore error message when function returns false
 *       msg => !/"code":-32601/.test(msg)
 *     )
 *   },
 * })
 */
export async function filterErrorMessageStartup(
  args: Parameters<StartupFn>[0],
  filter: (msg: string) => boolean,
): Promise<void> {
  // https://github.com/electron-vite/./electron/pull/283
  // reserve file descriptor 3 for Chromium; put Node IPC on file descriptor 4
  const stdio: StdioOptions =
    process.platform === 'linux'
      ? ['inherit', 'pipe', 'pipe', 'ignore', 'ipc']
      : ['inherit', 'pipe', 'pipe', 'ipc']
  await args.startup(undefined, { stdio })
  const elec = (process as unknown as { electronApp: ChildProcessWithoutNullStreams }).electronApp
  elec.stdout.addListener('data', (data: Buffer) => {
    console.log(data.toString().trimEnd())
  })
  elec.stderr.addListener('data', (data: Buffer) => {
    const message = data.toString()
    if (filter(message)) {
      console.error(message)
    }
  })
}

/**
 * Startup function util to fix Windows terminal charset
 * @example
 * import { debugStartup, fixWinCharEncoding, buildElectronPluginOptions } from 'electron-incremental-update/vite'
 * const options = buildElectronPluginOptions({
 *   // ...
 *   main: {
 *     // ...
 *     startup: fixWinCharEncoding(debugStartup)
 *   },
 * })
 */
export function fixWinCharEncoding<T extends AnyFunction>(fn: T): T {
  return (async (...args) => {
    if (process.platform === 'win32') {
      ;(await import('node:child_process')).spawnSync('chcp', ['65001'])
    }
    await fn(...args)
  }) as T
}

function getMainFileBaseName(options: ElectronWithUpdaterOptions['main']['files']): string {
  let mainFilePath
  if (typeof options === 'string') {
    mainFilePath = path.basename(options)
  } else if (Array.isArray(options)) {
    mainFilePath = path.basename(options[0])
  } else {
    const name = options?.index ?? options?.main
    if (!name) {
      throw new Error(
        `\`options.main.files\` (${options}) must have "index" or "main" key, like \`{ index: "./electron/main/index.ts" }\``,
      )
    }
    mainFilePath = options?.index ? 'index.js' : 'main.js'
  }
  log.info(`Using "${mainFilePath}" as main file`, { timestamp: true })
  return mainFilePath.replace(/\.[cm]?ts$/, '.js')
}

function parseVersionPath(versionPath: string): string {
  versionPath = normalizePath(versionPath)
  if (!versionPath.startsWith('./')) {
    versionPath = `./${versionPath}`
  }
  return new URL(versionPath, 'file://').pathname.slice(1)
}

/**
 * Base on `./electron/simple`
 * - integrate with updater
 * - no `renderer` config
 * - remove old output file
 * - externalize dependencies
 * - auto restart when entry file changes
 * - other configs in {@link https://github.com/electron-vite/electron-vite-vue/blob/main/vite.config.ts electron-vite-vue template}
 *
 * You can override all the vite configs, except output directories (use `options.updater.paths.electronDistPath` instead)
 *
 * @example
 * ```ts
 * import { defineConfig } from 'vite'
 * import { debugStartup, electronWithUpdater } from 'electron-incremental-update/vite'
 *
 * export default defineConfig(async ({ command }) => {
 *   const isBuild = command === 'build'
 *   return {
 *     plugins: [
 *       electronWithUpdater({
 *         isBuild,
 *         main: {
 *           files: ['./electron/main/index.ts', './electron/main/worker.ts'],
 *           // see https://github.com/electron-vite/electron-vite-vue/blob/85ed267c4851bf59f32888d766c0071661d4b94c/vite.config.ts#L22-L28
 *           onstart: debugStartup,
 *         },
 *         preload: {
 *           files: './electron/preload/index.ts',
 *         },
 *         updater: {
 *           // options
 *         }
 *       }),
 *     ],
 *     server: process.env.VSCODE_DEBUG && (() => {
 *       const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL)
 *       return {
 *         host: url.hostname,
 *         port: +url.port,
 *       }
 *     })(),
 *   }
 * })
 * ```
 */
export async function electronWithUpdater(
  options: ElectronWithUpdaterOptions,
): Promise<PluginOption[] | undefined> {
  let {
    isBuild,
    entry: _entry,
    main: _main,
    preload: _preload,
    sourcemap = !isBuild,
    minify = isBuild,
    buildVersionJson,
    updater,
    bytecode,
    useNotBundle = true,
  } = options

  const pkg = await loadPackageJSON()
  if (!pkg || !pkg.version || !pkg.name || !pkg.main) {
    throw new Error('package.json not found or invalid, must contains version, name and main field')
  }
  log.info(`Clear cache files`, { timestamp: true })
  const isESM = pkg.type === 'module'
  const external = [
    ...builtinModules,
    'electron',
    /^node:/,
    /.*\.(node|dll|dylib|so)$/,
    'original-fs',
    ...(isBuild || _entry.postBuild ? [] : Object.keys(pkg.dependencies || {})),
  ]

  let bytecodeOptions =
    typeof bytecode === 'object' ? bytecode : bytecode === true ? { enable: true } : undefined

  if (isESM && bytecodeOptions?.enable) {
    throw new Error(
      '`bytecodePlugin` does not support ES module, please remove "type": "module" in package.json',
    )
  }

  const { buildAsarOption, buildVersionOption, cert, entryOutDir } = await parseOptions(
    pkg as PKG,
    updater,
  )

  sourcemap ??= isBuild || !!process.env.VSCODE_DEBUG

  try {
    fs.rmSync(buildAsarOption.electronDistPath, { recursive: true, force: true })
    fs.rmSync(entryOutDir, { recursive: true, force: true })
  } catch {}

  const define = {
    __EIU_ASAR_BASE_NAME__: JSON.stringify(path.basename(buildAsarOption.asarOutputPath)),
    __EIU_ELECTRON_DIST_PATH__: JSON.stringify(normalizePath(buildAsarOption.electronDistPath)),
    __EIU_ENTRY_DIST_PATH__: JSON.stringify(normalizePath(entryOutDir)),
    __EIU_IS_DEV__: JSON.stringify(!isBuild),
    __EIU_IS_ESM__: JSON.stringify(isESM),
    __EIU_MAIN_FILE__: JSON.stringify(getMainFileBaseName(_main.files)),
    __EIU_SIGNATURE_CERT__: JSON.stringify(cert),
    __EIU_VERSION_PATH__: JSON.stringify(
      parseVersionPath(normalizePath(buildVersionOption.versionPath)),
    ),
  }

  // Build main configuration (same as before)
  const _electronOptions: ElectronOptions[] = [
    {
      entry: _main.files,
      onstart: async (args: Parameters<StartupFn>[0]) => {
        if (_main.onstart) {
          await _main.onstart(args)
        } else {
          await args.startup()
        }
      },
      vite: mergeConfig(
        {
          plugins: [
            !isBuild && useNotBundle && notBundle(),
            bytecodeOptions && bytecodePlugin('main', bytecodeOptions),
          ],
          build: {
            sourcemap,
            minify,
            outDir: `${buildAsarOption.electronDistPath}/main`,
            rolldownOptions: {
              external,
              platform: 'node',
              output: {
                cleanDir: true,
                polyfillRequire: false,
              },
            },
          },
          define,
        } satisfies InlineConfig,
        _main.vite ?? {},
      ),
    },
  ]

  // Build preload configuration
  if (_preload?.files) {
    _electronOptions.push({
      onstart(args) {
        // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete
        args.reload()
      },
      vite: mergeConfig(
        {
          plugins: [bytecodeOptions && bytecodePlugin('preload', bytecodeOptions)],
          build: {
            sourcemap: sourcemap ? 'inline' : undefined,
            minify,
            outDir: `${buildAsarOption.electronDistPath}/preload`,
            rolldownOptions: {
              external,
              input: _preload.files,
              output: {
                // preload should use cjs format and not split
                format: 'cjs',
                inlineDynamicImports: true,
                // Keep core.ts configuration
                polyfillRequire: false,
                // File naming from simple.ts (based on esmodule detection)
                entryFileNames: `[name].${isESM ? 'mjs' : 'js'}`,
                chunkFileNames: `[name].${isESM ? 'mjs' : 'js'}`,
                assetFileNames: '[name].[ext]',
              },
            },
          },
          define,
        } satisfies InlineConfig,
        _preload?.vite ?? {},
      ),
    })
  }

  _electronOptions.push({
    entry: _entry.files,
    vite: mergeConfig<InlineConfig, InlineConfig>(
      {
        plugins: [
          bytecodeOptions && bytecodePlugin('main', bytecodeOptions),
          {
            name: `${id}:entry`,
            enforce: 'post',
            async closeBundle() {
              log.info(`Build entry to '${entryOutDir}'`, { timestamp: true })
              await _entry.postBuild?.({
                isBuild,
                getPathFromEntryOutputDir(...paths) {
                  return path.join(entryOutDir, ...paths)
                },
                copyToEntryOutputDir({ from, to = path.basename(from), skipIfExist = true }) {
                  if (!fs.existsSync(from)) {
                    log.warn(`${from} not found`, { timestamp: true })
                    return
                  }
                  const target = path.join(entryOutDir, to)
                  copyAndSkipIfExist(from, target, skipIfExist)
                },
                copyModules({ modules, skipIfExist = true }) {
                  const nodeModulesPath = path.join(entryOutDir, 'node_modules')
                  for (const m of modules) {
                    const { rootPath } = getPackageInfoSync(m) || {}
                    if (!rootPath) {
                      log.warn(`Package '${m}' not found`, { timestamp: true })
                      continue
                    }
                    copyAndSkipIfExist(rootPath, path.join(nodeModulesPath, m), skipIfExist)
                  }
                },
              })
              if (isBuild) {
                try {
                  const buffer = await buildAsar(buildAsarOption)
                  if (!buildVersionJson && !isCI) {
                    log.warn(
                      'No `buildVersionJson` option setup, skip build version json. Only build in CI by default',
                      { timestamp: true },
                    )
                  } else {
                    await buildUpdateJson(buildVersionOption, buffer)
                  }
                } catch (error) {
                  console.error(error)
                }
              }
            },
          },
        ],
        build: {
          sourcemap,
          minify,
          outDir: entryOutDir,
          rolldownOptions: {
            external,
            platform: 'node',
            output: {
              polyfillRequire: false,
            },
          },
        },
        define,
      },
      _entry.vite || {},
    ),
  })

  return electron(isESM, _electronOptions)
}
