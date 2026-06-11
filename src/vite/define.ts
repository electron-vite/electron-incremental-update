import type { UserConfig } from 'vite'

import { electronWithUpdater } from './core'
import type { ElectronWithUpdaterOptions } from './types'

export interface ElectronViteHelperOptions extends ElectronWithUpdaterOptions {
  /**
   * Root dir of project
   * @default process.cwd()
   */
  root?: string
  /**
   * Config for renderer process
   */
  renderer?: Omit<UserConfig, 'root'>
}

/**
 * Vite config helper
 * @see {@link electronWithUpdater}
 * @example
 * ```ts
 * import { defineElectronConfig } from 'electron-incremental-update/vite'
 *
 * export default defineElectronConfig({
 *   // root: './apps'
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
 *     // plugins: []
 *   }
 * })
 * ```
 */
export function defineElectronConfig(options: ElectronViteHelperOptions): UserConfig {
  const electronPlugin = electronWithUpdater(options as ElectronWithUpdaterOptions)
  const result = options.renderer ?? {}
  result.plugins ??= []
  result.plugins.push(electronPlugin)
  ;(result as UserConfig).root = options.root
  const rendererDistPath = options.updater?.paths?.rendererDistPath
  if (rendererDistPath) {
    result.build ??= {}
    result.build.outDir = rendererDistPath
  }
  return result
}
