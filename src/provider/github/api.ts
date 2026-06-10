import { defaultDownloadText, resolveJson } from '../../utils/download'

import type { BaseGitHubProviderOptions } from './base'
import { BaseGitHubProvider } from './base'

type ReleaseApiResult = {
  tag_name: string
  assets: {
    name: string
    browser_download_url: string
  }[]
}[]
const ERROR_MSG = 'Cannot find UpdateJSON in latest release'

export interface GitHubApiProviderOptions extends BaseGitHubProviderOptions {
  token?: string
}

/**
 * Update Provider for Github API, you need to upload `version.json` to release as well
 * - check update from `https://api.github.com/repos/{user}/{repo}/releases?per_page=1`
 * - download update json and get version and download url
 * - download update asar from update info
 *
 * you can setup `urlHandler` in options to modify url before request
 * @param options provider options
 */
export class GitHubApiProvider extends BaseGitHubProvider<GitHubApiProviderOptions> {
  public override name = 'GithubApiProvider'

  protected getHeaders(accept: string): Record<string, string> {
    return {
      Accept: `application/${accept}`,
      ...(this.options.token ? { Authorization: `token ${this.options.token}` } : {}),
      ...this.options.extraHeaders,
    }
  }

  /**
   * @inheritdoc
   */
  protected async getVersionURL(versionPath: string, signal: AbortSignal): Promise<string> {
    const basename = versionPath.slice(versionPath.lastIndexOf('/') + 1)
    const data = await defaultDownloadText<ReleaseApiResult>(
      await this.parseURL(
        `https://api.github.com/repos/${this.options.user}/${this.options.repo}/releases?per_page=1`,
      ),
      this.getHeaders('vnd.github.v3+json'),
      signal,
      resolveJson,
    )
    const versionAssets = data[0]?.assets.find((asset) => asset.name === basename)
    if (!versionAssets) {
      throw new Error(
        `${ERROR_MSG}, ${'message' in data ? data.message : 'please check the release assets'}`,
      )
    }
    return versionAssets.browser_download_url
  }
}
