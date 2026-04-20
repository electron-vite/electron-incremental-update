import type { Promisable } from '@subframe7536/type-utils'

import { defaultSignature } from '../utils/crypto'
import type { UpdateJSON } from '../utils/version'
import { defaultVersionJsonGenerator } from '../utils/version'
import { defaultZipFile } from '../utils/zip'

import type { BytecodeOptions } from './bytecode'
import type { ElectronOptions } from './electron-next'
import type { NotBundleOptions } from './electron-next/plugin'
import type { DistinguishedName } from './utils/key'
import { parseKeys } from './utils/key'

export interface PKG {
  name: string
  version: string
  main: string
  type?: 'commonjs' | 'module'
  dependencies?: Record<string, string>
}

interface CommonBuildOption {
  /**
   * Shortcut of `build.rolldownOptions.input`
   */
  files: NonNullable<ElectronOptions['entry']>
  /**
   * Override vite options
   */
  vite?: ElectronOptions['vite'] & {
    build?: {
      outDir: never
      sourcemap: never
      minify: never
      rolldownOptions?: {
        output?: {
          dir: never
        }
      }
    }
  }
}

export interface ElectronWithUpdaterOptions {
  /**
   * Whether is in build mode
   * ```ts
   * export default defineConfig(({ command }) => {
   *   const isBuild = command === 'build'
   * })
   * ```
   */
  isBuild: boolean
  /**
   * Project root directory. Can be an absolute path, or a path relative from
   * the location of the config file itself.
   * @default process.cwd()
   */
  root?: string
  /**
   * Whether to generate sourcemap
   * @default !isBuild || !!process.env.VSCODE_DEBUG
   */
  sourcemap?: boolean
  /**
   * Whether to minify the code
   * @default isBuild
   */
  minify?: boolean
  /**
   * Whether to generate bytecode
   *
   * **Only support CommonJS**
   *
   * Only main process by default, if you want to use in preload script, please use `electronWithUpdater({ bytecode: { enablePreload: true } })` and set `sandbox: false` when creating window
   */
  bytecode?: boolean | BytecodeOptions
  /**
   * Faster dev startup by externalize all node modules in entry and main.
   *
   * Only works in development (`isBuild === false`).
   * @default true
   */
  notBundle?: boolean | NotBundleOptions
  /**
   * @deprecated use `notBundle` instead
   */
  useNotBundle?: boolean
  /**
   * Whether to generate version json
   * @default isCI
   */
  buildVersionJson?: boolean
  /**
   * Addtional `external` option in `build.rolldownOptions`,
   *
   * If equals `true`,
   * external `dependencies` in `package.json` by default
   */
  external?: (string | RegExp)[] | boolean
  /**
   * Options for entry (app.asar)
   *
   * To change output directories, use `options.updater.paths.electronDistPath` instead
   */
  entry: {
    /**
     * By default, all the unbundled modules will be packaged by packager like `electron-builder`.
     * If setup, all the `dependencies` in `package.json` will be bundled by default, and you need
     * to manually handle the native module files.
     *
     * If you are using `electron-buidler`, don't forget to append `'!node_modules/**'` in
     * electron-build config's `files` array
     */
    postBuild?: (args: {
      /**
       * Whether is in build mode
       */
      isBuild: boolean
      /**
       * Get path from `entryOutputDirPath`
       */
      getPathFromEntryOutputDir: (...paths: string[]) => string
      /**
       * Check exist and copy file to `entryOutputDirPath`
       *
       * If `to` absent, set to `basename(from)`
       *
       * If `skipIfExist` absent, skip copy if `to` exist
       */
      copyToEntryOutputDir: (options: {
        from: string
        to?: string
        /**
         * Skip copy if `to` exist
         * @default true
         */
        skipIfExist?: boolean
      }) => void
      /**
       * Copy specified modules to entry output dir, just like `external` option in rolldown
       */
      copyModules: (options: {
        /**
         * External Modules
         */
        modules: string[]
        /**
         * Skip copy if `to` exist
         * @default true
         */
        skipIfExist?: boolean
      }) => void
    }) => Promisable<void>
  } & CommonBuildOption
  /**
   * Main process options
   *
   * To change output directories, use `options.updater.paths.electronDistPath` instead
   */
  main: {
    /**
     * Electron App startup function.
     *
     * It will mount the Electron App child-process to `process.electronApp`.
     * @param argv default value `['.', '--no-sandbox']`
     * @param options options for `child_process.spawn`
     * @param customElectronPkg custom electron package name (default: 'electron')
     */
    onstart?: ElectronOptions['onstart']
  } & CommonBuildOption
  /**
   * Preload process options
   *
   * To change output directories, use `options.updater.paths.electronDistPath` instead
   */
  preload?: CommonBuildOption
  /**
   * Updater options
   */
  updater?: UpdaterOptions
}

export interface _BuildAsarOption extends Required<
  Pick<
    NonNullable<UpdaterOptions['paths']>,
    'asarOutputPath' | 'electronDistPath' | 'gzipPath' | 'rendererDistPath'
  >
> {
  version: string
  generateGzipFile: NonNullable<GeneratorOverrideFunctions['generateGzipFile']>
}

