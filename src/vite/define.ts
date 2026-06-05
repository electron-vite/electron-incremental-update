import type { UserConfig } from 'vite'

import { electronWithUpdater } from './core'
import type { ElectronWithUpdaterOptions } from './types'

export interface ElectronViteHelperOptions extends ElectronWithUpdaterOptions {
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
export function defineElectronConfig(options: ElectronViteHelperOptions): UserConfig {
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
