import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

import { isCI } from 'ci-info'
import { loadPackageJSON } from 'local-pkg'
import type { InlineConfig, PluginOption } from 'vite'
import { mergeConfig, normalizePath } from 'vite'

import { bytecodePlugin } from './bytecode'
import { id, log } from './constant'
import type { ElectronOptions } from './electron/core'
import electron from './electron/core'
import { notBundle } from './electron/plugin'
import type { ElectronWithUpdaterOptions, PKG } from './option'
import { parseUpdaterOption } from './option'
import { buildAsar, buildUpdateJson } from './utils/build'
import { copyAndSkipIfExist } from './utils/file'

function getMainFileBaseName(options: ElectronWithUpdaterOptions['main']['files']): string {
  let mainFilePath
  if (typeof options === 'string') {
    mainFilePath = path.basename(options)
  } else if (Array.isArray(options)) {
    mainFilePath = path.basename(options[0]!)
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
    root = process.cwd(),
    external,
    parallel = false,
    entry: _entry,
    main: _main,
    preload: _preload,
    sourcemap = !isBuild || !!process.env.VSCODE_DEBUG,
    minify = isBuild,
    buildVersionJson,
    updater,
    bytecode,
    notBundle: notBundleOption = true,
  } = options

  const pkg = await loadPackageJSON(root)
  if (!pkg || !pkg.version || !pkg.name || !pkg.main) {
    throw new Error('package.json not found or invalid, must contains version, name and main field')
  }

  const isESM = pkg.type === 'module'
  const finalExternal = [...defaultExternal]
  if (external === true) {
    finalExternal.push(...Object.keys(pkg.dependencies || {}))
  } else if (Array.isArray(external)) {
    finalExternal.push(...external)
  }

  let bytecodeOptions =
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
      onstart: _main.onstart,
      vite: mergeConfig(
        {
          plugins: [
            !isBuild &&
              notBundleOption &&
              notBundle(typeof notBundleOption === 'object' ? notBundleOption : undefined),
            bytecodeOptions && bytecodePlugin('main', minify, isESM, bytecodeOptions),
          ],
          build: {
            sourcemap,
            minify,
            outDir: `${buildAsarOption.electronDistPath}/main`,
            rolldownOptions: {
              external: finalExternal,
              platform: 'node',
              output: {
                minify: { codegen: { removeWhitespace: true } },
                polyfillRequire: false,
                exports: 'named',
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
          plugins: [bytecodeOptions && bytecodePlugin('preload', minify, isESM, bytecodeOptions)],
          build: {
            sourcemap: sourcemap ? 'inline' : undefined,
            minify,
            outDir: `${buildAsarOption.electronDistPath}/preload`,
            rolldownOptions: {
              external: finalExternal,
              input: _preload.files,
              output: {
                minify: { codegen: { removeWhitespace: true } },
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
        _preload?.vite ?? {},
      ),
    })
  }

  _electronOptions.push({
    entry: _entry.files,
    vite: mergeConfig<InlineConfig, InlineConfig>(
      {
        plugins: [
          bytecodeOptions && bytecodePlugin('entry', minify, isESM, bytecodeOptions),
          !isBuild &&
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
              if (isBuild) {
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
            external: finalExternal,
            platform: 'node',
            output: {
              minify: { codegen: { removeWhitespace: true } },
              polyfillRequire: false,
            },
          },
        },
        define,
      },
      _entry.vite || {},
    ),
  })

  return electron(isESM, normalizePath(path.resolve(root)), parallel, _electronOptions)
}
