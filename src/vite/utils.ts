import fs from 'node:fs'

import type { ElectronOptions } from './electron/core'

import { log } from './constant'

export function readableSize(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0

  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }

  return `${size.toFixed(2)} ${units[i]}`
}

export function copyAndSkipIfExist(from: string, to: string, skipIfExist: boolean): void {
  if (!skipIfExist || !fs.existsSync(to)) {
    try {
      fs.cpSync(from, to, { recursive: true })
    } catch (error) {
      log.warn(`Copy failed: ${error}`, { timestamp: true })
    }
  }
}

export function resolveInputToArray(files: NonNullable<ElectronOptions['entry']>) {
  if (typeof files === 'string') {
    return [files]
  }
  if (Array.isArray(files)) {
    return files
  }

  return Object.values(files)
}
