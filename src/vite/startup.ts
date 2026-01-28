import type { AnyFunction } from '@subframe7536/type-utils'
import type { ChildProcessWithoutNullStreams, StdioOptions } from 'node:child_process'

import type { ElectronOptions } from './electron/core'

type StartupFn = NonNullable<ElectronOptions['onstart']>

/**
 * Debug mode startup function
 * Automatically starts Electron in VSCode debug mode
 * @param args - Startup arguments
 */
export async function debugStartup(args: Parameters<StartupFn>[0]): Promise<void> {
  if (process.env.VSCODE_DEBUG) {
    console.log('[startup] Electron App')
  } else {
    await args.startup()
  }
}

/**
 * Filter error messages from stdout/stderr during startup
 * @param args - Startup arguments
 * @param filter - Filter function to determine which messages to show
 */
export async function filterErrorMessageStartup(
  args: Parameters<StartupFn>[0],
  filter: (msg: string) => boolean,
): Promise<void> {
  const stdio: StdioOptions =
    process.platform === 'linux'
      ? ['inherit', 'pipe', 'pipe', 'ignore', 'ipc']
      : ['inherit', 'pipe', 'pipe', 'ipc']
  await args.startup(undefined, { stdio })
  const elec = (process as unknown as { electronApp: ChildProcessWithoutNullStreams }).electronApp
  elec.stdout.addListener('data', (data: Buffer) => {
    console.log(data.toString().trimEnd())
  })
  elec.stderr.addListener('data', (data: Buffer) => {
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
