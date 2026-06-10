import type { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'

import { isUpdateJSON } from '../utils/version'

import { BaseProvider } from './base'
import type { DownloadingInfo, IProvider, UpdateInfoWithURL, VersionJSON } from './types'

export interface LocalDevProviderOptions {
  /**
   * Base directory for update files
   */
  baseDir: string
  /**
   * Local read chunk size for simulated download progress
   * @default 64 * 1024
   */
  chunkSize?: number
  /**
   * Delay between chunks in milliseconds
   * @default 30
   */
  chunkDelay?: number
}

/**
 * Update Provider for local development
 * - download update json from `{baseDir}/{versionPath}`
 * - download update asar from `{baseDir}/{name}-{version}.asar.gz`
 *
 * This provider is useful for testing updates during development without
 * needing to deploy to a remote server.
 * @param options provider options
 */
export class LocalDevProvider extends BaseProvider {
  public override name = 'LocalDevProvider'
  public override verifySignaure: IProvider['verifySignaure']
  private readonly options: Required<LocalDevProviderOptions>

  constructor(options: LocalDevProviderOptions) {
    super()
    const resolvedOptions = {
      chunkSize: 64 * 1024,
      chunkDelay: 30,
      ...options,
    }
    if (resolvedOptions.chunkSize <= 0) {
      throw new Error('localDevUpdate.chunkSize must be greater than 0')
    }
    if (resolvedOptions.chunkDelay < 0) {
      throw new Error('localDevUpdate.chunkDelay must be greater than or equal to 0')
    }

    this.options = resolvedOptions
    this.verifySignaure = async function verifySignaure(): Promise<boolean> {
      return true
    }
  }

  /**
   * @inheritdoc
   */
  public async downloadJSON(
    name: string,
    versionPath: string,
    signal: AbortSignal,
  ): Promise<VersionJSON> {
    signal.throwIfAborted()

    const { beta, version, ...info } = await this.readJSON(versionPath)

    const getURL = (ver: string): string =>
      path.join(this.options.baseDir, `${name}-${ver}.asar.gz`)

    return {
      ...info,
      version,
      url: getURL(version),
      beta: {
        ...beta,
        url: getURL(beta.version),
      },
    }
  }

  /**
   * @inheritdoc
   */
  public async downloadAsar(
    info: UpdateInfoWithURL,
    signal: AbortSignal,
    onDownloading?: (info: DownloadingInfo) => void,
  ): Promise<Buffer> {
    signal.throwIfAborted()

    const fileBuffer = await fs.readFile(info.url)
    await this.emitProgress(fileBuffer, signal, onDownloading)
    return fileBuffer
  }

  private async readJSON(versionPath: string) {
    const fullPath = path.join(this.options.baseDir, versionPath)
    const content = await fs.readFile(fullPath, 'utf-8')
    const json = JSON.parse(content)
    if (!isUpdateJSON(json)) {
      throw new Error(`Invalid update json: ${content}`)
    }

    return json
  }

  private async emitProgress(
    fileBuffer: Buffer,
    signal: AbortSignal,
    onDownloading?: (info: DownloadingInfo) => void,
  ): Promise<void> {
    if (!onDownloading) {
      return
    }

    const total = fileBuffer.length
    let transferred = 0
    let lastTime = Date.now()

    while (transferred < total) {
      signal.throwIfAborted()

      const currentTime = Date.now()
      const delta = Math.min(this.options.chunkSize, total - transferred)
      transferred += delta
      onDownloading({
        delta,
        percent: Math.round((transferred / total) * 100),
        total,
        transferred,
        bps: Math.round((delta / Math.max(currentTime - lastTime, 1)) * 1000),
      })
      lastTime = currentTime

      if (transferred < total && this.options.chunkDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.options.chunkDelay))
      }
    }
  }
}