export interface _BuildVersionOption {
  version: string
  minimumVersion: string
  privateKey: string
  cert: string
  versionPath: string
  generateSignature: NonNullable<GeneratorOverrideFunctions['generateSignature']>
  generateUpdateJson: NonNullable<GeneratorOverrideFunctions['generateUpdateJson']>
}

export interface GeneratorOverrideFunctions {
  /**
   * Custom signature generate function
   * @param buffer file buffer
   * @param privateKey private key
   * @param cert certificate string, **EOL must be `\n`**
   * @param version current version
   */
  generateSignature?: (
    buffer: Buffer,
    privateKey: string,
    cert: string,
    version: string,
  ) => Promisable<string>
  /**
   * Custom generate update json function
   * @param existingJson The existing JSON object.
   * @param buffer file buffer
   * @param signature generated signature
   * @param version current version
   * @param minVersion The minimum version
   */
  generateUpdateJson?: (
    existingJson: UpdateJSON,
    signature: string,
    version: string,
    minVersion: string,
  ) => Promisable<UpdateJSON>
  /**
   * Custom generate zip file buffer
   * @param buffer source buffer
   */
  generateGzipFile?: (buffer: Buffer) => Promisable<Buffer>
}

interface UpdaterOptions {
  /**
   * Minimum version of entry
   * @default '0.0.0'
   */
  minimumVersion?: string
  /**
   * Options for paths
   */
  paths?: {
    /**
     * Path to asar file
     * @default `release/${app.name}.asar`
     */
    asarOutputPath?: string
    /**
     * Path to app entry output file
     * @default 'dist-entry'
     */
    entryOutDir?: string
    /**
     * Path to version info output, content is {@link UpdateJSON}
     * @default `version.json`
     */
    versionPath?: string
    /**
     * Path to gzipped asar file
     * @default `release/${app.name}-${version}.asar.gz`
     */
    gzipPath?: string
    /**
     * Path to electron build output
     * @default `dist-electron`
     */
    electronDistPath?: string
    /**
     * Path to renderer build output
     * @default `dist`
     */
    rendererDistPath?: string
  }
  /**
   * signature config
   */
  keys?: {
    /**
     * Path to the pem file that contains private key
     * If not ended with .pem, it will be appended
     *
     * **If `UPDATER_PK` is set, will read it instead of read from `privateKeyPath`**
     * @default 'keys/private.pem'
     */
    privateKeyPath?: string
    /**
     * Path to the pem file that contains public key
     * If not ended with .pem, it will be appended
     *
     * **If `UPDATER_CERT` is set, will read it instead of read from `certPath`**
     * @default 'keys/cert.pem'
     */
    certPath?: string
    /**
     * Length of the key
     * @default 2048
     */
    keyLength?: number
    /**
     * X509 certificate info
     *
     * Only generate simple **self-signed** certificate **without extensions**
     */
    certInfo?: {
      /**
       * The subject of the certificate
       *
       * @default { commonName: `${app.name}`, organizationName: `org.${app.name}` }
       */
      subject?: DistinguishedName
      /**
       * Expire days of the certificate
       *
       * @default 3650
       */
      days?: number
    }
  }
  overrideGenerator?: GeneratorOverrideFunctions
}

interface ParseOptionReturn {
  buildAsarOption: _BuildAsarOption
  buildVersionOption: _BuildVersionOption
  cert: string
  entryOutDir: string
}

export async function parseUpdaterOption(
  pkg: PKG,
  options: UpdaterOptions = {},
): Promise<ParseOptionReturn> {
  const {
    minimumVersion = '0.0.0',
    paths: {
      asarOutputPath = `release/${pkg.name}.asar`,
      gzipPath = `release/${pkg.name}-${pkg.version}.asar.gz`,
      entryOutDir = 'dist-entry',
      electronDistPath = 'dist-electron',
      rendererDistPath = 'dist',
      versionPath = 'release/version.json',
    } = {},
    keys: {
      privateKeyPath = 'keys/private.pem',
      certPath = 'keys/cert.pem',
      keyLength = 2048,
      certInfo: {
        subject = {
          commonName: pkg.name,
          organizationName: `org.${pkg.name}`,
        },
        days = 3650,
      } = {},
    } = {},
    overrideGenerator: {
      generateGzipFile = defaultZipFile,
      generateSignature = defaultSignature,
      generateUpdateJson = defaultVersionJsonGenerator,
    } = {},
  } = options
  const buildAsarOption: _BuildAsarOption = {
    version: pkg.version,
    asarOutputPath,
    gzipPath,
    electronDistPath,
    rendererDistPath,
    generateGzipFile,
  }
  // generate keys or get from file
  const { privateKey, cert } = await parseKeys({
    keyLength,
    privateKeyPath,
    certPath,
    subject,
    days,
  })
  const buildVersionOption: _BuildVersionOption = {
    version: pkg.version,
    minimumVersion,
    privateKey,
    cert,
    versionPath,
    generateSignature,
    generateUpdateJson,
  }

  return { buildAsarOption, buildVersionOption, cert, entryOutDir }
}
