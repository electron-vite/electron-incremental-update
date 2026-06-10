import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  DownloadingInfo,
  IProvider,
  UpdateInfoWithURL,
  VersionJSON,
} from '../src/provider/types'

const testState = {
  appVersion: '1.0.0',
  entryVersion: '1.0.0',
  isDev: false,
  restartCount: 0,
  tempDir: '',
}

;(globalThis as any).__EIU_SIGNATURE_CERT__ = 'test-cert'
;(globalThis as any).__EIU_VERSION_PATH__ = 'release/version.json'

mock.module('../src/utils/electron', () => ({
  getAppVersion: () => testState.appVersion,
  getEntryVersion: () => testState.entryVersion,
  getPathFromAppNameAsar: (...paths: string[]) =>
    path.join(testState.tempDir, 'app.asar', ...paths),
  isDev: testState.isDev,
  restartApp: () => {
    testState.restartCount += 1
  },
}))

let UpdaterModule: typeof import('../src/entry/updater')

class MockProvider implements IProvider {
  public name = 'MockProvider'
  public jsonCalls = 0
  public asarCalls = 0
  public verifyResult = true
  public asarBuffer = Buffer.from('compressed-update')
  public unzippedBuffer = Buffer.from('asar-update')
  public versionJSON: VersionJSON = {
    version: '1.1.0',
    minimumVersion: '1.0.0',
    signature: 'stable-signature',
    url: 'https://example.com/test-app-1.1.0.asar.gz',
    beta: {
      version: '1.2.0-beta.1',
      minimumVersion: '1.0.0',
      signature: 'beta-signature',
      url: 'https://example.com/test-app-1.2.0-beta.1.asar.gz',
    },
  }

  public async downloadJSON(): Promise<VersionJSON> {
    this.jsonCalls += 1
    return this.versionJSON
  }

  public async downloadAsar(
    _info: UpdateInfoWithURL,
    _signal: AbortSignal,
    onDownloading?: (info: DownloadingInfo) => void,
  ): Promise<Buffer> {
    this.asarCalls += 1
    onDownloading?.({
      bps: this.asarBuffer.length,
      delta: this.asarBuffer.length,
      percent: 100,
      total: this.asarBuffer.length,
      transferred: this.asarBuffer.length,
    })
    return this.asarBuffer
  }

  public isLowerVersion(oldVer: string, newVer: string): boolean {
    return oldVer < newVer
  }

  public async unzipFile(): Promise<Buffer> {
    return this.unzippedBuffer
  }

  public verifySignaure(): boolean {
    return this.verifyResult
  }
}

beforeAll(async () => {
  UpdaterModule = await import('../src/entry/updater')
})

describe('Updater', () => {
  afterEach(async () => {
    if (testState.tempDir) {
      await rm(testState.tempDir, { recursive: true, force: true })
    }
    testState.appVersion = '1.0.0'
    testState.entryVersion = '1.0.0'
    testState.isDev = false
    testState.restartCount = 0
    testState.tempDir = ''
  })

  it('emits update events and writes the downloaded asar to the temp install path', async () => {
    testState.tempDir = await mkdtemp(path.join(tmpdir(), 'eiu-updater-'))
    const provider = new MockProvider()
    const updater = new UpdaterModule.Updater({ provider })
    const events: string[] = []
    const progressEvents: DownloadingInfo[] = []

    updater.on('update-available', (info) => {
      events.push(`available:${info.version}:${info.appVersion}:${info.entryVersion}`)
    })
    updater.on('download-progress', (info) => progressEvents.push(info))
    updater.on('update-downloaded', () => events.push('downloaded'))

    await expect(updater.checkForUpdates()).resolves.toBe(true)
    await expect(updater.downloadUpdate()).resolves.toBe(true)

    await expect(readFile(path.join(testState.tempDir, 'app.asar.tmp'))).resolves.toEqual(
      provider.unzippedBuffer,
    )
    expect(events).toEqual(['available:1.1.0:1.0.0:1.0.0', 'downloaded'])
    expect(progressEvents).toHaveLength(1)
    expect(provider.jsonCalls).toBe(1)
    expect(provider.asarCalls).toBe(1)
  })

  it('uses beta update information when receiveBeta is enabled', async () => {
    testState.tempDir = await mkdtemp(path.join(tmpdir(), 'eiu-updater-'))
    const provider = new MockProvider()
    const updater = new UpdaterModule.Updater({ provider, receiveBeta: true })
    const availableVersions: string[] = []

    updater.on('update-available', (info) => availableVersions.push(info.version))

    await expect(updater.checkForUpdates()).resolves.toBe(true)

    expect(availableVersions).toEqual(['1.2.0-beta.1'])
  })

  it('emits update-not-available when the app is already up to date', async () => {
    testState.tempDir = await mkdtemp(path.join(tmpdir(), 'eiu-updater-'))
    testState.appVersion = '1.1.0'
    const provider = new MockProvider()
    const updater = new UpdaterModule.Updater({ provider })
    const unavailable: string[] = []

    updater.on('update-not-available', (code, message) => unavailable.push(`${code}:${message}`))

    await expect(updater.checkForUpdates()).resolves.toBe(false)

    expect(unavailable).toHaveLength(1)
    expect(unavailable[0]).toStartWith('UNAVAILABLE_VERSION:')
  })

  it('emits an error and does not write an asar when signature validation fails', async () => {
    testState.tempDir = await mkdtemp(path.join(tmpdir(), 'eiu-updater-'))
    const provider = new MockProvider()
    provider.verifyResult = false
    const updater = new UpdaterModule.Updater({ provider })
    const errors: string[] = []

    updater.on('error', (error) => errors.push(error.code))

    await expect(updater.checkForUpdates()).resolves.toBe(true)
    await expect(updater.downloadUpdate()).resolves.toBe(false)

    expect(errors).toEqual(['ERR_VALIDATE'])
    await expect(readFile(path.join(testState.tempDir, 'app.asar.tmp'))).rejects.toThrow()
  })

  it('cancels an in-flight download and can check for updates again', async () => {
    testState.tempDir = await mkdtemp(path.join(tmpdir(), 'eiu-updater-'))
    const provider = new MockProvider()
    provider.downloadAsar = async (_info, signal) => {
      provider.asarCalls += 1
      return await new Promise<Buffer>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
        setTimeout(() => resolve(provider.asarBuffer), 50)
      })
    }
    const updater = new UpdaterModule.Updater({ provider })
    const cancelled: string[] = []
    const errors: string[] = []

    updater.on('update-cancelled', () => cancelled.push('cancelled'))
    updater.on('error', (error) => errors.push(error.code))

    await expect(updater.checkForUpdates()).resolves.toBe(true)
    const download = updater.downloadUpdate()
    updater.cancel()

    await expect(download).resolves.toBe(false)
    await expect(updater.checkForUpdates()).resolves.toBe(true)

    expect(cancelled).toEqual(['cancelled'])
    expect(errors).toEqual(['ERR_NETWORK'])
  })
})
