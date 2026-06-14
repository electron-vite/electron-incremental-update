import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DownloadingInfo } from '../src/provider/types'

let tempDir: string | undefined

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'eiu-local-provider-'))
  return tempDir
}

async function createProvider(
  baseDir: string,
  options: { chunkDelay?: number; chunkSize?: number } = {},
) {
  const { LocalDevProvider } = await import('../src/provider/local')
  return new LocalDevProvider({ baseDir, ...options })
}

async function writeUpdateJSON(baseDir: string, content: unknown): Promise<void> {
  await mkdir(join(baseDir, 'release'), { recursive: true })
  await writeFile(join(baseDir, 'release/version.json'), JSON.stringify(content), 'utf-8')
}

describe('LocalDevProvider', () => {
  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  it('should read update json and resolve local asar paths', async () => {
    const baseDir = await createTempDir()
    await writeUpdateJSON(baseDir, {
      version: '1.2.3',
      minimumVersion: '1.0.0',
      signature: 'stable-signature',
      beta: {
        version: '1.3.0-beta.1',
        minimumVersion: '1.0.0',
        signature: 'beta-signature',
      },
    })

    const provider = await createProvider(baseDir)
    const result = await provider.downloadJSON(
      'test',
      'release/version.json',
      new AbortController().signal,
    )

    expect(result).toEqual({
      version: '1.2.3',
      minimumVersion: '1.0.0',
      signature: 'stable-signature',
      url: join(baseDir, 'test-1.2.3.asar.br'),
      beta: {
        version: '1.3.0-beta.1',
        minimumVersion: '1.0.0',
        signature: 'beta-signature',
        url: join(baseDir, 'test-1.3.0-beta.1.asar.br'),
      },
    })
  })

  it('should read local asar file and report simulated download progress', async () => {
    const baseDir = await createTempDir()
    const fileBuffer = Buffer.from('compressed asar content with multiple chunks')
    const provider = await createProvider(baseDir, { chunkDelay: 0, chunkSize: 8 })
    const progressEvents: DownloadingInfo[] = []

    await writeFile(join(baseDir, 'test-1.2.3.asar.br'), fileBuffer)

    const result = await provider.downloadAsar(
      {
        version: '1.2.3',
        minimumVersion: '1.0.0',
        signature: 'signature',
        url: join(baseDir, 'test-1.2.3.asar.br'),
      },
      new AbortController().signal,
      (info) => progressEvents.push(info),
    )

    expect(result).toEqual(fileBuffer)
    expect(progressEvents.length).toBeGreaterThan(1)
    expect(progressEvents.at(-1)).toMatchObject({
      percent: 100,
      total: fileBuffer.length,
      transferred: fileBuffer.length,
    })
    expect(progressEvents.every((event) => event.total === fileBuffer.length)).toBe(true)
  })

  it('should skip signature verification for local dev updates', async () => {
    const baseDir = await createTempDir()
    const provider = await createProvider(baseDir)

    await expect(
      provider.verifySignature(Buffer.from('invalid'), '1.2.3', 'invalid', 'invalid'),
    ).resolves.toBe(true)
  })

  it('should reject invalid update json', async () => {
    const baseDir = await createTempDir()
    await writeUpdateJSON(baseDir, {
      version: '1.2.3',
    })

    const provider = await createProvider(baseDir)

    await expect(
      provider.downloadJSON('test', 'release/version.json', new AbortController().signal),
    ).rejects.toThrow('Invalid update json')
  })

  it('should reject invalid progress simulation options', async () => {
    const baseDir = await createTempDir()

    await expect(createProvider(baseDir, { chunkSize: 0 })).rejects.toThrow(
      'localDevUpdate.chunkSize must be greater than 0',
    )
    await expect(createProvider(baseDir, { chunkDelay: -1 })).rejects.toThrow(
      'localDevUpdate.chunkDelay must be greater than or equal to 0',
    )
  })
})
