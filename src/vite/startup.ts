import type { AnyFunction } from '../utils/type'

/**
 * Filter error messages from stdout/stderr during startup
 * @param args - Startup arguments
 * @param filter - Filter function to determine which messages to show
 */
export async function filterErrorMessageStartup(filter: (msg: string) => boolean): Promise<void> {
  const elec = process.electronApp
  elec.stdout?.addListener('data', (data: Buffer) => {
    console.log(data.toString().trimEnd())
  })
  elec.stderr?.addListener('data', (data: Buffer) => {
    const message = data.toString()
    if (filter(message)) {
      console.error(message)
    }
  })
}

/**
 * Fix Windows character encoding by setting code page to UTF-8
 * @param fn - Function to wrap with encoding fix
 * @returns Wrapped function with Windows encoding fix
 */
export function fixWinCharEncoding<T extends AnyFunction>(fn: T): T {
  return (async (...args) => {
    if (process.platform === 'win32') {
      ;(await import('node:child_process')).spawnSync('chcp', ['65001'])
    }
    await fn(...args)
  }) as T
}
