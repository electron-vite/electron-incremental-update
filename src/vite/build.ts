import type { InlineConfig } from 'vite'

import { createPackage } from '@electron/asar'
import fs from 'node:fs'
import path from 'node:path'
import { mergeConfig } from 'vite'

import type { UpdateJSON } from '../utils/version'
import type { BytecodeOptions } from './bytecode'
import type { BuildAsarOption, BuildEntryOption, BuildVersionOption } from './option'

import { isUpdateJSON } from '../utils/version'
import { bytecodePlugin } from './bytecode'
import { log } from './constant'
import { build } from './electron/core'
import { readableSize } from './utils'

export async function buildAsar({
  version,
  asarOutputPath,
  gzipPath,
  electronDistPath,
  rendererDistPath,
  generateGzipFile,
}: BuildAsarOption): Promise<Buffer> {
  fs.renameSync(rendererDistPath, path.join(electronDistPath, 'renderer'))
  fs.writeFileSync(path.join(electronDistPath, 'version'), version)
  await createPackage(electronDistPath, asarOutputPath)
  const buf = await generateGzipFile(fs.readFileSync(asarOutputPath))
  fs.writeFileSync(gzipPath, buf)
  log.info(`Build update asar to '${gzipPath}' [${readableSize(buf.length)}]`, { timestamp: true })
  return buf
}

export async function buildUpdateJson(
  {
    versionPath,
    privateKey,
    cert,
    version,
    minimumVersion,
    generateSignature,
    generateUpdateJson,
  }: BuildVersionOption,
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

export async function buildEntry(
  {
    sourcemap,
    minify,
    files,
    outDir,
    ignoreDynamicRequires,
    external,
    vite,
  }: Required<Omit<BuildEntryOption, 'postBuild'>>,
  isESM: boolean,
  define: Record<string, string>,
  bytecodeOptions: BytecodeOptions | undefined,
): Promise<void> {
  await build({
    entry: files,
    vite: mergeConfig<InlineConfig, InlineConfig>(
      {
        plugins: [bytecodeOptions && bytecodePlugin('main', bytecodeOptions)],
        build: {
          sourcemap,
          minify,
          outDir,
          emptyOutDir: true,
          rolldownOptions: {
            external,
            platform: 'node',
            output: {
              polyfillRequire: false,
              format: isESM ? 'esm' : 'cjs',
              dynamicImportInCjs: !ignoreDynamicRequires,
            },
          },
        },
        define,
      },
      vite ?? {},
    ),
  })
}
