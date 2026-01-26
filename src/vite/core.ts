import type { AnyFunction } from '@subframe7536/type-utils'
import type { ChildProcessWithoutNullStreams, StdioOptions } from 'node:child_process'
import type { InlineConfig, PluginOption } from 'vite'

import { isCI } from 'ci-info'
import { getPackageInfoSync, loadPackageJSON } from 'local-pkg'
import fs from 'node:fs'
import path from 'node:path'
import { mergeConfig, normalizePath } from 'vite'

import type { ElectronSimpleOptions } from './electron/simple'
import type { ElectronWithUpdaterOptions, PKG } from './option'

import { buildAsar, buildEntry, buildUpdateJson } from './build'
import { bytecodePlugin } from './bytecode'
import { id, log } from './constant'
import { startup } from './electron/core'
import { notBundle } from './electron/plugin'
import ElectronSimple from './electron/simple'
import { parseOptions } from './option'
import { copyAndSkipIfExist, resolveInputToArray } from './utils'

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
export const debugStartup: StartupFn = async (args) => {
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
    log.error('package.json not found or invalid, must contains version, name and main field', {
      timestamp: true,
    })
    return undefined
  }
  const isESM = pkg.type === 'module'

  let bytecodeOptions =
    typeof bytecode === 'object' ? bytecode : bytecode === true ? { enable: true } : undefined

  if (isESM && bytecodeOptions?.enable) {
    throw new Error(
      '`bytecodePlugin` does not support ES module, please remove "type": "module" in package.json',
    )
  }

  const { buildAsarOption, buildEntryOption, buildVersionOption, postBuild, cert } =
    await parseOptions(isBuild, pkg as PKG, sourcemap, minify, _entry, updater)

  const { outDir: entryOutputDirPath, files, external } = buildEntryOption

  try {
    fs.rmSync(buildAsarOption.electronDistPath, { recursive: true, force: true })
    fs.rmSync(entryOutputDirPath, { recursive: true, force: true })
  } catch {}
  log.info(`Clear cache files`, { timestamp: true })

  sourcemap ??= isBuild || !!process.env.VSCODE_DEBUG

  const _appPath = normalizePath(path.join(entryOutputDirPath, 'entry.js'))
  if (path.resolve(normalizePath(pkg.main)) !== path.resolve(_appPath)) {
    throw new Error(`Wrong "main" field in package.json: "${pkg.main}", it should be "${_appPath}"`)
  }

  const define = {
    __EIU_ASAR_BASE_NAME__: JSON.stringify(path.basename(buildAsarOption.asarOutputPath)),
    __EIU_ELECTRON_DIST_PATH__: JSON.stringify(normalizePath(buildAsarOption.electronDistPath)),
    __EIU_ENTRY_DIST_PATH__: JSON.stringify(normalizePath(buildEntryOption.outDir)),
    __EIU_IS_DEV__: JSON.stringify(!isBuild),
    __EIU_IS_ESM__: JSON.stringify(isESM),
    __EIU_MAIN_FILE__: JSON.stringify(getMainFileBaseName(_main.files)),
    __EIU_SIGNATURE_CERT__: JSON.stringify(cert),
    __EIU_VERSION_PATH__: JSON.stringify(
      parseVersionPath(normalizePath(buildVersionOption.versionPath)),
    ),
  }

  async function _buildEntry(): Promise<void> {
    await buildEntry(buildEntryOption, isESM, define, bytecodeOptions)
    log.info(`Build entry to '${entryOutputDirPath}'`, { timestamp: true })
    await postBuild?.({
      isBuild,
      getPathFromEntryOutputDir(...paths) {
        return path.join(entryOutputDirPath, ...paths)
      },
      copyToEntryOutputDir({ from, to = path.basename(from), skipIfExist = true }) {
        if (!fs.existsSync(from)) {
          log.warn(`${from} not found`, { timestamp: true })
          return
        }
        const target = path.join(entryOutputDirPath, to)
        copyAndSkipIfExist(from, target, skipIfExist)
      },
      copyModules({ modules, skipIfExist = true }) {
        const nodeModulesPath = path.join(entryOutputDirPath, 'node_modules')
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
  }

  let isInit = false

  const electronPluginOptions: ElectronSimpleOptions = {
    main: {
      entry: _main.files,
      onstart: async (args) => {
        if (!isInit) {
          isInit = true
          await _buildEntry()
        }
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
              output: {
                polyfillRequire: false,
                format: isESM ? 'esm' : 'cjs',
              },
            },
          },
          define,
        } satisfies InlineConfig,
        _main.vite ?? {},
      ),
    },
    preload: {
      input: _preload.files,
      vite: mergeConfig(
        {
          plugins: [
            bytecodeOptions && bytecodePlugin('preload', bytecodeOptions),
            {
              name: `${id}-build`,
              enforce: 'post',
              apply() {
                return isBuild
              },
              async closeBundle() {
                await _buildEntry()
                const buffer = await buildAsar(buildAsarOption)
                if (!buildVersionJson && !isCI) {
                  log.warn(
                    'No `buildVersionJson` option setup, skip build version json. Only build in CI by default',
                    { timestamp: true },
                  )
                } else {
                  await buildUpdateJson(buildVersionOption, buffer)
                }
              },
            },
          ],
          build: {
            sourcemap: sourcemap ? 'inline' : undefined,
            minify,
            outDir: `${buildAsarOption.electronDistPath}/preload`,
            rolldownOptions: {
              external,
              output: {
                polyfillRequire: false,
              },
            },
          },
          define,
        } satisfies InlineConfig,
        _preload?.vite ?? {},
      ),
    },
  }

  const result: PluginOption[] = [ElectronSimple(electronPluginOptions)]

  if (files) {
    const watchFiles = resolveInputToArray(files).map((file) => path.resolve(normalizePath(file)))

    result.push({
      name: `${id}-dev`,
      apply() {
        return !isBuild
      },
      configureServer(server) {
        server.watcher.add(watchFiles).on('change', async (p) => {
          if (!watchFiles.includes(p)) {
            return
          }
          await _buildEntry()
          if (_main.onstart) {
            await _main.onstart({
              startup,
              reload: () => {
                if (process.electronApp) {
                  ;(server.hot || server.ws).send({ type: 'full-reload' })
                  startup.send('electron-vite&type=hot-reload')
                } else {
                  startup()
                }
              },
            })
          } else {
            await startup()
          }
        })
      },
    })
  }

  return result
}
