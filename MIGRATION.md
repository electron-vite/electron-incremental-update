# Migration Guide: v2.4.3 → v3.0.0

> Breaking changes when upgrading. For coding agents: search/replace patterns, no prose.

## Renames

| v2                 | v3                       |
| ------------------ | ------------------------ |
| `verifySignaure`   | `verifySignature`        |
| `unzipFile`        | `decompressFile`         |
| `defaultZipFile`   | `defaultCompressFile`    |
| `defaultUnzipFile` | `defaultDecompressFile`  |
| `gzipPath`         | `compressedPath`         |
| `generateGzipFile` | `generateCompressedFile` |
| `.asar.gz`         | `.asar.br`               |

Re-upload GitHub Release artifacts with `.asar.br`, rename local files.

## Vite config

```diff
  electronWithUpdater({
    updater: {
      paths: {
-       gzipPath: 'release/app-1.0.0.asar.gz',
+       compressedPath: 'release/app-1.0.0.asar.br',
      },
      overrideGenerator: {
-       generateGzipFile: myCompressor,
+       generateCompressedFile: myCompressor,
      },
    },
  })
```

## `notBundle` removed

`notBundle` and `useNotBundle` were removed with `vite-plugin-electron` 1.1.0 in v3.0.0. Use `bundleDeps` instead. To keep the former development-only externalization behavior:

```diff
  electronWithUpdater({
-   notBundle: true,
+   bundleDeps: { dev: { exclude: true } },
  })
```

Use `bundleDeps: true` to bundle all dependencies, `bundleDeps: false` to externalize all
dependencies, or `bundleDeps: 'auto'` to bundle package.json dev dependencies while externalizing
package.json dependencies.

## Custom provider

```diff
  class MyProvider extends BaseProvider {
-   verifySignaure(buffer, version, signature, cert) { ... }
+   verifySignature(buffer, version, signature, cert) { ... }
-   unzipFile(buffer) { ... }
+   decompressFile(buffer) { ... }
  }
```

## `checkForUpdates(data)` overload removed

```diff
- await updater.checkForUpdates(cachedJSON)
+ // store info, then call without args:
+ updater.info = cachedJSON
+ await updater.checkForUpdates()
```

## `downloadUpdate(data, info)` overload removed

```diff
- await updater.downloadUpdate(buffer, info)
+ await updater.downloadUpdate()
```

## Dev mode requires `forceUpdate`

```diff
  const updater = new Updater({ provider })
+ updater.forceUpdate = true
  await updater.checkForUpdates()
```

## Error listener required

```diff
  const updater = new Updater({ provider })
+ updater.on('error', (err) => console.error(err))
```

Without a listener, errors are silently swallowed.

## Download progress: `bps` unit

`DownloadingInfo.bps` now bytes/sec (was bytes/ms). If you display speed in a UI,
values are 1000× larger — remove any `* 1000` compensation you had.

## Version format

Default parser: `x.y.z[-stage[.num]]`. For full semver (e.g. `1.0.0+build`, `1.0.0-beta.1.2`):

```ts
import { lt } from 'semver'
provider.isLowerVersion = (a, b) => lt(a, b)
```
