import { afterAll, describe, expect, it } from 'bun:test'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path/posix'

import {
  aesDecrypt,
  aesEncrypt,
  defaultSignature,
  defaultVerifySignature,
  hashBuffer,
} from '../src/utils/crypto'
import { generateKeyPair } from '../src/vite/utils/key'

let plain = ''

for (let i = 0; i < 1e3; i++) {
  plain += 'hello+world'
}

describe('test aes', () => {
  const k = hashBuffer(Buffer.from(plain, 'utf-8'), 32)
  const iv = hashBuffer(Buffer.from(plain, 'utf-8'), 16)
  it('test', () => {
    const e = aesEncrypt(plain, k, iv)
    expect(aesDecrypt(e, k, iv)).toBe(plain)
  })
})
describe('test verify', async () => {
  const buffer = Buffer.from(plain, 'utf-8')
  const dir = join(__dirname.replace(/\\/g, '/'), '/keys')
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
  const privateKey = readFileSync(privateKeyPath, { encoding: 'utf-8' })
  const cert = readFileSync(certPath, { encoding: 'utf-8' })
  const version = '0.0.0-alpha1'
  const sig = defaultSignature(buffer, privateKey, cert, version)
  it('verify passed', () => {
    expect(defaultVerifySignature(buffer, version, sig, cert)).toBeTruthy()
  })
  it('different buffer will fail to verify', () => {
    expect(defaultVerifySignature(buffer.subarray(1), version, sig, cert)).toBeFalsy()
  })
  it('different signature will fail to verify', () => {
    expect(defaultVerifySignature(buffer, version, `${sig}a`, cert)).toBeFalsy()
  })
  it('different publicKey will fail to verify', () => {
    expect(defaultVerifySignature(buffer, version, sig, `${cert}a`)).toBeFalsy()
  })
  // test('cert variable', async () => {
  //   const filePath = './tests/test-cert.ts'
  //   if (!existsSync(filePath)) {
  //     // await rm(filePath)
  //     await writeFile(filePath, 'import { join } from \'node:path/posix\'')
  //   }
  //   writeCertToMain(filePath, cert)
  // })
  afterAll(() => {
    rmSync(dir, { recursive: true })
  })
})
