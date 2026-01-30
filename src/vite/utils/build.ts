import { createPackage } from '@electron/asar'
import fs from 'node:fs'
import path from 'node:path'

import type { UpdateJSON } from '../../utils/version'
import type { _BuildAsarOption, _BuildVersionOption } from '../option'

import { isUpdateJSON } from '../../utils/version'
import { log } from '../constant'
import { readableSize } from './file'

/**
 * Build asar file and update package
 * @param options - Asar build options
 * @returns Buffer of the built asar file
 */
export async function buildAsar({
  version,
  asarOutputPath,
  gzipPath,
  electronDistPath,
  rendererDistPath,
  generateGzipFile,
}: _BuildAsarOption): Promise<Buffer> {
  const rPath = path.join(electronDistPath, 'renderer')
  await fs.promises.cp(rendererDistPath, rPath, { recursive: true })
  fs.writeFileSync(path.join(electronDistPath, 'version'), version)
  await createPackage(electronDistPath, asarOutputPath)
  const buf = await generateGzipFile(fs.readFileSync(asarOutputPath))
  fs.writeFileSync(gzipPath, buf)
  log.info(`Build update asar to '${gzipPath}' [${readableSize(buf.length)}]`, { timestamp: true })
  return buf
}

/**
 * Build update.json file with signature and version information
 * @param options - Version build options
 * @param asarBuffer - Buffer of the asar file to sign
 */
export async function buildUpdateJson(
  {
    versionPath,
    privateKey,
    cert,
    version,
    minimumVersion,
    generateSignature,
    generateUpdateJson,
  }: _BuildVersionOption,
  asarBuffer: Buffer,
): Promise<void> {
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

  fs.writeFileSync(versionPath, JSON.stringify(_json, null, 2))
  log.info(`build update json to '${versionPath}'`, { timestamp: true })
}
