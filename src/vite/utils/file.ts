import fs from 'node:fs'

import { log } from '../constant'
import type { ElectronOptions } from '../electron/core'

/**
 * Convert byte size to human-readable format
 * @param size - Size in bytes
 * @returns Human-readable size string (e.g., "1.23 MB")
 */
export function readableSize(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0

  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }

  return `${size.toFixed(2)} ${units[i]}`
}

/**
 * Copy file/directory, skipping if target exists
 * @param from - Source path
 * @param to - Destination path
 * @param skipIfExist - Skip copy if destination exists
 */
export function copyAndSkipIfExist(from: string, to: string, skipIfExist: boolean): void {
  if (!skipIfExist || !fs.existsSync(to)) {
    try {
      fs.cpSync(from, to, { recursive: true })
    } catch (error) {
      log.warn(`Copy failed: ${error}`, { timestamp: true })
    }
  }
}

/**
 * Convert entry files to array format
 * @param files - Entry files in various formats
 * @returns Array of file paths
 */
export function resolveInputToArray(files: NonNullable<ElectronOptions['entry']>) {
  if (typeof files === 'string') {
    return [files]
  }
  if (Array.isArray(files)) {
    return files
  }

  return Object.values(files)
}
