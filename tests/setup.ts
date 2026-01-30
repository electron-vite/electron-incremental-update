import { join } from 'node:path'

import { generateKeyPair } from '../src/vite/utils/key'

const dir = join(__dirname, '/keys')
const privateKeyPath = join(dir, '/keys/key.pem')
const certPath = join(dir, '/keys/cert.pem')
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
