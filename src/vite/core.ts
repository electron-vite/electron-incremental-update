import fs from 'node:fs'
import path from 'node:path'

import { isCI } from 'ci-info'
import type { EnvironmentOptions, Plugin } from 'vite'
import { mergeConfig, normalizePath } from 'vite'
import { electronPluginFactory } from 'vite-plugin-electron/multi-env'
import type {
  MultiEnvElectronOptions,
  ElectronFactoryContext,
} from 'vite-plugin-electron/multi-env'
import { esmShim } from 'vite-plugin-electron/plugin'

import { defaultSignature } from '../utils/crypto'
import { defaultVersionJsonGenerator } from '../utils/version'
import { defaultZipFile } from '../utils/zip'

import { bytecodePlugin } from './bytecode'
import { defaultExternal, id, log } from './constant'
import type {
  BuildAsarOptions,
  BuildVersionOptions,
  ElectronWithUpdaterOptions,
  PKG,
  UpdaterOptions,
} from './types'
import { buildAsar, buildUpdateJson } from './utils/build'
import { copyAndSkipIfExist } from './utils/file'
import { parseKeys } from './utils/key'

async function resolveUpdaterOption(
  pkg: PKG,
  options: UpdaterOptions = {},
): Promise<{
  buildAsarOption: BuildAsarOptions
  buildVersionOption: BuildVersionOptions
  entryOutDir: string
}> {
  const {
    minimumVersion = '0.0.0',
    paths: {
      asarOutputPath = `release/${pkg.name}.asar`,
      gzipPath = `release/${pkg.name}-${pkg.version}.asar.gz`,
      entryOutDir = 'dist-entry',
      electronDistPath = 'dist-electron',
      rendererDistPath = 'dist',
      versionPath = 'release/version.json',
    } = {},
    keys: {
      privateKeyPath = 'keys/private.pem',
      certPath = 'keys/cert.pem',
      keyLength = 2048,
      certInfo: {
        subject = {
          commonName: pkg.name,
          organizationName: `org.${pkg.name}`,
        },
        days = 3650,
      } = {},
    } = {},
    overrideGenerator: {
      generateGzipFile = defaultZipFile,
      generateSignature = defaultSignature,
      generateUpdateJson = defaultVersionJsonGenerator,
    } = {},
  } = options

  const { privateKey, cert } = await parseKeys({
    keyLength,
    privateKeyPath,
    certPath,
    subject,
    days,
  })

  return {
    buildAsarOption: {
      version: pkg.version,
      asarOutputPath,
      gzipPath,
      electronDistPath,
      rendererDistPath,
      generateGzipFile,
    },
    buildVersionOption: {
      version: pkg.version,
      minimumVersion,
      privateKey,
      cert,
      versionPath,
      generateSignature,
      generateUpdateJson,
    },
    entryOutDir,
  }
}

function resolveEntryName(files: ElectronWithUpdaterOptions['main']['files']): string {
  if (typeof files === 'string') {
    return path.parse(files).name
  }
  if (Array.isArray(files)) {
    const [firstInput] = files
    if (!firstInput) {
      throw new Error('`options.main.files` must contain at least one main entry')
    }
    return path.parse(firstInput).name
  }
  const firstEntry = Object.entries(files)[0]
  if (!firstEntry) {
    throw new Error('`options.main.files` must contain at least one main entry')
  }
  return firstEntry[0]
}

function normalizeVersionPath(versionPath: string): string {
  versionPath = normalizePath(versionPath)
  if (!versionPath.startsWith('./')) {
    versionPath = `./${versionPath}`
  }
  return new URL(versionPath, 'file://').pathname.slice(1)
}

