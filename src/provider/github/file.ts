import type { BaseGitHubProviderOptions } from './base'
import { BaseGitHubProvider } from './base'

export interface GitHubProviderOptions extends BaseGitHubProviderOptions {
  /**
   * Github branch name that fetch version
   * @default 'HEAD'
   */
  branch?: string
}

/**
 * Update Provider for Github repo
 * - download update json from `https://github.com/{user}/{repo}/raw/HEAD/{versionPath}`
 * - download update asar from `https://github.com/{user}/{repo}/releases/download/v{version}/{name}-{version}.asar.gz`
 *
 * you can setup `urlHandler` in options to modify url before request
 * @param options provider options
 */
export class GitHubProvider extends BaseGitHubProvider<GitHubProviderOptions> {
  public override name = 'GithubProvider'
  constructor(options: GitHubProviderOptions) {
    super(options)
    if (!options.branch) {
      this.options.branch = 'HEAD'
    }
  }

  protected getHeaders(accept: string): Record<string, string> {
    return { Accept: `application/${accept}`, ...this.options.extraHeaders }
  }

  protected getVersionURL(versionPath: string): string {
    return `raw/${this.options.branch}/${versionPath}`
  }
}
