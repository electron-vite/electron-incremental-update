import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createPackage, extractFile } from '@electron/asar'
import type { MultiEnvElectronOptions } from 'vite-plugin-electron/multi-env'

import type { UpdateJSON } from '../utils/version'
import { defaultVersionJsonGenerator, isUpdateJSON, parseVersion } from '../utils/version'

import { log } from './constant'
import type { BuildAsarOptions, LocalDevUpdateOptions, PKG } from './types'

const LOCAL_DEV_SIGNATURE = 'local-dev'

export interface ResolvedLocalDevUpdateOptions {
  baseDir: string
  installedAsarPath: string
  packageJsonPath?: string
  chunkSize?: number
  chunkDelay?: number
}

interface PrepareLocalDevUpdateOptions {
  root: string
  pkg: PKG
  buildAsarOption: BuildAsarOptions
  versionPath: string
  minimumVersion: string
  keepInstalledVersion?: boolean
  localDevUpdate: ResolvedLocalDevUpdateOptions
}

export function resolveLocalDevUpdateOptions(
  root: string,
  options: boolean | LocalDevUpdateOptions | undefined,
): ResolvedLocalDevUpdateOptions | undefined {
  if (!options) {
    return
  }

  const resolvedOptions = options === true ? {} : options
  const baseDir = path.resolve(root, resolvedOptions.baseDir ?? 'release/local-update')

  return {
    baseDir,
    installedAsarPath: path.resolve(root, 'DEV.asar'),
    packageJsonPath: resolvedOptions.packageJsonPath
      ? path.resolve(root, resolvedOptions.packageJsonPath)
      : undefined,
    chunkSize: resolvedOptions.chunkSize,
    chunkDelay: resolvedOptions.chunkDelay,
  }
}

export async function resolveLocalDevUpdatePackage(
  fallbackPkg: PKG,
  localDevUpdate: ResolvedLocalDevUpdateOptions | undefined,
): Promise<PKG> {
  if (!localDevUpdate?.packageJsonPath) {
    return fallbackPkg
  }

  const pkg = JSON.parse(await readFile(localDevUpdate.packageJsonPath, 'utf-8')) as PKG
  if (!pkg.name || !pkg.version || !pkg.main) {
    throw new Error('localDevUpdate.packageJsonPath must contain name, version and main fields')
  }
  return pkg
}

export function getNextPatchVersion(version: string): string {
  const parsed = parseVersion(version)
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
}

function isValidVersion(version: string): boolean {
  try {
    parseVersion(version)
    return true
  } catch {
    return false
  }
}

export function readValidAsarVersion(asarPath: string): string | undefined {
  try {
    const version = extractFile(asarPath, 'version').toString('utf-8').trim()
    return isValidVersion(version) ? version : undefined
  } catch {
    return undefined
  }
}