async function createElectronOptions(
  options: ElectronWithUpdaterOptions,
  context: ElectronFactoryContext,
): Promise<MultiEnvElectronOptions[]> {
  const {
    entry,
    main,
    preload,
    sourcemap = !context.isDev || !!process.env.VSCODE_DEBUG,
    minify = context.isDev,
    buildVersionJson,
    notBundle = true,
    external,
    updater,
    bytecode,
  } = options

  const pkg = context.packageJson
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

  const bytecodeOptions =
    typeof bytecode === 'object' ? bytecode : bytecode === true ? { enable: true } : undefined

  if (isESM && bytecodeOptions?.enable) {
    throw new Error(
      '`bytecodePlugin` does not support ES module, please remove "type": "module" in package.json',
    )
  }

  const { buildAsarOption, buildVersionOption, entryOutDir } = await resolveUpdaterOption(
    pkg as PKG,
    updater,
  )

  const mainFileName = `${resolveEntryName(main.files)}.${isESM ? 'mjs' : 'js'}`
  log.info(`Using "${mainFileName}" as main file`, { timestamp: true })

  log.info(`Clear cache files`, { timestamp: true })
  await Promise.all(
    [buildAsarOption.rendererDistPath, buildAsarOption.electronDistPath, entryOutDir].map((p) =>
      fs.promises.rm(path.resolve(context.root, p), { recursive: true, force: true }),
    ),
  ).catch(() => {})

  const outputNames = {
    entryFileNames: `[name].${isESM ? 'mjs' : 'js'}`,
    chunkFileNames: `[name].${isESM ? 'mjs' : 'js'}`,
    assetFileNames: '[name].[ext]',
  }
  const define = {
    __EIU_ASAR_BASE_NAME__: JSON.stringify(path.basename(buildAsarOption.asarOutputPath)),
    __EIU_ELECTRON_DIST_PATH__: JSON.stringify(normalizePath(buildAsarOption.electronDistPath)),
    __EIU_ENTRY_DIST_PATH__: JSON.stringify(normalizePath(entryOutDir)),
    __EIU_IS_DEV__: JSON.stringify(context.isDev),
    __EIU_IS_ESM__: JSON.stringify(isESM),
    __EIU_MAIN_FILE__: JSON.stringify(mainFileName),
    __EIU_SIGNATURE_CERT__: JSON.stringify(buildVersionOption.cert),
    __EIU_VERSION_PATH__: JSON.stringify(
      normalizeVersionPath(normalizePath(buildVersionOption.versionPath)),
    ),
  }

  // Build main configuration (same as before)
  const _electronOptions: MultiEnvElectronOptions[] = [
    {
      name: 'main',
      input: main.files,
      onstart: main.onstart,
      notBundle,
      plugins: [
        isESM && esmShim(),
        bytecodeOptions && bytecodePlugin('main', minify, isESM, bytecodeOptions),
      ],
      options: mergeConfig<EnvironmentOptions, EnvironmentOptions>(
        {
          build: {
            sourcemap,
            minify,
            outDir: `${buildAsarOption.electronDistPath}/main`,
            rolldownOptions: {
              external: finalExternal,
              output: {
                format: isESM ? 'es' : 'cjs',
                polyfillRequire: isESM,
                ...outputNames,
              },
            },
          },
          define,
        },
        main.options ?? {},
      ),
    },
  ]

  // Build preload configuration
  if (preload?.files) {
    _electronOptions.push({
      name: 'preload',
      onstart(args) {
        // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete
        args.reload()
      },
      notBundle,
      input: preload.files,
      plugins: [
        isESM && esmShim(),
        bytecodeOptions && bytecodePlugin('preload', minify, isESM, bytecodeOptions),
      ],
      options: mergeConfig<EnvironmentOptions, EnvironmentOptions>(
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
                ...outputNames,
              },
            },
          },
          define,
        },
        preload?.options ?? {},
      ),
    })
  }

  _electronOptions.push({
    name: 'entry',
    input: entry.files,
    async onstart(args) {
      await args.startup()
    },
    notBundle,
    plugins: [
      isESM && esmShim(),
      bytecodeOptions && bytecodePlugin('entry', minify, isESM, bytecodeOptions),
      {
        name: `${id}:entry`,
        async closeBundle() {
          log.info(`Build entry to '${entryOutDir}'`, { timestamp: true })
          await entry.postBuild?.({
            isBuild: !context.isDev,
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

          if (!context.isDev) {
            return
          }

          const buffer = await buildAsar(context.root, buildAsarOption)
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
    options: mergeConfig<EnvironmentOptions, EnvironmentOptions>(
      {
        build: {
          sourcemap,
          minify,
          outDir: entryOutDir,
          rolldownOptions: {
            external: finalExternal,
            output: {
              format: isESM ? 'es' : 'cjs',
              polyfillRequire: isESM,
              ...outputNames,
            },
          },
        },
        define,
      },
      entry.options || {},
    ),
  })

  return _electronOptions
}

/**
 * Base on `vite-plugin-electron/multi-env`
 * - integrate with updater
 * - no `renderer` config
 * - remove old output file
 * - externalize dependencies
 * - auto restart when entry file changes
 *
 * You can override all the environment configs, except output directories (use `options.updater.paths.electronDistPath` instead)
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
 *   }
 * })
 * ```
 */
export async function electronWithUpdater(
  options: ElectronWithUpdaterOptions,
): Promise<Plugin[] | undefined> {
  return electronPluginFactory((context) => {
    process.CACHED_ELECTRON_OPTIONS ??= createElectronOptions(options, context)
    return process.CACHED_ELECTRON_OPTIONS
  })
}
