import type { Plugin } from 'vite'

export interface NotBundleOptions {
  filter?: (id: string, importer: string) => void | boolean
}

/**
 * @see https://github.com/vitejs/vite/blob/v4.4.7/packages/vite/src/node/utils.ts#L140
 */
export const bareImportRE: RegExp = /^(?![a-zA-Z]:)[\w@](?!.*:\/\/)/

/**
 * During dev, we exclude the `cjs` npm-pkg from bundle, mush like Vite :)
 */
export function notBundle(options: NotBundleOptions = {}): Plugin {
  const cache = new Set<string>()

  return {
    name: 'vite-plugin-electron:not-bundle',
    // Run before the builtin plugin 'vite:resolve'
    enforce: 'pre',
    apply: 'serve',

    resolveId: {
      filter: { id: bareImportRE },
      order: 'pre',
      async handler(source, importer) {
        if (!importer || cache.has(source)) {
          return cache.has(source) ? { id: source, external: true } : null
        }

        if (options.filter?.(source, importer)) {
          return
        }

        const resolved = await this.resolve(source, importer, { skipSelf: true })
        if (!resolved?.id?.includes('/node_modules/')) {
          return
        }

        cache.add(source)
        return {
          id: source,
          external: true,
          moduleSideEffects: false,
        }
      },
    },
  }
}
