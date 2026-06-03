import { builtinModules } from 'node:module'

import { createLogger } from 'vite'

export const id = 'electron-incremental-update'
export const bytecodeId = `${id}-bytecode`

export const log = createLogger('info', { prefix: `[${id}]` })

export const bytecodeLog = createLogger('info', { prefix: `[${bytecodeId}]` })

export const defaultExternal: (string | RegExp)[] = [
  ...builtinModules,
  'electron',
  'electron/common',
  'electron/main',
  'electron/renderer',
  'electron/utility',
  /^node:/,
  /.*\.(node|dll|dylib|so)$/,
  'original-fs',
]
