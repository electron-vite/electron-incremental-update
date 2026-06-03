import fs from 'node:fs'
import path from 'node:path'

import { isCI } from 'ci-info'
import type { EnvironmentOptions, PluginOption } from 'vite'
import { mergeConfig } from 'vite'
import electron from 'vite-plugin-electron/multi-env'
import type { MultiEnvElectronOptions } from 'vite-plugin-electron/multi-env'
import { notBundle, esmShim } from 'vite-plugin-electron/plugin'

import { bytecodePlugin } from './bytecode'
import { id, log } from './constant'
import { resolveOptions } from './option'
import type { ElectronWithUpdaterOptions } from './types'
import { buildAsar, buildUpdateJson } from './utils/build'
import { copyAndSkipIfExist } from './utils/file'

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
 *   }
 * })
 * ```
 */
export async function electronWithUpdater(
  options: ElectronWithUpdaterOptions,
): Promise<PluginOption[] | undefined> {
  const {
    isBuild,
    root,
    entry,
    main,
    preload,
    sourcemap,
    minify,
    buildVersionJson,
    notBundleOption,
    isESM,
    finalExternal,
    bytecodeOptions,
    buildAsarOption,
    buildVersionOption,
    entryOutDir,
    outputNames,
    define,
  } = await resolveOptions(options)

  // Build main configuration (same as before)
  const _electronOptions: MultiEnvElectronOptions[] = [
    {
      name: 'main',
      input: main.files,
      onstart: main.onstart,
      plugins: [
        isESM && esmShim(),
        notBundleOption &&
          notBundle(typeof notBundleOption === 'object' ? notBundleOption : undefined),
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
      input: preload.files,
      plugins: [
        isESM && esmShim(),
        notBundleOption &&
          notBundle(typeof notBundleOption === 'object' ? notBundleOption : undefined),
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
    plugins: [
      isESM && esmShim(),
      bytecodeOptions && bytecodePlugin('entry', minify, isESM, bytecodeOptions),
      notBundleOption &&
        notBundle(typeof notBundleOption === 'object' ? notBundleOption : undefined),
      {
        name: `${id}:entry`,
        async closeBundle() {
          log.info(`Build entry to '${entryOutDir}'`, { timestamp: true })
          await entry.postBuild?.({
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

          const buffer = await buildAsar(root, buildAsarOption)
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

  return electron(_electronOptions)
}
