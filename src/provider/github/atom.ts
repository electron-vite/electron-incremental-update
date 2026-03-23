import { defaultDownloadText } from '../../utils/download'

import { BaseGitHubProvider } from './base'

/**
 * Update Provider for Github repo
 * - check update from `https://github.com/{user}/{repo}/releases.atom`
 * - download update json from `https://github.com/{user}/{repo}/releases/download/v{version}/{versionPath}`
 * - download update asar from `https://github.com/{user}/{repo}/releases/download/v{version}/{name}-{version}.asar.gz`
 *
 * you can setup `urlHandler` in options to modify url before request
 * @param options provider options
 */
export class GitHubAtomProvider extends BaseGitHubProvider {
  public name = 'GithubAtomProvider'

  protected getHeaders(accept: string): Record<string, string> {
    return { Accept: `application/${accept}`, ...this.options.extraHeaders }
  }

  /**
   * @inheritdoc
   */
  protected async getVersionURL(versionPath: string, signal: AbortSignal): Promise<string> {
    const tag = await defaultDownloadText(
      await this.parseURL(`releases.atom`),
      this.getHeaders('xml'),
      signal,
      (data, resolve, reject) => {
        const result = data.match(/<entry>\s*<id>([^<]*\/)?([^/<]+)<\/id>/)?.[2]
        if (result) {
          resolve(result)
        } else {
          reject('No tag matched')
        }
      },
    )
    return `releases/download/v${tag}/${versionPath}`
  }
}
