# Electron Incremental Update

This project offers a lightweight update solution for Electron applications without using native executables.

- [Electron Incremental Update](#electron-incremental-update)
  - [Key Features](#key-features)
    - [Dual Asar Architecture](#dual-asar-architecture)
    - [Update Process](#update-process)
    - [Additional Features](#additional-features)
  - [Getting Started](#getting-started)
    - [Install](#install)
    - [Project Structure](#project-structure)
    - [Setup Entry](#setup-entry)
    - [Setup `vite.config.ts`](#setup-viteconfigts)
    - [Modify package.json](#modify-packagejson)
    - [Config `electron-builder`](#config-electron-builder)
  - [Usage](#usage)
    - [Use In Main Process](#use-in-main-process)
      - [Alternative Provider Setup](#alternative-provider-setup)
      - [Custom logger](#custom-logger)
      - [Beta Channel Updates](#beta-channel-updates)
    - [Use Native Modules](#use-native-modules)
      - [Example](#example)
      - [Result in app.asar](#result-in-appasar)
    - [Parallel Build](#parallel-build)
    - [NotBundle](#notbundle)
    - [Bytecode Protection](#bytecode-protection)
      - [Benefits](#benefits)
      - [Limitation](#limitation)
    - [Utils](#utils)
      - [Electron Utilities](#electron-utilities)
      - [Crypto Utilities](#crypto-utilities)
      - [Zip Utilities](#zip-utilities)
  - [Credits](#credits)
  - [License](#license)

## Key Features

This solution provides a comprehensive update system for Electron applications, including:

- **Vite Plugin** - Seamlessly integrates with your existing Vite build process
- **Startup Entry Function** - Handles application initialization and update checking
- **Updater Class** - Manages the complete update workflow with event-driven API
- **Utility Functions** - Helper functions for file paths, version management, and more

### Dual Asar Architecture

The update system uses a two-file structure for efficient incremental updates:

- **`app.asar`** - The application entry point that loads and initializes the updater
- **`${electron.app.name}.asar`** - Contains your application code (main process, preload scripts, and renderer) that gets replaced during updates

### Update Process

The update workflow follows these steps:

1. **Check for Updates** - Query the remote server for available updates
2. **Download and Verify** - Download the update asar file and verify it using RSA signatures
3. **Prepare for Update** - The application quits to prepare for the update
4. **Apply Update** - On next launch, replace the old `${electron.app.name}.asar` with the new version and load it

### Additional Features

- **Smaller Update Packages** - Package all native modules into `app.asar` to minimize the update file size and download time [see usage](#use-native-modules)
- **Source Code Protection** - Leverage V8 bytecode compilation to obfuscate and protect your JavaScript source code [see details](#bytecode-protection)

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

`Updater` use the `provider` to check and download the update. The built-in `GithubProvider` is based on `BaseProvider`, which implements the [`IProvider`](./src/provider/types.ts) interface. And the `provider` is optional, you can setup it later.

in `electron/entry.ts`

```ts
import { createElectronApp } from 'electron-incremental-update'
import { GitHubProvider } from 'electron-incremental-update/provider'

createElectronApp({
  updater: {
    // optional, you can setup later
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

- certificate will read from `process.env.UPDATER_CERT` first, if absent, read config
- privatekey will read from `process.env.UPDATER_PK` first, if absent, read config

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
        entry: {
          files: ['./electron/entry.ts', './electron/native/index.ts'],
        },
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
  entry: {
    files: ['./electron/entry.ts', './electron/native/index.ts'],
  },
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
  publish: null, // <- disable publish
}
```

## Usage

### Use In Main Process

The updater should be initialized in your main process. The startup function will automatically handle update checks and installation.

**NOTE: There should only be one function and should be the default export in the main index file**

in `electron/main/index.ts`

```ts
import { app, dialog } from 'electron'
import { startupWithUpdater } from 'electron-incremental-update'
import {
  getPathFromAppNameAsar,
  getAppVersion,
  getEntryVersion,
} from 'electron-incremental-update/utils'

export default startupWithUpdater(async (updater) => {
  await app.whenReady()

  // Display current app information
  console.table({
    [`${app.name}.asar path:`]: getPathFromAppNameAsar(),
    'app version:': getAppVersion(),
    'entry (installer) version:': getEntryVersion(),
    'electron version:': process.versions.electron,
  })

  // Listen for download progress
  updater.onDownloading = ({ percent }) => {
    console.log(`Download progress: ${percent}%`)
  }

  // Listen for available updates
  updater.on('update-available', async ({ version }) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download', 'Later'],
      message: `Version ${version} update available!`,
    })
    if (response === 0) {
      // 0 = Download button
      await updater.downloadUpdate()
    }
  })

  // Handle no updates available
  updater.on('update-not-available', (code, reason, info) => {
    console.log('No update available:', reason)
  })

  // Handle download progress (alternative to onDownloading)
  updater.on('download-progress', (data) => {
    console.log('Download progress:', data)
    // Send progress to renderer if needed
    const [mainWindow] = BrowserWindow.getAllWindows()
    if (mainWindow) {
      mainWindow.webContents.send('update-progress', data)
    }
  })

  // Handle update completion
  updater.on('update-downloaded', () => {
    dialog
      .showMessageBox({
        type: 'info',
        message: 'Update downloaded successfully!',
        buttons: ['Restart Now', 'Later'],
      })
      .then(({ response }) => {
        if (response === 0) {
          updater.quitAndInstall()
        }
      })
  })

  // Handle errors
  updater.on('error', (error) => {
    console.error('Update error:', error)
    dialog.showErrorBox('Update Error', error.message || 'Failed to check for updates')
  })

  // Start checking for updates
  updater.checkForUpdates()
})
```

#### Alternative Provider Setup

You can also change the provider dynamically:

```ts
// In main.ts
updater.provider = new GitHubProvider({
  owner: 'your-username',
  repo: 'your-repo',
  // Custom URL handling for mirrors or private repos
  urlHandler: (url) => {
    url.hostname = 'mirror.ghproxy.com'
    url.pathname = `https://github.com${url.pathname}`
    return url
  },
})
```

Or use built-in `LocalDevProvider`

```ts
const provider = new LocalDevProvider({
  baseDir: process.pwd()
})
```

#### Custom logger

```ts
updater.logger = console
```

#### Beta Channel Updates

```ts
updater.receiveBeta = true
```

### Use Native Modules

To reduce production size, it is recommended that all the **native modules** should be set as `dependency` in `package.json` and other packages should be set as `devDependencies`. Also, `electron-rebuild` only check dependencies inside `dependency` field.

If you are using `electron-builder` to build distributions, all the native modules with its **large relevant `node_modules`** will be packaged into `app.asar` by default.

Luckily, `vite` can bundle all the dependencies. Just follow the steps:

1. setup `entry.files` option
2. Manually copy the native binaries in `entry.postBuild` callback
3. Exclude all the dependencies in `electron-builder`'s config
4. call the native functions with `requireNative` / `importNative` in your code

#### Example

in `vite.config.ts`

```ts
const plugin = electronWithUpdater({
  // options...
  external: false, // <- bundle all native modules, handle bin files manually
  entry: {
    files: ['./electron/native/entry.ts', './electron/native/db.ts', './electron/native/img.ts'],
    postBuild: ({ isBuild, copyToEntryOutputDir }) => {
      if (!isBuild) {
        return
      }
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

### Parallel Build

Build entry/main/preload in parallel, make build faster.

```ts
electronWithUpdater({
  // ...
  parallel: true,
})
```

### NotBundle

Faster dev startup by externalize all node modules in entry and main.

Enabled by default, only works in development (`isBuild === false`).

```ts
electronWithUpdater({
  // ...
  notBundle: false, // or options
})
```

### Bytecode Protection

Use V8 cache to protect the source code

```ts
electronWithUpdater({
  // ...
  bytecode: true, // or options
})
```

#### Benefits

https://electron-vite.org/guide/source-code-protection

- Improve the string protection (see [original issue](https://github.com/alex8088/electron-vite/issues/552))
- Protect all strings by default
- Minification is allowed

#### Limitation

- Only support commonjs
- Only for main process by default, if you want to use in preload script, please use `electronWithUpdater({ bytecode: { enablePreload: true } })` and set `sandbox: false` when creating window

### Utils

Utility functions of Electron helper, crypto, and file compression.

```ts
import {
  // Electron utilities
  isDev,
  isWin,
  isMac,
  isLinux,
  getPathFromAppNameAsar,
  getPathFromEntryAsar,
  getPathFromMain,
  getPathFromPreload,
  getPathFromPublic,
  getAppVersion,
  getEntryVersion,
  requireNative,
  importNative,
  restartApp,
  setAppUserModelId,
  disableHWAccForWin7,
  singleInstance,
  setPortableDataPath,
  loadPage,
  beautifyDevTools,
  handleUnexpectedErrors,

  // Crypto utilities
  hashBuffer,
  aesEncrypt,
  aesDecrypt,
  defaultSignature,
  defaultVerifySignature,

  // Zip utilities
  defaultZipFile,
  defaultUnzipFile,
} from 'electron-incremental-update/utils'
```

#### Electron Utilities

- **isDev** - Compile-time dev check
- **isWin** - Check if running on Windows
- **isMac** - Check if running on macOS
- **isLinux** - Check if running on Linux
- **getPathFromAppNameAsar(...paths)** - Get joined path of `${electron.app.name}.asar`
- **getPathFromEntryAsar(...paths)** - Get joined path from entry asar
- **getPathFromMain(...paths)** - Get joined path from main dir
- **getPathFromPreload(...paths)** - Get joined path from preload dir
- **getPathFromPublic(...paths)** - Get joined path from public dir
- **getAppVersion()** - Get app version (returns entry version in dev)
- **getEntryVersion()** - Get entry version
- **requireNative(moduleName)** - Load native module using require from entry asar
- **importNative(moduleName)** - Load native module using import from entry asar
- **restartApp()** - Restart the Electron app
- **setAppUserModelId(id)** - Fix app model ID (Windows only)
- **disableHWAccForWin7()** - Disable hardware acceleration for Windows 7
- **singleInstance(window)** - Keep single instance and restore window
- **setPortableDataPath(dirName, create)** - Set userData dir to exe dir for portable apps
- **loadPage(win, htmlFilePath)** - Load dev server URL in dev or HTML file otherwise
- **beautifyDevTools(win, options)** - Beautify devtools font and scrollbar
- **handleUnexpectedErrors(callback)** - Handle all unhandled errors

#### Crypto Utilities

- **hashBuffer(data, length)** - Hash data using SHA-256
- **aesEncrypt(plainText, key, iv)** - Encrypt text using AES
- **aesDecrypt(encryptedText, key, iv)** - Decrypt text using AES
- **defaultSignature(buffer, privateKey, cert, version)** - Generate RSA signature for asar file
- **defaultVerifySignature(buffer, version, signature, cert)** - Verify RSA signature of asar file

#### Zip Utilities

- **defaultZipFile(buffer)** - Compress file using brotli
- **defaultUnzipFile(buffer)** - Decompress file using brotli

## Credits

- [Obsidian](https://obsidian.md/) for upgrade strategy
- [vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron) for vite plugin
- [electron-builder](https://github.com/electron-userland/electron-builder) for update api
- [electron-vite](https://github.com/alex8088/electron-vite) for bytecode plugin inspiration

## License

MIT
