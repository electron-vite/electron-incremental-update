import type { Logger, UpdaterOption } from './types'
import type { Promisable } from '@subframe7536/type-utils'

import fs from 'node:fs'
import path from 'node:path'

import electron from 'electron'

import { getPathFromAppNameAsar, isDev } from '../utils/electron'
import { Updater } from './updater'

/**
 * type only electron main file path, transformed by vite's define
 */
declare const __EIU_MAIN_FILE__: string
/**
 * type only electron dist path, transformed by vite's define
 */
declare const __EIU_ELECTRON_DIST_PATH__: string
/**
 * type only asar base name, transformed by vite's define
 */
declare const __EIU_ASAR_BASE_NAME__: string
/**
 * type only is esmodule, transformed by vite's define
 */
declare const __EIU_IS_ESM__: string

/**
 * Hooks on rename temp asar path to `${app.name}.asar`
 * @param install `() => renameSync(tempAsarPath, appNameAsarPath)`
 * @param tempAsarPath temp(updated) asar path
 * @param appNameAsarPath `${app.name}.asar` path
 * @param logger logger
 * @default install(); logger.info('update success!')
 */
type OnInstallFunction = (
  install: VoidFunction,
  tempAsarPath: string,
  appNameAsarPath: string,
  logger?: Logger,
) => Promisable<void>

export interface AppOption {
  /**
   * Path to index file that make {@link startupWithUpdater} as default export
   *
   * Generate from plugin configuration by default
   */
  mainPath?: string
  /**
   * Updater options
   */
  updater?: (() => Promisable<Updater>) | UpdaterOption
  /**
   * Hooks on rename temp asar path to `${app.name}.asar`
   */
  onInstall?: OnInstallFunction
  /**
   * Hooks before app startup
   * @param mainFilePath main file path of `${app.name}.asar`
   * @param logger logger
   */
  beforeStart?: (mainFilePath: string, logger?: Logger) => Promisable<void>
  /**
   * Hooks on app startup error
   * @param err installing or startup error
   * @param logger logger
   */
  onStartError?: (err: unknown, logger?: Logger) => void
}

/**
 * Utils to startup with updater
 * @param fn startup function
 * @example
 * // in electron/main/index.ts
 * export default startupWithUpdater((updater) => {
 *   updater.checkUpdate()
 * })
 */
export function startupWithUpdater(
  fn: (updater: Updater) => Promisable<void>,
): (updater: Updater) => Promisable<void> {
  return fn
}

const defaultOnInstall: OnInstallFunction = (install, _, __, logger) => {
  install()
  logger?.info(`update success!`)
}

/**
 * Initialize Electron with updater
 * @example
 * createElectronApp({
 *   updater: {
 *     provider: new GitHubProvider({
 *       username: 'yourname',
 *       repo: 'electron',
 *     }),
 *   },
 *   beforeStart(mainFilePath, logger) {
 *     logger?.debug(mainFilePath)
 *   },
 * })
 */
export async function createElectronApp(
  appOptions: AppOption = {},
): Promise<void> {
  const appNameAsarPath = getPathFromAppNameAsar()

  const {
    mainPath = isDev
      ? path.join(electron.app.getAppPath(), __EIU_ELECTRON_DIST_PATH__, 'main', __EIU_MAIN_FILE__)
      : path.join(path.dirname(electron.app.getAppPath()), __EIU_ASAR_BASE_NAME__, 'main', __EIU_MAIN_FILE__),
    updater,
    onInstall = defaultOnInstall,
    beforeStart,
    onStartError,
  } = appOptions

  const updaterInstance = typeof updater === 'object' || !updater
    ? new Updater(updater)
    : await updater()

  const logger = updaterInstance.logger
  try {
    // do update: replace the old asar with new asar
    const tempAsarPath = `${appNameAsarPath}.tmp`
    if (fs.existsSync(tempAsarPath)) {
      logger?.info(`Installing new asar from ${tempAsarPath}`)
      await onInstall(() => fs.renameSync(tempAsarPath, appNameAsarPath), tempAsarPath, appNameAsarPath, logger)
    }

    // logger.debug(`app.getAppPath(): ${app.getAppPath()}`)
    // logger.debug(`appNameAsar: ${appNameAsarPath}`)
    // logger.debug(`__EIU_MAIN_FILE__: ${__EIU_MAIN_FILE__}`)
    // logger?.debug(`mainFilePath: ${mainPath}`)
    await beforeStart?.(mainPath, logger)

    if (__EIU_IS_ESM__) {
      (await import(`file://${mainPath}`)).default(updaterInstance)
    } else {
      // eslint-disable-next-line ts/no-require-imports
      require(mainPath)(updaterInstance)
    }
  } catch (error) {
    logger?.error('startup error, exit', error)
    onStartError?.(error, logger)
    electron.app.quit()
  }
}

/**
 * @deprecated Use {@link createElectronApp} instead
 */
export const initApp: typeof createElectronApp = createElectronApp
