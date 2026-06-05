import type { RolldownOrRollupOptions } from 'vite-plugin-electron'
import type { MultiEnvElectronOptions } from 'vite-plugin-electron/multi-env'

import type { Promisable } from '../utils/type'
import type { UpdateJSON } from '../utils/version'

import type { BytecodeOptions } from './bytecode'
import type { DistinguishedName } from './utils/key'

export interface PKG {
  name: string
  version: string
  main: string
  type?: 'commonjs' | 'module'
  dependencies?: Record<string, string>
}

export interface CommonBuildOption {
  /**
   * Shortcut of `build.rolldownOptions.input`
   */
  files: NonNullable<MultiEnvElectronOptions['input']>
  /**
   * Override vite options
   */
  options?: MultiEnvElectronOptions['options'] & {
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
  notBundle?: boolean | RolldownOrRollupOptions['external']
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
    onstart?: MultiEnvElectronOptions['onstart']
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

export interface UpdaterOptions {
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
     * @default `release/version.json`
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

export interface BuildAsarOptions extends Required<
  Pick<
    NonNullable<UpdaterOptions['paths']>,
    'asarOutputPath' | 'electronDistPath' | 'gzipPath' | 'rendererDistPath'
  >
> {
  version: string
  generateGzipFile: NonNullable<GeneratorOverrideFunctions['generateGzipFile']>
}

export interface BuildVersionOptions {
  version: string
  minimumVersion: string
  privateKey: string
  cert: string
  versionPath: string
  generateSignature: NonNullable<GeneratorOverrideFunctions['generateSignature']>
  generateUpdateJson: NonNullable<GeneratorOverrideFunctions['generateUpdateJson']>
}
