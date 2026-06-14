import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { BuildAsarOptions, BuildVersionOptions } from '../src/vite/types'
import { buildAsar, buildUpdateJson } from '../src/vite/utils/build'

let tempDir: string | undefined

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'eiu-build-utils-'))
  return tempDir
}

async function createBuildInputs(root: string): Promise<void> {
  await mkdir(path.join(root, 'dist-electron/main'), { recursive: true })
  await mkdir(path.join(root, 'dist'), { recursive: true })
  await writeFile(path.join(root, 'dist-electron/main/main.js'), 'module.exports = {}', 'utf-8')
  await writeFile(path.join(root, 'dist/index.html'), '<main></main>', 'utf-8')
}

describe('build utils', () => {
  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  it('creates nested output directories for asar and compressed update archives', async () => {
    const root = await createTempDir()
    await createBuildInputs(root)
    const options: BuildAsarOptions = {
      version: '1.0.0',
      asarOutputPath: 'nested/asar/test.asar',
      compressedPath: 'nested/archive/test-1.0.0.asar.br',
      electronDistPath: 'dist-electron',
      rendererDistPath: 'dist',
      generateCompressedFile: async (buffer) => buffer,
    }

    await buildAsar(root, options)

    expect(existsSync(path.join(root, options.asarOutputPath))).toBe(true)
    expect(existsSync(path.join(root, options.compressedPath))).toBe(true)
  })

  it('creates nested output directories for version json', async () => {
    const root = await createTempDir()
    const versionPath = path.join(root, 'nested/version/release/version.json')
    const options: BuildVersionOptions = {
      version: '1.0.0',
      minimumVersion: '0.0.0',
      privateKey: '',
      cert: '',
      versionPath,
      generateSignature: async () => 'signature',
      generateUpdateJson: (existingJson, signature, version, minimumVersion) => ({
        ...existingJson,
        version,
        minimumVersion,
        signature,
        beta: {
          version,
          minimumVersion,
          signature,
        },
      }),
    }

    await buildUpdateJson(options, Buffer.from('asar'))

    const json = JSON.parse(await readFile(versionPath, 'utf-8'))
    expect(json.version).toBe('1.0.0')
    expect(json.signature).toBe('signature')
  })
})
