import fs from 'node:fs'
import path from 'node:path'

import { loadPackageJSON } from 'local-pkg'
import { normalizePath } from 'vite'

import { defaultSignature } from '../utils/crypto'
import { defaultVersionJsonGenerator } from '../utils/version'
import { defaultZipFile } from '../utils/zip'

import { defaultExternal, log } from './constant'
import type {
  ElectronWithUpdaterOptions,
  PKG,
  ResolvedOptions,
  UpdaterOptions,
  UpdaterParsedOptions,
} from './types'
import { parseKeys } from './utils/key'

async function parseUpdaterOption(
  pkg: PKG,
  options: UpdaterOptions = {},
): Promise<UpdaterParsedOptions> {
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

  const { privateKey, cert } = await parseKeys({
    keyLength,
    privateKeyPath,
    certPath,
    subject,
    days,
  })

  return {
    buildAsarOption: {
      version: pkg.version,
      asarOutputPath,
      gzipPath,
      electronDistPath,
      rendererDistPath,
      generateGzipFile,
    },
    buildVersionOption: {
      version: pkg.version,
      minimumVersion,
      privateKey,
      cert,
      versionPath,
      generateSignature,
      generateUpdateJson,
    },
    entryOutDir,
  }
}

function resolveEntryName(files: ElectronWithUpdaterOptions['main']['files']): string {
  if (typeof files === 'string') {
    return path.parse(files).name
  }
  if (Array.isArray(files)) {
    const [firstInput] = files
    if (!firstInput) {
      throw new Error('`options.main.files` must contain at least one main entry')
    }
    return path.parse(firstInput).name
  }
  const firstEntry = Object.entries(files)[0]
  if (!firstEntry) {
    throw new Error('`options.main.files` must contain at least one main entry')
  }
  return firstEntry[0]
}

function resolveMainFileName(
  files: ElectronWithUpdaterOptions['main']['files'],
  isESM: boolean,
): string {
  return `${resolveEntryName(files)}.${isESM ? 'mjs' : 'js'}`
}

function normalizeVersionPath(versionPath: string): string {
  versionPath = normalizePath(versionPath)
  if (!versionPath.startsWith('./')) {
    versionPath = `./${versionPath}`
  }
  return new URL(versionPath, 'file://').pathname.slice(1)
}

export async function resolveOptions(
  options: ElectronWithUpdaterOptions,
): Promise<ResolvedOptions> {
  if (process.cachedOptions) {
    return process.cachedOptions
  }
  const {
    isBuild,
    root = process.cwd(),
    entry,
    main,
    preload,
    sourcemap = !isBuild || !!process.env.VSCODE_DEBUG,
    minify = isBuild,
    buildVersionJson,
    notBundle: notBundleOption = true,
    external,
    updater,
    bytecode,
  } = options

  const pkg = await loadPackageJSON(root)
  if (!pkg || !pkg.version || !pkg.name || !pkg.main) {
    throw new Error('package.json not found or invalid, must contains version, name and main field')
  }

  const isESM = pkg.type === 'module'
  const finalExternal = [...defaultExternal]
  if (external === true) {
    finalExternal.push(...Object.keys(pkg.dependencies || {}))
  } else if (Array.isArray(external)) {
    finalExternal.push(...external)
  }

  const bytecodeOptions =
    typeof bytecode === 'object' ? bytecode : bytecode === true ? { enable: true } : undefined

  if (isESM && bytecodeOptions?.enable) {
    throw new Error(
      '`bytecodePlugin` does not support ES module, please remove "type": "module" in package.json',
    )
  }

  const { buildAsarOption, buildVersionOption, entryOutDir } = await parseUpdaterOption(
    pkg as PKG,
    updater,
  )

  const mainFileName = resolveMainFileName(main.files, isESM)
  log.info(`Using "${mainFileName}" as main file`, { timestamp: true })

  log.info(`Clear cache files`, { timestamp: true })
  await Promise.all(
    [buildAsarOption.rendererDistPath, buildAsarOption.electronDistPath, entryOutDir].map((p) =>
      fs.promises.rm(path.resolve(root, p), { recursive: true, force: true }),
    ),
  ).catch(() => {})

  process.cachedOptions = {
    isBuild,
    root,
    entry,
    main,
    preload,
    sourcemap,
    minify,
    buildVersionJson,
    notBundleOption,
    isESM,
    finalExternal,
    bytecodeOptions,
    buildAsarOption,
    buildVersionOption,
    entryOutDir,
    outputNames: {
      entryFileNames: `[name].${isESM ? 'mjs' : 'js'}`,
      chunkFileNames: `[name].${isESM ? 'mjs' : 'js'}`,
      assetFileNames: '[name].[ext]',
    },
    define: {
      __EIU_ASAR_BASE_NAME__: JSON.stringify(path.basename(buildAsarOption.asarOutputPath)),
      __EIU_ELECTRON_DIST_PATH__: JSON.stringify(normalizePath(buildAsarOption.electronDistPath)),
      __EIU_ENTRY_DIST_PATH__: JSON.stringify(normalizePath(entryOutDir)),
      __EIU_IS_DEV__: JSON.stringify(!isBuild),
      __EIU_IS_ESM__: JSON.stringify(isESM),
      __EIU_MAIN_FILE__: JSON.stringify(mainFileName),
      __EIU_SIGNATURE_CERT__: JSON.stringify(buildVersionOption.cert),
      __EIU_VERSION_PATH__: JSON.stringify(
        normalizeVersionPath(normalizePath(buildVersionOption.versionPath)),
      ),
    },
  }

  return process.cachedOptions
}
