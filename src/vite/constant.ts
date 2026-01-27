import { createLogger } from 'vite'

export const id = 'electron-incremental-updater'
export const bytecodeId = `${id}-bytecode`

export const log = createLogger('info', { prefix: `[${id}]` })

export const bytecodeLog = createLogger('info', { prefix: `[${bytecodeId}]` })
