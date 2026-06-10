import { mock } from 'bun:test'
import type { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { generateKeyPair } from '../src/vite/utils/key'

type NetRequestFactory = () => EventEmitter & {
  abort: () => void
  end: () => void
}

declare global {
  // oxlint-disable-next-line no-var
  var __EIU_TEST_NET_REQUEST_FACTORY__: NetRequestFactory | undefined
}

const electronPackageDir = join(process.cwd(), 'node_modules/electron')
const electronPathFile = join(electronPackageDir, 'path.txt')
const electronExecutablePath = existsSync(electronPathFile)
  ? join(electronPackageDir, 'dist', readFileSync(electronPathFile, 'utf-8'))
  : undefined

mock.module('electron', () => ({
  default: electronExecutablePath,
  app: {
    name: 'test-app',
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
    getVersion: () => '1.0.0',
    isReady: () => false,
    quit: () => {},
    relaunch: () => {},
    setAppUserModelId: () => {},
    setPath: () => {},
    whenReady: async () => {},
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  net: {
    request() {
      if (!globalThis.__EIU_TEST_NET_REQUEST_FACTORY__) {
        throw new Error('No test net request factory configured')
      }
      return globalThis.__EIU_TEST_NET_REQUEST_FACTORY__()
    },
  },
}))

const dir = join(__dirname, 'keys')
const privateKeyPath = join(dir, 'key.pem')
const certPath = join(dir, 'cert.pem')
await generateKeyPair(
  2048,
  [
    { name: 'commonName', value: 'test' },
    { name: 'organizationName', value: 'org.test' },
  ],
  365,
  privateKeyPath,
  certPath,
)
