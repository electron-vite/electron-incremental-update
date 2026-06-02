import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

import { isCI } from 'ci-info'
import { loadPackageJSON } from 'local-pkg'
import type { InlineConfig, PluginOption } from 'vite'
import { mergeConfig, normalizePath } from 'vite'
import electron from 'vite-plugin-electron/multi-env'
import type { MultiEnvElectronOptions } from 'vite-plugin-electron/multi-env'
import { notBundle, esmShim } from 'vite-plugin-electron/plugin'

import { bytecodePlugin } from './bytecode'
import type { BytecodeOptions } from './bytecode'
import { id, log } from './constant'
import type { ElectronWithUpdaterOptions, PKG } from './option'
import { parseUpdaterOption } from './option'
import { buildAsar, buildUpdateJson } from './utils/build'
import { copyAndSkipIfExist } from './utils/file'

type ParsedUpdaterOptions = Awaited<ReturnType<typeof parseUpdaterOption>>

interface CachedResolvedOptions {
  isESM: boolean
  finalExternal: Array<string | RegExp>
  bytecodeOptions: BytecodeOptions | undefined
  buildAsarOption: ParsedUpdaterOptions['buildAsarOption']
  buildVersionOption: ParsedUpdaterOptions['buildVersionOption']
  cert: string
  entryOutDir: string
  mainFileBaseName: string
  define: Record<string, string>
}

interface GlobalCachedResolvedOptions {
  __eiuCachedOptions?: Promise<CachedResolvedOptions>
}

const globalCachedResolvedOptions = globalThis as typeof globalThis & GlobalCachedResolvedOptions
let cachedOptions = globalCachedResolvedOptions.__eiuCachedOptions

function getInputEntryName(options: ElectronWithUpdaterOptions['main']['files']): string {
  if (typeof options === 'string') {
    return path.parse(options).name
  }

  if (Array.isArray(options)) {
    const [firstInput] = options
    if (!firstInput) {
      throw new Error('`options.main.files` must contain at least one main entry')
    }
    return path.parse(firstInput).name
  }

  const firstEntry = Object.entries(options)[0]
  if (!firstEntry) {
    throw new Error('`options.main.files` must contain at least one main entry')
  }

  return firstEntry[0]
}

function getMainFileBaseName(
  options: ElectronWithUpdaterOptions['main']['files'],
  isESM: boolean,
): string {
  const mainFilePath = `${getInputEntryName(options)}.${isESM ? 'mjs' : 'js'}`
  log.info(`Using "${mainFilePath}" as main file`, { timestamp: true })
  return mainFilePath
}

function parseVersionPath(versionPath: string): string {
  versionPath = normalizePath(versionPath)
  if (!versionPath.startsWith('./')) {
    versionPath = `./${versionPath}`
  }
  return new URL(versionPath, 'file://').pathname.slice(1)
}

export const defaultExternal: Extract<ElectronWithUpdaterOptions['external'], object> = [
  ...builtinModules,
  'electron',
  'electron/common',
  'electron/main',
  'electron/renderer',
  'electron/utility',
  /^node:/,
  /.*\.(node|dll|dylib|so)$/,
  'original-fs',
]

