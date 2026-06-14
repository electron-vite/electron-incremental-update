# Electron Incremental Update

Lightweight incremental update tools for Electron applications built with Vite. The package provides a Vite plugin, an Electron startup wrapper, update providers, bytecode protection, and utilities for common Electron app paths.

## Contents

- [Electron Incremental Update](#electron-incremental-update)
  - [Contents](#contents)
  - [Why](#why)
  - [How It Works](#how-it-works)
  - [Installation](#installation)
  - [Quick Start](#quick-start)
    - [Entry Process](#entry-process)
    - [Main Process](#main-process)
  - [Vite Configuration](#vite-configuration)
    - [Plugin Options](#plugin-options)
  - [Electron Builder](#electron-builder)
  - [Runtime Usage](#runtime-usage)
  - [Providers](#providers)
    - [Testing The Local Flow](#testing-the-local-flow)
  - [Update Artifacts](#update-artifacts)
  - [Native Modules](#native-modules)
    - [Result in app.asar](#result-in-appasar)
  - [Bytecode Protection](#bytecode-protection)
  - [Development Bundling](#development-bundling)
  - [Utilities](#utilities)
  - [API Reference](#api-reference)
  - [Credits](#credits)
  - [License](#license)

## Why

Electron applications are commonly shipped as full installers. This package keeps the installer stable and updates only the application asar file, which makes update packages smaller and keeps the runtime workflow explicit.

Key features:

- Vite plugin based on `vite-plugin-electron/multi-env`
- Dual asar runtime layout
- Signed update metadata and asar verification
- GitHub and local development providers
- Optional V8 bytecode generation
- Utilities for app paths, native modules, renderer loading, and Electron startup

## How It Works

The packaged app uses two asar files:

- `app.asar`: the stable entry asar generated from `entry.files`
- `${app.name}.asar`: the replaceable application asar generated from the Electron main, preload, and renderer build outputs

The update flow is:

1. `createElectronApp()` starts from `app.asar`.
2. If `${app.name}.asar.tmp` exists, it is renamed to `${app.name}.asar`.
3. The configured main file is loaded from `${app.name}.asar`.
4. Your main process calls `updater.checkForUpdates()`.
5. The provider downloads `version.json`.
6. The updater compares versions and emits `update-available` when a newer update exists.
7. `updater.downloadUpdate()` downloads, decompresses, verifies, and writes `${app.name}.asar.tmp`.
8. `updater.quitAndInstall()` restarts the app so the new asar can be installed on next launch.

## Installation

```sh
npm install -D electron-incremental-update @electron/asar @babel/core
```

```sh
pnpm add -D electron-incremental-update @electron/asar @babel/core
```

```sh
yarn add -D electron-incremental-update @electron/asar @babel/core
```

> Upgrading from `3.0.0-beta.x`? See [MIGRATION.md](./MIGRATION.md).

## Quick Start

Recommended project layout:

```txt
electron
├── entry.ts
├── main
│   └── index.ts
├── preload
│   └── index.ts
└── native
    └── db.ts
src
└── ...
```

### Entry Process

`electron/entry.ts` is the stable startup file. It creates the updater and loads the real main process from `${app.name}.asar`.

```ts
import { createElectronApp } from 'electron-incremental-update'
import { GitHubProvider } from 'electron-incremental-update/provider'

createElectronApp({
  updater: {
    provider: new GitHubProvider({
      user: 'your-github-user',
      repo: 'your-repo',
    }),
  },
  beforeStart(mainFilePath, logger) {
    logger?.debug(`Starting app from ${mainFilePath}`)
  },
})
```

### Main Process

The main entry must default-export one function wrapped with `startupWithUpdater()`.

```ts
import { app, BrowserWindow, dialog } from 'electron'
import { startupWithUpdater } from 'electron-incremental-update'
import { getAppVersion, getPathFromPreload, loadPage } from 'electron-incremental-update/utils'

export default startupWithUpdater(async (updater) => {
  await app.whenReady()

  const win = new BrowserWindow({
    webPreferences: {
      preload: getPathFromPreload('index.js'),
    },
  })

  loadPage(win)

  updater.on('update-available', async ({ version }) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: `Version ${version} is available. Current version is ${getAppVersion()}.`,
      buttons: ['Download', 'Later'],
    })

    if (response === 0) {
      await updater.downloadUpdate()
    }
  })

  updater.on('download-progress', (info) => {
    win.webContents.send('update-progress', info)
  })

  updater.on('update-downloaded', async () => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: 'Update downloaded.',
      buttons: ['Restart Now', 'Later'],
    })

    if (response === 0) {
      updater.quitAndInstall()
    }
  })

  updater.on('update-not-available', (code, message) => {
    console.log(`[${code}] ${message}`)
  })

  updater.on('error', (error) => {
    console.error(error)
  })

  await updater.checkForUpdates()
})
```

## Vite Configuration

Use `defineElectronConfig()` when the same Vite config owns the renderer and Electron processes.

```ts
import { defineElectronConfig } from 'electron-incremental-update/vite'

export default defineElectronConfig({
  entry: {
    files: './electron/entry.ts',
  },
  main: {
    files: './electron/main/index.ts',
  },
  preload: {
    files: './electron/preload/index.ts',
  },
  updater: {
    minimumVersion: '0.0.0',
    paths: {
      asarOutputPath: 'release/my-app.asar',
      compressedPath: 'release/my-app-1.0.0.asar.br',
      versionPath: 'release/version.json',
    },
  },
  renderer: {
    server: process.env.VSCODE_DEBUG
      ? {
          host: '127.0.0.1',
          port: 5173,
        }
      : undefined,
  },
})
```

Use `electronWithUpdater()` directly when you want to manage the renderer config yourself.

```ts
import { electronWithUpdater } from 'electron-incremental-update/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    electronWithUpdater({
      entry: {
        files: './electron/entry.ts',
      },
      main: {
        files: './electron/main/index.ts',
      },
      preload: {
        files: './electron/preload/index.ts',
      },
    }),
  ],
})
```

### Plugin Options

Common options overview:

- `entry.files`: entry process input. Required.
- `main.files`: main process input. Required.
- `preload.files`: preload process input. Optional.
- `sourcemap`: defaults to development or `VSCODE_DEBUG`.
- `minify`: defaults to production builds.
- `bytecode`: `true` or bytecode options.
- `notBundle`: externalizes Node modules in development. Defaults to `true`.
- `external`: additional Vite/Rolldown externals. Use `true` to externalize `dependencies`.
- `buildVersionJson`: generates update JSON. Defaults to CI only.
- `localDevUpdate`: generates and serves a local update package during dev startup. Use `true`
  for defaults, or pass `{ baseDir, packageJsonPath, chunkSize, chunkDelay }`. See [Testing The Local Flow](#testing-the-local-flow) for details.
- `updater.minimumVersion`: minimum supported entry asar version. Defaults to `0.0.0`.

> 📖 See [API.md → Plugin Options](./API.md#plugin-options) for the complete reference including all types, defaults, paths, keys, and generator overrides.

## Electron Builder

Set `package.json#main` to the entry output file:

```json
{
  "main": "dist-entry/entry.js"
}
```

Minimal `electron-builder.config.cjs`:

```js
const { name } = require('./package.json')

const targetFile = `${name}.asar`

/**
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
  appId: `org.${name}`,
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

## Runtime Usage

```ts
import { createElectronApp } from 'electron-incremental-update'
import { GitHubProvider } from 'electron-incremental-update/provider'

createElectronApp({
  updater: {
    provider: new GitHubProvider({
      user: 'your-github-user',
      repo: 'your-repo',
    }),
  },
  beforeStart(mainFilePath, logger) {
    logger?.debug(`Starting app from ${mainFilePath}`)
  },
})
```

The full `Updater` API, `createElectronApp` options, `AppOption`, events, and error codes are documented in the API reference.

> 📖 See [API.md → Entry API](./API.md#entry-api) for the complete reference.

## Providers

The package includes GitHub-based providers (file, atom, API) and a local development provider.

- **GitHubProvider** — reads `version.json` from a repository branch, downloads asar from Releases.
- **GitHubAtomProvider** — reads the latest release from `releases.atom`.
- **GitHubApiProvider** — uses the GitHub Releases API (supports tokens for private repos).
- **LocalDevProvider** — reads update artifacts from the local filesystem for dev testing.

All GitHub providers support a `urlHandler` for mirrors and custom gateways.

See the [API reference](./API.md#providers) for the complete provider constructor options and method signatures.

### Testing The Local Flow

Prefer `localDevUpdate: true` in the Vite plugin over constructing `LocalDevProvider` manually.
See [playground](./playground) as a complete local update test:

```sh
bun run play
```

`bun run play` builds the package first, then starts the Vite dev server and Electron playground.

Expected flow:

1. The plugin builds the Electron main, preload, and entry outputs.
2. The plugin creates `DEV.asar` and a local update archive.
3. `createElectronApp()` installs any existing `DEV.asar.tmp`.
4. The app starts from `DEV.asar`.
5. The updater checks the generated `version.json`.
6. The playground shows an available local update.
7. Clicking download emits simulated progress events.
8. Clicking restart installs `DEV.asar.tmp` and restarts Electron.

Explicit `updater.provider` values still take priority. If you set a provider manually, automatic
local provider setup is skipped.

## Update Artifacts

The Vite plugin can generate:

- `${app.name}.asar`
- `${app.name}-${version}.asar.br`
- `version.json`

Default `version.json` shape:

```json
{
  "version": "1.0.0",
  "minimumVersion": "0.0.0",
  "signature": "...",
  "beta": {
    "version": "1.0.1-beta.1",
    "minimumVersion": "0.0.0",
    "signature": "..."
  }
}
```

Stable releases update both the top-level fields and `beta`. Prerelease versions update only `beta`.

Set `buildVersionJson: true` if you need metadata during non-CI builds.

> [!NOTE]
> The **default** version parser supports `major.minor.patch[-prerelease[.number]]` (e.g. `1.0.0-beta.1`).
> Build metadata (`+build`) and complex semver prerelease identifiers (e.g. `1.0.0-beta.1.2`)
> are not supported by default.
>
> To use full semver or a custom version scheme, override
> [`provider.isLowerVersion`](#providers) with your own comparator
> (e.g. `semver.lt` from the `semver` package).

## Native Modules

To keep update packages small, put native modules and their native binaries in `app.asar`, then load them from the main process with `requireNative()` or `importNative()`.

```ts
import { readdirSync } from 'node:fs'

import { electronWithUpdater } from 'electron-incremental-update/vite'

export default {
  plugins: [
    electronWithUpdater({
      external: false,
      entry: {
        files: ['./electron/entry.ts', './electron/native/db.ts'],
        postBuild({ isBuild, copyToEntryOutputDir }) {
          if (!isBuild) {
            return
          }

          copyToEntryOutputDir({
            from: './node_modules/better-sqlite3/build/Release/better_sqlite3.node',
            skipIfExist: false,
          })

          const packageName = readdirSync('./node_modules/.pnpm').find((name) =>
            name.startsWith('@napi-rs+image-'),
          )

          if (packageName) {
            const archName = packageName.substring('@napi-rs+image-'.length).split('@')[0]
            copyToEntryOutputDir({
              from: `./node_modules/.pnpm/${packageName}/node_modules/@napi-rs/image-${archName}/image.${archName}.node`,
            })
          }
        },
      },
      main: {
        files: './electron/main/index.ts',
      },
    }),
  ],
}
```

Use the copied native binding from entry asar:

```ts
import Database from 'better-sqlite3'
import { getPathFromEntryAsar } from 'electron-incremental-update/utils'

const db = new Database(':memory:', {
  nativeBinding: getPathFromEntryAsar('./better_sqlite3.node'),
})

export function testDatabase(): void {
  db.exec('CREATE TABLE IF NOT EXISTS employees (name TEXT, salary INTEGER)')
  db.prepare('INSERT INTO employees VALUES (:name, :salary)').run({
    name: 'James',
    salary: 5000,
  })
}
```

Load native helper modules from main:

```ts
import { importNative, requireNative } from 'electron-incremental-update/utils'

requireNative<typeof import('../native/db')>('db').testDatabase()

const nativeDb = await importNative<typeof import('../native/db')>('db')
nativeDb.testDatabase()
```

For `electron-builder`, exclude `node_modules` when you have bundled dependencies manually:

```js
module.exports = {
  files: [
    'dist-entry',
    // exclude all dependencies in electron-builder config
    '!node_modules/**',
  ],
}
```

### Result in app.asar

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

## Bytecode Protection

Bytecode protection compiles JavaScript into V8 bytecode.

```ts
electronWithUpdater({
  bytecode: true,
  entry: {
    files: './electron/entry.ts',
  },
  main: {
    files: './electron/main/index.ts',
  },
})
```

Notes:

- CommonJS only. Remove `"type": "module"` from `package.json` when enabling bytecode.
- Main process bytecode is enabled by default.
- To include preload scripts, use `bytecode: { enablePreload: true }`.
- If preload bytecode is enabled, create the `BrowserWindow` with `sandbox: false`.

## Development Bundling

`notBundle` is enabled by default in development. It externalizes Node modules in entry and main builds to improve startup speed.

```ts
electronWithUpdater({
  notBundle: false,
  entry: {
    files: './electron/entry.ts',
  },
  main: {
    files: './electron/main/index.ts',
  },
})
```

## Utilities

Import from `electron-incremental-update/utils` for path helpers, platform checks, native module loading, crypto, compression, download, and version parsing utilities.

> 📖 See [API.md → Utilities API](./API.md#utilities-api) for the complete function list with signatures and descriptions.

## API Reference

For the full API documentation including all types, options tables, provider constructors, and plugin configuration, see the standalone reference:

> 📖 **[API.md](./API.md)** — Auto-generated JSDoc extraction + manual reference sections.

## Credits

- [Obsidian](https://obsidian.md/) for the dual asar update strategy
- [vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron) for the Vite Electron plugin foundation
- [electron-builder](https://github.com/electron-userland/electron-builder) for Electron packaging
- [electron-vite](https://github.com/alex8088/electron-vite) for bytecode plugin inspiration

## License

MIT
