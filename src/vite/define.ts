import type { ElectronWithUpdaterOptions } from './option'
import type { UserConfig, UserConfigFn } from 'vite'

import { electronWithUpdater } from './core'

type MakeOptional<T, K extends keyof T> = Partial<Pick<T, K>> & Omit<T, K>

export interface ElectronViteHelperOptions extends MakeOptional<ElectronWithUpdaterOptions, 'isBuild'> {
  /**
   * Config for renderer process
   */
  renderer?: UserConfig
}

/**
 * Vite config helper
 * @see {@link electronWithUpdater}
 * @example
 * ```ts
 * import { defineElectronConfig } from 'electron-incremental-update/vite'
 *
 * export default defineElectronConfig({
 *   main: {
 *     files: ['./electron/main/index.ts', './electron/main/worker.ts'],
 *     // see https://github.com/electron-vite/electron-vite-vue/blob/85ed267c4851bf59f32888d766c0071661d4b94c/vite.config.ts#L22-L28
 *     onstart: debugStartup,
 *   },
 *   preload: {
 *     files: './electron/preload/index.ts',
 *   },
 *   updater: {
 *     // options
 *   },
 *   renderer: {
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
export function defineElectronConfig(
  options: ElectronViteHelperOptions,
): UserConfigFn {
  return ({ command }) => {
    options.isBuild ??= command === 'build'
    const electronPlugin = electronWithUpdater(options as ElectronWithUpdaterOptions)
    const result = options.renderer ?? {}
    result.plugins ??= []
    result.plugins.push(electronPlugin)
    const rendererDistPath = options.updater?.paths?.rendererDistPath
    if (rendererDistPath) {
      result.build ??= {}
      result.build.outDir = rendererDistPath
    }
    return result
  }
}
