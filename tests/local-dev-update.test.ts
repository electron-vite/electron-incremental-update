import { afterEach, describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createPackage, extractFile } from '@electron/asar'

import { isUpdateJSON } from '../src/utils/version'
import {
  createLocalDevUpdateOnstart,
  prepareLocalDevUpdateResource,
  readValidAsarVersion,
  resolveLocalDevUpdateOptions,
  resolveLocalDevUpdatePackage,
} from '../src/vite/local-dev-update'
import type { BuildAsarOptions, PKG } from '../src/vite/types'

let tempDir: string | undefined

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'eiu-local-dev-update-'))
  return tempDir
}

async function createElectronDist(root: string): Promise<void> {
  const electronDist = path.join(root, 'dist-electron')
  await mkdir(path.join(electronDist, 'main'), { recursive: true })
  await mkdir(path.join(electronDist, 'renderer'), { recursive: true })
  await writeFile(path.join(electronDist, 'main/main.js'), 'module.exports = {}', 'utf-8')
  await writeFile(path.join(electronDist, 'renderer/index.html'), '<div></div>', 'utf-8')
}

async function createVersionAsar(root: string, asarPath: string, version: string): Promise<void> {
  const sourceDir = path.join(root, `asar-source-${version}`)
  await mkdir(sourceDir, { recursive: true })
  await writeFile(path.join(sourceDir, 'version'), version, 'utf-8')
  await createPackage(sourceDir, asarPath)
}

function createBuildAsarOption(): BuildAsarOptions {
  return {
    version: '0.0.1',
    asarOutputPath: 'release/test.asar',
    electronDistPath: 'dist-electron',
    rendererDistPath: 'dist',
    gzipPath: 'release/test-0.0.1.asar.gz',
    generateGzipFile: async (buffer) => buffer,
  }
}

async function readGeneratedUpdateJSON(root: string) {
  const content = await readFile(
    path.join(root, 'release/local-update/release/version.json'),
    'utf-8',
  )
  const json = JSON.parse(content)
  expect(isUpdateJSON(json)).toBe(true)
  return json
}

