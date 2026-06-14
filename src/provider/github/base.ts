import { URL } from 'node:url'

import { defaultDownloadAsar, defaultDownloadUpdateJSON } from '../../utils/download'
import type { Promisable } from '../../utils/type'
import { BaseProvider } from '../base'
import type { DownloadingInfo, UpdateInfoWithURL, VersionJSON, URLHandler } from '../types'

export interface BaseGitHubProviderOptions {
  /**
   * Github user name
   */
  user: string
  /**
   * Github repo name
   */
  repo: string
  /**
   * Extra headers
   */
  extraHeaders?: Record<string, string>
  /**
   * Custom url handler ([some public CDN links](https://github.com/XIU2/UserScript/blob/master/GithubEnhanced-High-Speed-Download.user.js#L40)). See {@link URLHandler} for details.
   */
  urlHandler?: URLHandler
}

export abstract class BaseGitHubProvider<
  T extends BaseGitHubProviderOptions = BaseGitHubProviderOptions,
> extends BaseProvider {
  constructor(protected options: T) {
    super()
  }

  get urlHandler(): URLHandler | undefined {
    return this.options.urlHandler
  }

  set urlHandler(handler: URLHandler) {
    this.options.urlHandler = handler
  }

  protected async parseURL(pathOrURL: string): Promise<string> {
    const url = URL.canParse(pathOrURL)
      ? new URL(pathOrURL)
      : new URL(`/${this.options.user}/${this.options.repo}/${pathOrURL}`, 'https://github.com')
    return ((await this.urlHandler?.(url)) || url).toString()
  }

  protected abstract getHeaders(accept: string): Record<string, string>

  protected abstract getVersionURL(versionPath: string, signal: AbortSignal): Promisable<string>

  public async downloadJSON(
    name: string,
    versionPath: string,
    signal: AbortSignal,
  ): Promise<VersionJSON> {
    const { beta, version, ...info } = await defaultDownloadUpdateJSON(
      await this.parseURL(await this.getVersionURL(versionPath, signal)),
      this.getHeaders('json'),
      signal,
    )
    const getURL = (ver: string): Promise<string> =>
      this.parseURL(`releases/download/v${ver}/${name}-${ver}.asar.br`)

    return {
      ...info,
      version,
      url: await getURL(version),
      beta: {
        ...beta,
        url: await getURL(beta.version),
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
    return await defaultDownloadAsar(
      info.url,
      this.getHeaders('octet-stream'),
      signal,
      onDownloading,
    )
  }
}
