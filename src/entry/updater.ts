import { app } from 'electron'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'

import type { DownloadingInfo, IProvider, UpdateInfoWithURL, VersionJSON } from '../provider/types'
import type {
  Logger,
  UpdateInfoWithExtraVersion,
  UpdaterErrorCode,
  UpdaterOption,
  UpdaterUnavailableCode,
} from './types'

import {
  getAppVersion,
  getEntryVersion,
  getPathFromAppNameAsar,
  isDev,
  restartApp,
} from '../utils/electron'
import { isUpdateJSON } from '../utils/version'
import { UpdaterError } from './types'

/**
 * type only signature cert, transformed by vite's define
 */
declare const __EIU_SIGNATURE_CERT__: string
/**
 * type only version json path, transformed by vite's define
 */
declare const __EIU_VERSION_PATH__: string

export class Updater<
  T extends UpdateInfoWithExtraVersion = UpdateInfoWithExtraVersion,
> extends EventEmitter<{
  'update-available': [data: T]
  'update-not-available': [code: UpdaterUnavailableCode, msg: string, info?: T]
  error: [error: UpdaterError]
  'download-progress': [info: DownloadingInfo]
  'update-downloaded': []
  'update-cancelled': []
}> {
  private CERT: string
  private controller: AbortController
  private info?: UpdateInfoWithURL
  private tmpFilePath?: string
  private processing: boolean = false
  public provider?: IProvider
  /**
   * Updater logger
   */
  public logger?: Logger
  /**
   * Whether to receive beta update
   */
  public receiveBeta?: boolean
  /**
   * Whether force update in DEV
   */
  public forceUpdate?: boolean
  /**
   * Initialize incremental updater
   * @param options UpdaterOption
   */
  constructor(options: UpdaterOption = {}) {
    super()
    this.provider = options.provider
    this.receiveBeta = options.receiveBeta
    this.CERT = options.SIGNATURE_CERT || __EIU_SIGNATURE_CERT__
    this.logger = options.logger
    this.controller = new AbortController()

    if (isDev && !this.logger) {
      this.logger = {
        info: (...args) => console.log('[EIU-INFO ]', ...args),
        debug: (...args) => console.log('[EIU-DEBUG]', ...args),
        warn: (...args) => console.log('[EIU-WARN ]', ...args),
        error: (...args) => console.error('[EIU-ERROR]', ...args),
      }
      this.logger.info('No logger set, enable dev-only logger')
    }
  }

  /**
   * This function is used to parse download data.
   *
   * if data is absent, download URL from provider and return it,
   * else if data is `UpdateJSON`, return it
   */
  private async fetch(format: 'json', data?: VersionJSON): Promise<VersionJSON | undefined>
  /**
   * This function is used to parse download data.
   *
   * if data is absent, download URL from provider and return it,
   * else if data is `Buffer`, return it
   * @param format 'json' or 'buffer'
   * @param data download URL or update json or buffer
   */
  private async fetch(format: 'buffer', data?: Buffer): Promise<Buffer | undefined>
  private async fetch(format: 'json' | 'buffer', data?: Buffer | VersionJSON): Promise<any> {
    if (typeof data === 'object') {
      if (
        (format === 'json' && isUpdateJSON(data)) ||
        (format === 'buffer' && Buffer.isBuffer(data))
      ) {
        return data
      } else {
        this.err(
          'Invalid type',
          'ERR_PARAM',
          `Invalid type at format '${format}': ${JSON.stringify(data)}`,
        )
        return
      }
    }

    // fetch data from remote
    this.logger?.debug(`Download from \`${this.provider!.name}\``)
    try {
      const result =
        format === 'json'
          ? await this.provider!.downloadJSON(
              app.name,
              __EIU_VERSION_PATH__,
              this.controller.signal,
            )
          : await this.provider!.downloadAsar(this.info!, this.controller.signal, (info) =>
              this.emit('download-progress', info),
            )

      this.logger?.debug(
        `Download ${format} success${format === 'buffer' ? `, file size: ${(result as Buffer).length}` : ''}`,
      )

      return result
    } catch (e) {
      this.err(
        `Fetch ${format} failed`,
        'ERR_NETWORK',
        e instanceof Error ? e.message : (e as any).toString(),
      )
    }
  }

  private cleanup(): void {
    if (this.tmpFilePath && fs.existsSync(this.tmpFilePath)) {
      try {
        fs.unlinkSync(this.tmpFilePath)
        this.tmpFilePath = undefined
        this.logger?.debug('Cleaned up temporary update file')
      } catch (error) {
        this.logger?.warn(`Failed to clean up temporary update file: ${error}`)
      }
    }
  }

  /**
   * Handle error message and emit error event
   */
  private err(msg: string, code: UpdaterErrorCode, errorInfo: string): void {
    const err = new UpdaterError(code, errorInfo)
    this.logger?.error(`[${code}] ${msg}`, err)
    this.cleanup()
    this.emit('error', err)
  }

  /**
   * Check update info using default options
   */
  public async checkForUpdates(): Promise<boolean> {
    const emitUnavailable = (msg: string, code: UpdaterUnavailableCode, info?: T): false => {
      this.logger?.info(`[${code}] ${msg}`)
      this.logger?.debug('Check update end')
      this.processing = false
      this.emit('update-not-available', code, msg, info)
      return false
    }

    if (!this.provider) {
      const msg = 'No update json or provider'
      this.err('Check update failed', 'ERR_PARAM', msg)
      return emitUnavailable(msg, 'UNAVAILABLE_ERROR')
    }

    if (this.processing) {
      this.logger?.info('Updater is already processing, skip check update')
      return false
    }
    this.processing = true
    this.logger?.debug('Check update start')

    const _data = await this.fetch('json')
    if (!_data) {
      return emitUnavailable('Failed to get update info', 'UNAVAILABLE_ERROR')
    }
    const { signature, version, minimumVersion, url, ...rest } = this.receiveBeta
      ? _data.beta
      : _data
    const info = { signature, minimumVersion, version, url }
    const extraVersionInfo = {
      signature,
      minimumVersion,
      version,
      appVersion: getAppVersion(),
      entryVersion: getEntryVersion(),
      ...rest,
    } as T
    this.logger?.debug(`Checked update, version: ${version}, signature: ${signature}`)

    if (isDev && !this.forceUpdate) {
      return emitUnavailable(
        'Skip check update in dev mode. To force update, set `updater.forceUpdate` to `true`',
        'UNAVAILABLE_DEV',
      )
    }
    const isLowerVersion = this.provider!.isLowerVersion
    try {
      if (isLowerVersion(extraVersionInfo.entryVersion, minimumVersion)) {
        return emitUnavailable(
          `Entry Version (${extraVersionInfo.entryVersion}) < MinimumVersion (${minimumVersion})`,
          'UNAVAILABLE_VERSION',
          extraVersionInfo,
        )
      }

      this.logger?.info(
        `Current version is ${extraVersionInfo.appVersion}, new version is ${version}`,
      )

      if (!isLowerVersion(extraVersionInfo.appVersion, version)) {
        return emitUnavailable(
          `Current version (${extraVersionInfo.appVersion}) > New version (${version})`,
          'UNAVAILABLE_VERSION',
          extraVersionInfo,
        )
      }
      this.logger?.info(`Update available: ${version}`)
      this.info = info
      this.processing = false
      this.logger?.debug('Check update end')
      this.emit('update-available', extraVersionInfo)
      return true
    } catch {
      const msg = 'Fail to parse version string'
      this.err('Check update failed', 'ERR_VALIDATE', msg)
      return emitUnavailable(msg, 'UNAVAILABLE_ERROR', extraVersionInfo)
    }
  }

  /**
   * Download update using default options
   */
  public async downloadUpdate(): Promise<boolean> {
    const emitError = (code: UpdaterErrorCode, errorInfo: string): false => {
      this.err(`Download update failed`, code, errorInfo)
      this.logger?.debug('Download update end')
      this.processing = false
      return false
    }

    if (!this.provider) {
      return emitError('ERR_PARAM', 'No update asar buffer and provider')
    }

    if (this.processing) {
      this.logger?.info('Updater is already processing, skip download update')
      return false
    }
    this.processing = true
    this.logger?.debug('Download update start')

    const _sig = this.info?.signature
    const _version = this.info?.version

    if (!_sig || !_version) {
      return emitError('ERR_PARAM', 'No update signature, please call `checkUpdate` first')
    }

    const buffer = await this.fetch('buffer')

    if (!buffer) {
      return emitError('ERR_PARAM', 'No update asar file buffer')
    }

    // verify update file
    this.logger?.debug('Validation start')
    if (!(await this.provider!.verifySignaure(buffer, _version, _sig, this.CERT))) {
      return emitError('ERR_VALIDATE', 'Invalid update asar file')
    }
    this.logger?.debug('Validation end')

    try {
      this.tmpFilePath = `${getPathFromAppNameAsar()}.tmp`
      // write file to tmp path
      this.logger?.debug(`Install to ${this.tmpFilePath}`)
      fs.writeFileSync(this.tmpFilePath, await this.provider!.unzipFile(buffer))

      this.logger?.info(`Download success, version: ${_version}`)
      this.info = undefined
      this.emit('update-downloaded')
      this.processing = false
      this.logger?.debug('Download update end')
      return true
    } catch (error) {
      this.cleanup()
      return emitError(
        'ERR_DOWNLOAD',
        `Failed to write update file: ${error instanceof Error ? error.message : error}`,
      )
    }
  }

  /**
   * quit App and install
   */
  public quitAndInstall(): void {
    this.logger?.info('Quit and install')
    restartApp()
  }

  public cancel(): void {
    if (this.controller.signal.aborted) {
      return
    }
    this.controller.abort()
    this.cleanup()
    this.logger?.info('Cancel update')
    this.emit('update-cancelled')
    this.controller = new AbortController()
  }
}

/**
 * Auto check update, download and install
 */
export async function autoUpdate(updater: Updater): Promise<void> {
  if ((await updater.checkForUpdates()) && (await updater.downloadUpdate())) {
    updater.quitAndInstall()
  }
}
