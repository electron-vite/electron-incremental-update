import fs from 'node:fs'
import path from 'node:path'

import { createPackage } from '@electron/asar'

import type { UpdateJSON } from '../../utils/version'
import { isUpdateJSON } from '../../utils/version'
import { log } from '../constant'
import type { BuildAsarOptions, BuildVersionOptions } from '../types'

import { readableSize } from './file'

/**
 * Build asar file and update package
 * @param options - Asar build options
 * @returns Buffer of the built asar file
 */
export async function buildAsar(
  root: string,
  {
    version,
    asarOutputPath,
    electronDistPath,
    rendererDistPath,
    compressedPath,
    generateCompressedFile,
  }: BuildAsarOptions,
): Promise<Buffer> {
  electronDistPath = path.resolve(root, electronDistPath)
  asarOutputPath = path.resolve(root, asarOutputPath)
  rendererDistPath = path.resolve(root, rendererDistPath)
  compressedPath = path.resolve(root, compressedPath)

  const rPath = path.join(electronDistPath, 'renderer')
  await fs.promises.cp(rendererDistPath, rPath, { recursive: true })
  fs.writeFileSync(path.join(electronDistPath, 'version'), version)
  await fs.promises.mkdir(path.dirname(asarOutputPath), { recursive: true })
  await createPackage(electronDistPath, asarOutputPath)
  const buf = await generateCompressedFile(fs.readFileSync(asarOutputPath))
  await fs.promises.mkdir(path.dirname(compressedPath), { recursive: true })
  fs.writeFileSync(compressedPath, buf)
  log.info(`Build update asar to '${compressedPath}' [${readableSize(buf.length)}]`, {
    timestamp: true,
  })
  return buf
}

/**
 * Build update.json file with signature and version information
 * @param options - Version build options
 * @param asarBuffer - Buffer of the asar file to sign
 */
export async function buildUpdateJson(
  root: string,
  {
    versionPath,
    privateKey,
    cert,
    version,
    minimumVersion,
    generateSignature,
    generateUpdateJson,
  }: BuildVersionOptions,
  asarBuffer: Buffer,
): Promise<void> {
  const resolvedVersionPath = path.resolve(root, versionPath)
  let _json: UpdateJSON = {
    beta: {
      minimumVersion: version,
      signature: '',
      version,
    },
    minimumVersion: version,
    signature: '',
    version,
  }
  if (fs.existsSync(versionPath)) {
    try {
      const oldVersionJson = JSON.parse(fs.readFileSync(versionPath, 'utf-8'))
      if (isUpdateJSON(oldVersionJson)) {
        _json = oldVersionJson
      } else {
        log.warn('Old version json is invalid, ignore it', { timestamp: true })
      }
    } catch {}
  }

  const sig = await generateSignature(asarBuffer, privateKey, cert, version)

  _json = await generateUpdateJson(_json, sig, version, minimumVersion)
  if (!isUpdateJSON(_json)) {
    throw new Error('Invalid update json')
  }

  await fs.promises.mkdir(path.dirname(resolvedVersionPath), { recursive: true })
  fs.writeFileSync(resolvedVersionPath, JSON.stringify(_json, null, 2))
  log.info(`Build update json to '${resolvedVersionPath}'`, { timestamp: true })
}