async function installPendingAsar(installedAsarPath: string): Promise<boolean> {
  const pendingAsarPath = `${installedAsarPath}.tmp`
  const version = readValidAsarVersion(pendingAsarPath)
  if (!version) {
    await rm(pendingAsarPath, { force: true })
    return false
  }

  try {
    await copyFile(pendingAsarPath, installedAsarPath)
    await rm(pendingAsarPath, { force: true })
    log.info(`Installed pending local dev update ${version}`, { timestamp: true })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function readExistingUpdateJSON(versionPath: string, version: string): Promise<UpdateJSON> {
  try {
    const json = JSON.parse(await readFile(versionPath, 'utf-8'))
    if (isUpdateJSON(json)) {
      return json
    }
  } catch {}

  return {
    version,
    minimumVersion: '0.0.0',
    signature: LOCAL_DEV_SIGNATURE,
    beta: {
      version,
      minimumVersion: '0.0.0',
      signature: LOCAL_DEV_SIGNATURE,
    },
  }
}

export async function prepareLocalDevUpdateResource({
  root,
  pkg,
  buildAsarOption,
  versionPath,
  minimumVersion,
  keepInstalledVersion,
  localDevUpdate,
}: PrepareLocalDevUpdateOptions): Promise<string> {
  const installedPendingUpdate = await installPendingAsar(localDevUpdate.installedAsarPath)
  const installedVersion = readValidAsarVersion(localDevUpdate.installedAsarPath) ?? pkg.version
  const targetVersion =
    keepInstalledVersion && installedPendingUpdate
      ? installedVersion
      : getNextPatchVersion(installedVersion)
  const workDir = await mkdtemp(path.join(tmpdir(), 'eiu-local-dev-update-'))
  const stagedElectronDistPath = path.join(workDir, 'dist-electron')
  const resolvedVersionPath = path.join(localDevUpdate.baseDir, versionPath)
  const asarPath = path.join(localDevUpdate.baseDir, `${pkg.name}.asar`)
  const gzipPath = path.join(localDevUpdate.baseDir, `${pkg.name}-${targetVersion}.asar.gz`)

  try {
    await mkdir(localDevUpdate.baseDir, { recursive: true })
    await mkdir(path.dirname(resolvedVersionPath), { recursive: true })
    await cp(path.resolve(root, buildAsarOption.electronDistPath), stagedElectronDistPath, {
      recursive: true,
    })
    await writeFile(path.join(stagedElectronDistPath, 'version'), targetVersion, 'utf-8')
    await createPackage(stagedElectronDistPath, asarPath)

    const compressedBuffer = await buildAsarOption.generateGzipFile(await readFile(asarPath))
    await writeFile(gzipPath, compressedBuffer)

    const updateJSON = defaultVersionJsonGenerator(
      await readExistingUpdateJSON(resolvedVersionPath, targetVersion),
      LOCAL_DEV_SIGNATURE,
      targetVersion,
      minimumVersion,
    )
    if (!isUpdateJSON(updateJSON)) {
      throw new Error('Invalid local dev update json')
    }

    await writeFile(resolvedVersionPath, JSON.stringify(updateJSON, null, 2), 'utf-8')
    log.info(`Prepared local dev update ${targetVersion}`, { timestamp: true })
    return targetVersion
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

export function createLocalDevUpdateOnstart(args: {
  root: string
  pkg: PKG
  buildAsarOption: BuildAsarOptions
  versionPath: string
  minimumVersion: string
  localDevUpdate: ResolvedLocalDevUpdateOptions
  userOnstart?: MultiEnvElectronOptions['onstart']
}): MultiEnvElectronOptions['onstart'] {
  let restartRequested = false
  let startupArgs: Parameters<NonNullable<MultiEnvElectronOptions['onstart']>>[0] | undefined
  let managedElectronApp: typeof process.electronApp

  function createStartupArgs(
    onstartArgs: Parameters<NonNullable<MultiEnvElectronOptions['onstart']>>[0],
  ): Parameters<NonNullable<MultiEnvElectronOptions['onstart']>>[0] {
    return {
      ...onstartArgs,
      startup(argv, options, customElectronPkg) {
        const env = {
          ...process.env,
          ...options?.env,
        }
        delete env.ELECTRON_RUN_AS_NODE

        return onstartArgs.startup(
          argv,
          {
            ...options,
            env,
          },
          customElectronPkg,
        )
      },
    }
  }

  async function start(
    onstartArgs: Parameters<NonNullable<MultiEnvElectronOptions['onstart']>>[0],
    options: { keepInstalledVersion?: boolean } = {},
  ): Promise<void> {
    const safeStartupArgs = createStartupArgs(onstartArgs)
    startupArgs = safeStartupArgs
    await prepareLocalDevUpdateResource({
      ...args,
      keepInstalledVersion: options.keepInstalledVersion,
    })

    if (args.userOnstart) {
      await args.userOnstart(safeStartupArgs)
    } else {
      await safeStartupArgs.startup()
    }

    const electronApp = process.electronApp
    removeManagedListeners()
    managedElectronApp = electronApp
    managedElectronApp?.removeListener('exit', process.exit)
    managedElectronApp?.on('message', handleMessage)
    managedElectronApp?.once('exit', handleExit)
  }

  function handleMessage(message: unknown): void {
    if (message === 'eiu:restart') {
      restartRequested = true
      managedElectronApp?.send?.('eiu:restart-ready')
    }
  }

  function handleExit(): void {
    if (restartRequested) {
      restartRequested = false
      setTimeout(() => {
        if (startupArgs) {
          void start(startupArgs, { keepInstalledVersion: true })
        }
      })
      return
    }
    process.exit()
  }

  function removeManagedListeners(): void {
    managedElectronApp?.removeListener('message', handleMessage)
    managedElectronApp?.removeListener('exit', handleExit)
  }

  return (onstartArgs) => start(onstartArgs)
}