describe('local dev update helper', () => {
  afterEach(async () => {
    Reflect.deleteProperty(process, 'electronApp')
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  it('generates update json and matching asar archive for the next patch version', async () => {
    const root = await createTempDir()
    await createElectronDist(root)
    await createVersionAsar(root, path.join(root, 'DEV.asar'), '1.2.3')
    const localDevUpdate = resolveLocalDevUpdateOptions(root, true)
    expect(localDevUpdate).toBeDefined()

    const buildAsarOption = createBuildAsarOption()
    const version = await prepareLocalDevUpdateResource({
      root,
      pkg: { name: 'test', version: '0.0.1', main: 'dist-entry/entry.js' },
      buildAsarOption,
      minimumVersion: '0.0.0',
      localDevUpdate: localDevUpdate!,
      versionPath: 'release/version.json',
    })

    const updateJSON = await readGeneratedUpdateJSON(root)
    expect(version).toBe('1.2.4')
    expect(updateJSON.version).toBe('1.2.4')
    expect(updateJSON.signature).toBe('local-dev')
    expect(existsSync(path.join(root, 'release/local-update/test-1.2.4.asar.gz'))).toBe(true)
    expect(
      extractFile(path.join(root, 'release/local-update/test.asar'), 'version')
        .toString('utf-8')
        .trim(),
    ).toBe('1.2.4')
  })

  it('installs a valid pending asar and keeps that version for the managed restart cycle', async () => {
    const root = await createTempDir()
    await createElectronDist(root)
    await createVersionAsar(root, path.join(root, 'DEV.asar'), '1.2.3')
    await createVersionAsar(root, path.join(root, 'DEV.asar.tmp'), '1.2.4')
    const localDevUpdate = resolveLocalDevUpdateOptions(root, true)!
    const buildAsarOption = createBuildAsarOption()

    const version = await prepareLocalDevUpdateResource({
      root,
      pkg: { name: 'test', version: '0.0.1', main: 'dist-entry/entry.js' },
      buildAsarOption,
      minimumVersion: '0.0.0',
      keepInstalledVersion: true,
      localDevUpdate,
      versionPath: 'release/version.json',
    })

    expect(version).toBe('1.2.4')
    expect(readValidAsarVersion(path.join(root, 'DEV.asar'))).toBe('1.2.4')
    expect(existsSync(path.join(root, 'DEV.asar.tmp'))).toBe(false)
    expect((await readGeneratedUpdateJSON(root)).version).toBe('1.2.4')
  })

  it('removes invalid pending asar and continues generating the next patch', async () => {
    const root = await createTempDir()
    await createElectronDist(root)
    await createVersionAsar(root, path.join(root, 'DEV.asar'), '1.2.3')
    await writeFile(path.join(root, 'DEV.asar.tmp'), Buffer.from('invalid asar'))
    const localDevUpdate = resolveLocalDevUpdateOptions(root, true)!
    const buildAsarOption = createBuildAsarOption()

    const version = await prepareLocalDevUpdateResource({
      root,
      pkg: { name: 'test', version: '0.0.1', main: 'dist-entry/entry.js' },
      buildAsarOption,
      minimumVersion: '0.0.0',
      keepInstalledVersion: true,
      localDevUpdate,
      versionPath: 'release/version.json',
    })

    expect(version).toBe('1.2.4')
    expect(readValidAsarVersion(path.join(root, 'DEV.asar'))).toBe('1.2.3')
    expect(existsSync(path.join(root, 'DEV.asar.tmp'))).toBe(false)
  })

  it('prepares local dev updates without creating signing keys', async () => {
    const root = await createTempDir()
    await createElectronDist(root)
    const localDevUpdate = resolveLocalDevUpdateOptions(root, true)!

    await prepareLocalDevUpdateResource({
      root,
      pkg: { name: 'test', version: '0.0.1', main: 'dist-entry/entry.js' },
      buildAsarOption: createBuildAsarOption(),
      minimumVersion: '0.0.0',
      localDevUpdate,
      versionPath: 'release/version.json',
    })

    expect(existsSync(path.join(root, 'keys'))).toBe(false)
  })

  it('reads package metadata from packageJsonPath', async () => {
    const root = await createTempDir()
    const pkg: PKG = {
      name: 'example-app',
      version: '2.0.0',
      main: 'dist-entry/entry.js',
    }
    await writeFile(path.join(root, 'app-package.json'), JSON.stringify(pkg), 'utf-8')
    const localDevUpdate = resolveLocalDevUpdateOptions(root, {
      packageJsonPath: 'app-package.json',
    })!

    await expect(
      resolveLocalDevUpdatePackage(
        { name: 'fallback', version: '0.0.1', main: 'dist-entry/entry.js' },
        localDevUpdate,
      ),
    ).resolves.toEqual(pkg)
  })

  it('replaces managed child process listeners when dev startup runs again', async () => {
    const root = await createTempDir()
    await createElectronDist(root)
    const localDevUpdate = resolveLocalDevUpdateOptions(root, true)!
    const electronApp = new EventEmitter() as EventEmitter & {
      send: (message: string) => boolean
    }
    electronApp.send = () => true
    const onstart = createLocalDevUpdateOnstart({
      root,
      pkg: { name: 'test', version: '0.0.1', main: 'dist-entry/entry.js' },
      buildAsarOption: createBuildAsarOption(),
      minimumVersion: '0.0.0',
      localDevUpdate,
      versionPath: 'release/version.json',
    })
    const startupArgs = {
      reload: () => {},
      startup: async () => {
        electronApp.on('exit', process.exit)
        process.electronApp = electronApp as typeof process.electronApp
        return true
      },
    }

    await onstart!(startupArgs)
    await onstart!(startupArgs)

    expect(electronApp.listenerCount('message')).toBe(1)
    expect(electronApp.listenerCount('exit')).toBe(1)
  })

  it('removes ELECTRON_RUN_AS_NODE before starting the Electron app', async () => {
    const root = await createTempDir()
    await createElectronDist(root)
    const localDevUpdate = resolveLocalDevUpdateOptions(root, true)!
    const electronApp = new EventEmitter() as typeof process.electronApp
    const previousElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE
    let startupEnv: NodeJS.ProcessEnv | undefined
    const onstart = createLocalDevUpdateOnstart({
      root,
      pkg: { name: 'test', version: '0.0.1', main: 'dist-entry/entry.js' },
      buildAsarOption: createBuildAsarOption(),
      minimumVersion: '0.0.0',
      localDevUpdate,
      versionPath: 'release/version.json',
    })

    try {
      process.env.ELECTRON_RUN_AS_NODE = '1'
      await onstart!({
        reload: () => {},
        startup: async (_, options) => {
          startupEnv = options?.env as NodeJS.ProcessEnv | undefined
          electronApp.on('exit', process.exit)
          process.electronApp = electronApp
          return true
        },
      })

      expect(startupEnv?.ELECTRON_RUN_AS_NODE).toBeUndefined()
    } finally {
      if (previousElectronRunAsNode === undefined) {
        delete process.env.ELECTRON_RUN_AS_NODE
      } else {
        process.env.ELECTRON_RUN_AS_NODE = previousElectronRunAsNode
      }
    }
  })
})
