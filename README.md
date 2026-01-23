## Electron Incremental Update

This project is built on top of [vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron), offers a lightweight update solution for Electron applications without using native executables.

### Key Features

The solution includes a Vite plugin, a startup entry function, an `Updater` class, and a set of utilities for Electron.

It use 2 asar file structure for updates:

- `app.asar`: The application entry, loads the `${electron.app.name}.asar` and initializes the updater on startup
- `${electron.app.name}.asar`: The package that contains main / preload / renderer process code

### Update Steps

1. Check update from remote server
2. If update available, download the update asar, verify by presigned RSA + Signature and write to disk
3. Quit and restart the app
4. Replace the old `${electron.app.name}.asar` on startup and load the new one

### Other Features

- Update size reduction: All **native modules** should be packaged into `app.asar` to reduce `${electron.app.name}.asar` file size, [see usage](#use-native-modules)
- Bytecode protection: Use V8 cache to protect source code, [see details](#bytecode-protection)

## Getting Started

### Install

```sh
npm install -D electron-incremental-update
```

```sh
yarn add -D electron-incremental-update
```

```sh
pnpm add -D electron-incremental-update
```

### Project Structure

Base on [electron-vite-vue](https://github.com/electron-vite/electron-vite-vue)

```
electron
├── entry.ts // <- entry file
├── main
│   └── index.ts
├── preload
│   └── index.ts
└── native // <- possible native modules
    └── index.ts
src
└── ...
```

### Setup Entry

The entry is used to load the application and initialize the `Updater`

`Updater` use the `provider` to check and download the update. The built-in `GithubProvider` is based on `BaseProvider`, which implements the `IProvider` interface (see [types](#provider)). And the `provider` is optional, you can setup later

in `electron/entry.ts`

```ts
import { createElectronApp } from 'electron-incremental-update'
import { GitHubProvider } from 'electron-incremental-update/provider'

createElectronApp({
  updater: {
    // optinal, you can setup later
    provider: new GitHubProvider({
      username: 'yourname',
      repo: 'electron',
    }),
  },
  beforeStart(mainFilePath, logger) {
    logger?.debug(mainFilePath)
  },
})
```

- [some Github CDN resources](https://github.com/XIU2/UserScript/blob/master/GithubEnhanced-High-Speed-Download.user.js#L34)

### Setup `vite.config.ts`

The plugin config, `main` and `preload` parts are reference from [electron-vite-vue](https://github.com/electron-vite/electron-vite-vue)

- certificate will read from `process.env.UPDATER_CERT` first, if absend, read config
- privatekey will read from `process.env.UPDATER_PK` first, if absend, read config

See all config in [types](#plugin)

in `vite.config.mts`

```ts
import { debugStartup, electronWithUpdater } from 'electron-incremental-update/vite'
import { defineConfig } from 'vite'

export default defineConfig(async ({ command }) => {
  const isBuild = command === 'build'
  return {
    plugins: [
      electronWithUpdater({
        isBuild,
        main: {
          files: ['./electron/main/index.ts', './electron/main/worker.ts'],
          // see https://github.com/electron-vite/electron-vite-vue/blob/85ed267c4851bf59f32888d766c0071661d4b94c/vite.config.ts#L22-L28
          onstart: debugStartup,
        },
        preload: {
          files: './electron/preload/index.ts',
        },
        updater: {
          // options
        },
      }),
    ],
    server:
      process.env.VSCODE_DEBUG &&
      (() => {
        const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL)
        return {
          host: url.hostname,
          port: +url.port,
        }
      })(),
  }
})
```

Or use the helper function

```ts
import { defineElectronConfig } from 'electron-incremental-update/vite'

export default defineElectronConfig({
  main: {
    files: ['./electron/main/index.ts', './electron/main/worker.ts'],
    // see https://github.com/electron-vite/electron-vite-vue/blob/85ed267c4851bf59f32888d766c0071661d4b94c/vite.config.ts#L22-L28
    onstart: debugStartup,
  },
  preload: {
    files: './electron/preload/index.ts',
  },
  updater: {
    // options
  },
  renderer: {
    server:
      process.env.VSCODE_DEBUG &&
      (() => {
        const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL)
        return {
          host: url.hostname,
          port: +url.port,
        }
      })(),
  },
})
```

### Modify package.json

```json
{
  "main": "dist-entry/entry.js" // <- entry file path
}
```

### Config `electron-builder`

```js
const { name } = require('./package.json')

const targetFile = `${name}.asar`
/**
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
  appId: 'YourAppID',
  productName: name,
  files: [
    // entry files
    'dist-entry',
  ],
  npmRebuild: false,
  asarUnpack: ['**/*.{node,dll,dylib,so}'],
  directories: {
    output: 'release',
  },
  extraResources: [
    { from: `release/${targetFile}`, to: targetFile }, // <- asar file
  ],
  // disable publish
  publish: null,
}
```

## Usage

### Use In Main Process

In most cases, you should also setup the `UpdateProvider` before updating, unless you setup params when calling `checkUpdate` or `downloadUpdate`.

The update steps are similar to [electron-updater](https://github.com/electron-userland/electron-updater) and have same methods and events on `Updater`

**NOTE: There should only one function and should be default export in the main index file**

in `electron/main/index.ts`

```ts
import { app } from 'electron'
import { startupWithUpdater, UpdaterError } from 'electron-incremental-update'
import { getPathFromAppNameAsar, getVersions } from 'electron-incremental-update/utils'

export default startupWithUpdater((updater) => {
  await app.whenReady()

  console.table({
    [`${app.name}.asar path:`]: getPathFromAppNameAsar(),
    'app version:': getAppVersion(),
    'entry (installer) version:': getEntryVersion(),
    'electron version:': process.versions.electron,
  })

  updater.onDownloading = ({ percent }) => {
    console.log(percent)
  }

  updater.on('update-available', async ({ version }) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download', 'Later'],
      message: `v${version} update available!`,
    })
    if (response !== 0) {
      return
    }
    await updater.downloadUpdate()
  })

  updater.on('update-not-available', (code, reason, info) => console.log(code, reason, info))

  updater.on('download-progress', (data) => {
    console.log(data)
    main.send(BrowserWindow.getAllWindows()[0], 'msg', data)
  })

  updater.on('update-downloaded', () => {
    updater.quitAndInstall()
  })

  updater.checkForUpdates()
})
```

#### Dynamicly setup `UpdateProvider`

```ts
updater.provider = new GitHubProvider({
  user: 'yourname',
  repo: 'electron',
  // setup url handler
  urlHandler: (url) => {
    url.hostname = 'mirror.ghproxy.com'
    url.pathname = `https://github.com${url.pathname}`
    return url
  },
})
```

#### Custom logger

```ts
updater.logger = console
```

#### Setup Beta Channel

```ts
updater.receiveBeta = true
```

### Use Native Modules

To reduce production size, it is recommended that all the **native modules** should be set as `dependency` in `package.json` and other packages should be set as `devDependencies`. Also, `electron-rebuild` only check dependencies inside `dependency` field.

If you are using `electron-builder` to build distributions, all the native modules with its **large relavent `node_modiles`** will be packaged into `app.asar` by default.

Luckily, `vite` can bundle all the dependencies. Just follow the steps:

1. setup `nativeModuleEntryMap` option
2. Manually copy the native binaries in `postBuild` callback
3. Exclude all the dependencies in `electron-builder`'s config
4. call the native functions with `requireNative` / `importNative` in your code

#### Example

in `vite.config.ts`

```ts
const plugin = electronWithUpdater({
  // options...
  updater: {
    entry: {
      nativeModuleEntryMap: {
        db: './electron/native/db.ts',
        img: './electron/native/img.ts',
      },
      postBuild: ({ copyToEntryOutputDir, copyModules }) => {
        // for better-sqlite3
        copyToEntryOutputDir({
          from: './node_modules/better-sqlite3/build/Release/better_sqlite3.node',
          skipIfExist: false,
        })
        // for @napi-rs/image
        const startStr = '@napi-rs+image-'
        const fileName = readdirSync('./node_modules/.pnpm').find((p) => p.startsWith(startStr))!
        const archName = fileName.substring(startStr.length).split('@')[0]
        copyToEntryOutputDir({
          from: `./node_modules/.pnpm/${fileName}/node_modules/@napi-rs/image-${archName}/image.${archName}.node`,
        })
        // or just copy specific dependency
        copyModules({ modules: ['better-sqlite3'] })
      },
    },
  },
})
```

in `electron/native/db.ts`

```ts
import Database from 'better-sqlite3'
import { getPathFromEntryAsar } from 'electron-incremental-update/utils'

const db = new Database(':memory:', {
  nativeBinding: getPathFromEntryAsar('./better_sqlite3.node'),
})

export function test(): void {
  db.exec(
    'DROP TABLE IF EXISTS employees; ' +
      'CREATE TABLE IF NOT EXISTS employees (name TEXT, salary INTEGER)',
  )

  db.prepare('INSERT INTO employees VALUES (:n, :s)').run({
    n: 'James',
    s: 5000,
  })

  const r = db.prepare('SELECT * from employees').all()
  console.log(r)
  // [ { name: 'James', salary: 50000 } ]

  db.close()
}
```

in `electron/main/service.ts`

```ts
import { importNative, requireNative } from 'electron-incremental-update/utils'

// commonjs
requireNative<typeof import('../native/db')>('db').test()

// esm
importNative<typeof import('../native/db')>('db').test()
```

in `electron-builder.config.js`

```js
module.exports = {
  files: [
    'dist-entry',
    // exclude all dependencies in electron-builder config
    '!node_modules/**',
  ],
}
```

#### Result in app.asar

Before: Redundant 🤮

```
.
├── dist-entry
│   ├── chunk-IVHNGRZY-BPUeB0jT.js
│   ├── db.js
│   ├── entry.js
│   └── image.js
├── node_modules
│   ├── @napi-rs
│   ├── base64-js
│   ├── better-sqlite3
│   ├── bindings
│   ├── bl
│   ├── buffer
│   ├── chownr
│   ├── decompress-response
│   ├── deep-extend
│   ├── detect-libc
│   ├── end-of-stream
│   ├── expand-template
│   ├── file-uri-to-path
│   ├── fs-constants
│   ├── github-from-package
│   ├── ieee754
│   ├── inherits
│   ├── ini
│   ├── mimic-response
│   ├── minimist
│   ├── mkdirp-classic
│   ├── napi-build-utils
│   ├── node-abi
│   ├── once
│   ├── prebuild-install
│   ├── pump
│   ├── rc
│   ├── readable-stream
│   ├── safe-buffer
│   ├── semver
│   ├── simple-concat
│   ├── simple-get
│   ├── string_decoder
│   ├── strip-json-comments
│   ├── tar-fs
│   ├── tar-stream
│   ├── tunnel-agent
│   ├── util-deprecate
│   └── wrappy
└── package.json
```

After: Clean 😍

```
.
├── dist-entry
│   ├── better_sqlite3.node
│   ├── chunk-IVHNGRZY-BPUeB0jT.js
│   ├── db.js
│   ├── entry.js
│   ├── image.js
│   └── image.win32-x64-msvc.node
└── package.json
```

### Bytecode Protection

Use V8 cache to protect the source code

```ts
electronWithUpdater({
  // ...
  bytecode: true, // or options
})
```

#### Benifits

https://electron-vite.org/guide/source-code-protection

- Improve the string protection (see [original issue](https://github.com/alex8088/electron-vite/issues/552))
- Protect all strings by default
- Minification is allowed

#### Limitation

- Only support commonjs
- Only for main process by default, if you want to use in preload script, please use `electronWithUpdater({ bytecode: { enablePreload: true } })` and set `sandbox: false` when creating window

### Utils

```ts
/**
 * Compile time dev check
 */
const isDev: boolean
const isWin: boolean
const isMac: boolean
const isLinux: boolean
/**
 * Get joined path of `${electron.app.name}.asar` (not `app.asar`)
 *
 * If is in dev, **always** return `'DEV.asar'`
 */
function getPathFromAppNameAsar(...paths: string[]): string
/**
 * Get app version, if is in dev, return `getEntryVersion()`
 */
function getAppVersion(): string
/**
 * Get entry version
 */
function getEntryVersion(): string
/**
 * Use `require` to load native module from entry asar
 * @param moduleName file name in entry
 * @example
 * requireNative<typeof import('../native/db')>('db')
 */
function requireNative<T = any>(moduleName: string): T
/**
 * Use `import` to load native module from entry asar
 * @param moduleName file name in entry
 * @example
 * await importNative<typeof import('../native/db')>('db')
 */
function importNative<T = any>(moduleName: string): Promise<T>
/**
 * Restarts the Electron app.
 */
function restartApp(): void
/**
 * Fix app use model id, only for Windows
 * @param id app id, default is `org.${electron.app.name}`
 */
function setAppUserModelId(id?: string): void
/**
 * Disable hardware acceleration for Windows 7
 *
 * Only support CommonJS
 */
function disableHWAccForWin7(): void
/**
 * Keep single electron instance and auto restore window on `second-instance` event
 * @param window brwoser window to show
 */
function singleInstance(window?: BrowserWindow): void
/**
 * Set `userData` dir to the dir of .exe file
 *
 * Useful for portable Windows app
 * @param dirName dir name, default to `data`
 * @param create whether to create dir, default to `true`
 */
function setPortableDataPath(dirName?: string, create?: boolean): void
/**
 * Load `process.env.VITE_DEV_SERVER_URL` when dev, else load html file
 * @param win window
 * @param htmlFilePath html file path, default is `index.html`
 */
function loadPage(win: BrowserWindow, htmlFilePath?: string): void
interface BeautifyDevToolsOptions {
  /**
   * Sans-serif font family
   */
  sans: string
  /**
   * Monospace font family
   */
  mono: string
  /**
   * Whether to round scrollbar
   */
  scrollbar?: boolean
}
/**
 * Beautify devtools' font and scrollbar
 * @param win target window
 * @param options sans font family, mono font family and scrollbar
 */
function beautifyDevTools(win: BrowserWindow, options: BeautifyDevToolsOptions): void
/**
 * Get joined path from main dir
 * @param paths rest paths
 */
function getPathFromMain(...paths: string[]): string
/**
 * Get joined path from preload dir
 * @param paths rest paths
 */
function getPathFromPreload(...paths: string[]): string
/**
 * Get joined path from publich dir
 * @param paths rest paths
 */
function getPathFromPublic(...paths: string[]): string
/**
 * Get joined path from entry asar
 * @param paths rest paths
 */
function getPathFromEntryAsar(...paths: string[]): string
/**
 * Handle all unhandled error
 * @param callback callback function
 */
function handleUnexpectedErrors(callback: (err: unknown) => void): void
/**
 * Safe get value from header
 * @param headers response header
 * @param key target header key
 */
function getHeader(headers: Record<string, Arrayable<string>>, key: any): any
function downloadUtil<T>(
  url: string,
  headers: Record<string, any>,
  signal: AbortSignal,
  onResponse: (resp: IncomingMessage, resolve: (data: T) => void, reject: (e: any) => void) => void,
): Promise<T>
/**
 * Default function to download json and parse to UpdateJson
 * @param url target url
 * @param headers extra headers
 * @param signal abort signal
 * @param resolveData on resolve
 */
function defaultDownloadJSON<T>(
  url: string,
  headers: Record<string, any>,
  signal: AbortSignal,
  resolveData?: ResolveDataFn,
): Promise<T>
/**
 * Default function to download json and parse to UpdateJson
 * @param url target url
 * @param headers extra headers
 * @param signal abort signal
 */
function defaultDownloadUpdateJSON(
  url: string,
  headers: Record<string, any>,
  signal: AbortSignal,
): Promise<UpdateJSON>
/**
 * Default function to download asar buffer,
 * get total size from `Content-Length` header
 * @param url target url
 * @param headers extra headers
 * @param signal abort signal
 * @param onDownloading on downloading callback
 */
function defaultDownloadAsar(
  url: string,
  headers: Record<string, any>,
  signal: AbortSignal,
  onDownloading?: (progress: DownloadingInfo) => void,
): Promise<Buffer>
```

### Types

#### Entry

```ts
export interface AppOption {
  /**
   * Path to index file that make {@link startupWithUpdater} as default export
   *
   * Generate from plugin configuration by default
   */
  mainPath?: string
  /**
   * Updater options
   */
  updater?: (() => Promisable<Updater>) | UpdaterOption
  /**
   * Hooks on rename temp asar path to `${app.name}.asar`
   */
  onInstall?: OnInstallFunction
  /**
   * Hooks before app startup
   * @param mainFilePath main file path of `${app.name}.asar`
   * @param logger logger
   */
  beforeStart?: (mainFilePath: string, logger?: Logger) => Promisable<void>
  /**
   * Hooks on app startup error
   * @param err installing or startup error
   * @param logger logger
   */
  onStartError?: (err: unknown, logger?: Logger) => void
}
/**
 * Hooks on rename temp asar path to `${app.name}.asar`
 * @param install `() => renameSync(tempAsarPath, appNameAsarPath)`
 * @param tempAsarPath temp(updated) asar path
 * @param appNameAsarPath `${app.name}.asar` path
 * @param logger logger
 * @default install(); logger.info('update success!')
 */
type OnInstallFunction = (
  install: VoidFunction,
  tempAsarPath: string,
  appNameAsarPath: string,
  logger?: Logger,
) => Promisable<void>
```

#### Updater

```ts
export interface UpdaterOption {
  /**
   * Update provider
   *
   * If you will not setup `UpdateJSON` or `Buffer` in params when checking update or download, this option is **required**
   */
  provider?: IProvider
  /**
   * Certifaction key of signature, which will be auto generated by plugin,
   * generate by `selfsigned` if not set
   */
  SIGNATURE_CERT?: string
  /**
   * Whether to receive beta update
   */
  receiveBeta?: boolean
  /**
   * Updater logger
   */
  logger?: Logger
}

export type Logger = {
  info: (msg: string) => void
  debug: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string, e?: Error) => void
}
```

#### Provider

```ts
export type OnDownloading = (progress: DownloadingInfo) => void

export interface DownloadingInfo {
  /**
   * Download buffer delta
   */
  delta: number
  /**
   * Downloaded percent, 0 ~ 100
   *
   * If no `Content-Length` header, will be -1
   */
  percent: number
  /**
   * Total size
   *
   * If not `Content-Length` header, will be -1
   */
  total: number
  /**
   * Downloaded size
   */
  transferred: number
  /**
   * Download speed, bytes per second
   */
  bps: number
}

export interface IProvider {
  /**
   * Provider name
   */
  name: string
  /**
   * Download update json
   * @param versionPath parsed version path in project
   * @param signal abort signal
   */
  downloadJSON: (versionPath: string, signal: AbortSignal) => Promise<UpdateJSON>
  /**
   * Download update asar
   * @param name app name
   * @param updateInfo existing update info
   * @param signal abort signal
   * @param onDownloading hook for on downloading
   */
  downloadAsar: (
    name: string,
    updateInfo: UpdateInfo,
    signal: AbortSignal,
    onDownloading?: (info: DownloadingInfo) => void,
  ) => Promise<Buffer>
  /**
   * Check the old version is less than new version
   * @param oldVer old version string
   * @param newVer new version string
   */
  isLowerVersion: (oldVer: string, newVer: string) => boolean
  /**
   * Function to decompress file using brotli
   * @param buffer compressed file buffer
   */
  unzipFile: (buffer: Buffer) => Promise<Buffer>
  /**
   * Verify asar signature,
   * if signature is valid, returns the version, otherwise returns `undefined`
   * @param buffer file buffer
   * @param version target version
   * @param signature signature
   * @param cert certificate
   */
  verifySignaure: (
    buffer: Buffer,
    version: string,
    signature: string,
    cert: string,
  ) => Promisable<boolean>
}
```

#### Plugin

````ts
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
   * Manually setup package.json, read name, version and main,
   * use `local-pkg` of `loadPackageJSON()` to load package.json by default
   * ```ts
   * import pkg from './package.json'
   * ```
   */
  pkg?: PKG
  /**
   * Whether to generate sourcemap
   * @default !isBuild
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
   * Use `NotBundle()` plugin in main
   * @default true
   */
  useNotBundle?: boolean
  /**
   * Whether to generate version json
   * @default isCI
   */
  buildVersionJson?: boolean
  /**
   * Main process options
   *
   * To change output directories, use `options.updater.paths.electronDistPath` instead
   */
  main: {
    /**
     * Shortcut of `build.rollupOptions.input`
     */
    files: NonNullable<ElectronOptions['entry']>
    /**
     * Electron App startup function.
     *
     * It will mount the Electron App child-process to `process.electronApp`.
     * @param argv default value `['.', '--no-sandbox']`
     * @param options options for `child_process.spawn`
     * @param customElectronPkg custom electron package name (default: 'electron')
     */
    onstart?: ElectronOptions['onstart']
  } & ViteOverride
  /**
   * Preload process options
   *
   * To change output directories, use `options.updater.paths.electronDistPath` instead
   */
  preload: {
    /**
     * Shortcut of `build.rollupOptions.input`.
     *
     * Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
     */
    files: NonNullable<ElectronOptions['entry']>
  } & ViteOverride
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
   * Options for entry (app.asar)
   */
  entry?: BuildEntryOption
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
     * only generate simple **self-signed** certificate **without extensions**
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

export interface BytecodeOptions {
  enable: boolean
  /**
   * Enable in preload script. Remember to set `sandbox: false` when creating window
   */
  preload?: boolean
  /**
   * Custom electron binary path
   */
  electronPath?: string
  /**
   * Before transformed code compile function. If return `Falsy` value, it will be ignored
   * @param code transformed code
   * @param id file path
   */
  beforeCompile?: (code: string, id: string) => Promisable<string | null | undefined | void>
}

export interface BuildEntryOption {
  /**
   * Override to minify on entry
   * @default isBuild
   */
  minify?: boolean
  /**
   * Override to generate sourcemap on entry
   */
  sourcemap?: boolean
  /**
   * Path to app entry output file
   * @default 'dist-entry'
   */
  entryOutputDirPath?: string
  /**
   * Path to app entry file
   * @default 'electron/entry.ts'
   */
  appEntryPath?: string
  /**
   * Vite input options of native modules in entry directory
   *
   * @default {}
   * @example
   * { db: './electron/native/db.ts' }
   */
  nativeModuleEntryMap?: Record<string, string>
  /**
   * Skip process dynamic require
   *
   * Useful for `better-sqlite3` and other old packages
   */
  ignoreDynamicRequires?: boolean
  /**
   * `external` option in `build.rollupOptions`,
   * default is node built-in modules or native modules.
   *
   * If is in dev and {@link postBuild} is not setup, will also
   * external `dependencies` in `package.json`
   */
  external?: NonNullable<NonNullable<InlineConfig['build']>['rollupOptions']>['external']
  /**
   * Custom options for `vite` build
   * ```ts
   * const options = {
   *   plugins: [esm(), bytecodePlugin()], // load on needed
   *   build: {
   *     sourcemap,
   *     minify,
   *     outDir: entryOutputDirPath,
   *     commonjsOptions: { ignoreDynamicRequires },
   *     rollupOptions: { external },
   *   },
   *   define,
   * }
   * ```
   */
  overrideViteOptions?: InlineConfig
  /**
   * By default, all the unbundled modules will be packaged by packager like `electron-builder`.
   * If setup, all the `dependencies` in `package.json` will be bundled by default, and you need
   * to manually handle the native module files.
   */
  postBuild?: (args: {
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
     * Copy specified modules to entry output dir, just like `external` option in rollup
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
}

export interface GeneratorOverrideFunctions {
  /**
   * Custom signature generate function
   * @param buffer file buffer
   * @param privateKey private key
   * @param cert certificate string, **EOL must be '\n'**
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
````

## Credits

- [Obsidian](https://obsidian.md/) for upgrade strategy
- [vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron) for vite plugin
- [electron-builder](https://github.com/electron-userland/electron-builder) for update api
- [electron-vite](https://github.com/alex8088/electron-vite) for bytecode plugin inspiration

## License

MIT
