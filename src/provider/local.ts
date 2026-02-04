import type { Buffer } from 'node:buffer'

import fs from 'node:fs/promises'
import path from 'node:path'

import type { DownloadingInfo, UpdateInfoWithURL, VersionJSON } from './types'

import { isUpdateJSON } from '../utils'
import { BaseProvider } from './base'

export interface LocalDevProviderOptions {
  /**
   * Base directory for update files
   */
  baseDir: string
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
  public name = 'LocalDevProvider'

  constructor(private options: LocalDevProviderOptions) {
    super()
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

    const { beta, version, ...info } = await this.readJSON(
      path.join(this.options.baseDir, versionPath),
    )

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

    if (onDownloading) {
      const size = fileBuffer.length
      onDownloading({
        delta: size,
        percent: 100,
        total: size,
        transferred: size,
        bps: size,
      })
    }

    return fileBuffer
  }

  private async readJSON(versionPath: string) {
    const fullPath = path.join(this.options.baseDir, path.basename(versionPath))
    const content = await fs.readFile(fullPath, 'utf-8')
    const json = JSON.parse(content)
    if (!isUpdateJSON(json)) {
      throw new Error(`Invalid update json: ${content}`)
    }

    return json
  }
}