async function resolveCachedOptions(
  options: ElectronWithUpdaterOptions,
): Promise<CachedResolvedOptions> {
  if (cachedOptions) {
    return cachedOptions
  }

  const result = (async () => {
    const { isBuild, root = process.cwd(), external, main: _main, updater, bytecode } = options

    const pkg = await loadPackageJSON(root)
    if (!pkg || !pkg.version || !pkg.name || !pkg.main) {
      throw new Error(
        'package.json not found or invalid, must contains version, name and main field',
      )
    }

    const isESM = pkg.type === 'module'
    const finalExternal = [...defaultExternal]
    if (external === true) {
      finalExternal.push(...Object.keys(pkg.dependencies || {}))
    } else if (Array.isArray(external)) {
      finalExternal.push(...external)
    }

    const bytecodeOptions =
      typeof bytecode === 'object' ? bytecode : bytecode === true ? { enable: true } : undefined

    if (isESM && bytecodeOptions?.enable) {
      throw new Error(
        '`bytecodePlugin` does not support ES module, please remove "type": "module" in package.json',
      )
    }

    const { buildAsarOption, buildVersionOption, cert, entryOutDir } = await parseUpdaterOption(
      pkg as PKG,
      updater,
    )

    log.info(`Clear cache files`, { timestamp: true })
    await Promise.all(
      [buildAsarOption.rendererDistPath, buildAsarOption.electronDistPath, entryOutDir].map((p) =>
        fs.promises.rm(path.resolve(root, p), {
          recursive: true,
          force: true,
        }),
      ),
    ).catch(() => {})

    const mainFileBaseName = getMainFileBaseName(_main.files, isESM)

    return {
      isESM,
      finalExternal,
      bytecodeOptions,
      buildAsarOption,
      buildVersionOption,
      cert,
      entryOutDir,
      mainFileBaseName,
      define: {
        __EIU_ASAR_BASE_NAME__: JSON.stringify(path.basename(buildAsarOption.asarOutputPath)),
        __EIU_ELECTRON_DIST_PATH__: JSON.stringify(normalizePath(buildAsarOption.electronDistPath)),
        __EIU_ENTRY_DIST_PATH__: JSON.stringify(normalizePath(entryOutDir)),
        __EIU_IS_DEV__: JSON.stringify(!isBuild),
        __EIU_IS_ESM__: JSON.stringify(isESM),
        __EIU_MAIN_FILE__: JSON.stringify(mainFileBaseName),
        __EIU_SIGNATURE_CERT__: JSON.stringify(cert),
        __EIU_VERSION_PATH__: JSON.stringify(
          parseVersionPath(normalizePath(buildVersionOption.versionPath)),
        ),
      },
    }
  })()
  // todo)) cleanup useless guard
  cachedOptions = result
  globalCachedResolvedOptions.__eiuCachedOptions = result

  try {
    return await result
  } catch (error) {
    if (cachedOptions === result) {
      cachedOptions = undefined
      globalCachedResolvedOptions.__eiuCachedOptions = undefined
    }
    throw error
  }
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
 * import { electronWithUpdater } from 'electron-incremental-update/vite'
 *
 * export default defineConfig(async ({ command }) => {
 *   const isBuild = command === 'build'
 *   return {
 *     plugins: [
 *       electronWithUpdater({
 *         isBuild,
 *         main: {
 *           files: ['./electron/main/index.ts', './electron/main/worker.ts'],
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
    root = process.cwd(),
    entry: _entry,
    main: _main,
    preload: _preload,
    sourcemap = !isBuild || !!process.env.VSCODE_DEBUG,
    minify = isBuild,
    buildVersionJson,
    notBundle: notBundleOption = true,
  } = options

  const {
    isESM,
    finalExternal,
    bytecodeOptions,
    buildAsarOption,
    buildVersionOption,
    entryOutDir,
    define,
  } = await resolveCachedOptions(options)

  // Build main configuration (same as before)
  const _electronOptions: MultiEnvElectronOptions[] = [
    {
      name: 'main',
      input: _main.files,
      onstart: _main.onstart,
      plugins: [
        isESM && esmShim(),
        notBundleOption &&
          notBundle(typeof notBundleOption === 'object' ? notBundleOption : undefined),
        bytecodeOptions && bytecodePlugin('main', minify, isESM, bytecodeOptions),
      ],
      options: mergeConfig(
        {
          build: {
            sourcemap,
            minify,
            outDir: `${buildAsarOption.electronDistPath}/main`,
            rolldownOptions: {
              external: finalExternal,
              platform: 'node',
              output: {
                format: isESM ? 'es' : 'cjs',
                minify: { codegen: { removeWhitespace: true } },
                entryFileNames: `[name].${isESM ? 'mjs' : 'js'}`,
                chunkFileNames: `[name].${isESM ? 'mjs' : 'js'}`,
                polyfillRequire: isESM,
                exports: 'named',
              },
            },
          },
          define,
        } satisfies InlineConfig,
        _main.options ?? {},
      ),
    },
  ]

  // Build preload configuration
  if (_preload?.files) {
    _electronOptions.push({
      name: 'preload',
      onstart(args) {
        // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete
        args.reload()
      },
      input: _preload.files,
      plugins: [
        isESM && esmShim(),
        notBundleOption &&
          notBundle(typeof notBundleOption === 'object' ? notBundleOption : undefined),
        bytecodeOptions && bytecodePlugin('preload', minify, isESM, bytecodeOptions),
      ],
      options: mergeConfig(
        {
          build: {
            sourcemap: sourcemap ? 'inline' : undefined,
            minify,
            outDir: `${buildAsarOption.electronDistPath}/preload`,
            rolldownOptions: {
              external: finalExternal,
              output: {
                // preload should use cjs format and not split
                format: 'cjs',
                codeSplitting: false,
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
        _preload?.options ?? {},
      ),
    })
  }

  _electronOptions.push({
    name: 'entry',
    input: _entry.files,
    async onstart(args) {
      await args.startup()
    },
    options: mergeConfig<InlineConfig, InlineConfig>(
      {
        plugins: [
          isESM && esmShim(),
          bytecodeOptions && bytecodePlugin('entry', minify, isESM, bytecodeOptions),
          notBundleOption &&
            notBundle(typeof notBundleOption === 'object' ? notBundleOption : undefined),
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
                copyModules() {
                  console.warn('`copyModules()` is deprecated. Will do nothing')
                },
              })

              if (!isBuild) {
                return
              }

              try {
                const buffer = await buildAsar(root, buildAsarOption)
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
                throw error
              }
            },
          },
        ],
        build: {
          sourcemap,
          minify,
          outDir: entryOutDir,
          rolldownOptions: {
            external: finalExternal,
            output: {
              format: isESM ? 'es' : 'cjs',
              entryFileNames: `[name].${isESM ? 'mjs' : 'js'}`,
              chunkFileNames: `[name].${isESM ? 'mjs' : 'js'}`,
            },
          },
        },
        define,
      },
      _entry.options || {},
    ),
  })

  return electron(_electronOptions)
}
