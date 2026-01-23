import fs from 'node:fs'
import path from 'node:path'
import { generate } from 'selfsigned'

import { log } from './constant'

export interface DistinguishedName {
  countryName?: string
  stateOrProvinceName?: string
  localityName?: string
  organizationName?: string
  organizationalUnitName?: string
  commonName?: string
  serialNumber?: string
  title?: string
  description?: string
  businessCategory?: string
  emailAddress?: string
}
export type CertSubject = {
  name: string
  value: string
}[]

export async function generateKeyPair(
  keyLength: number,
  subject: CertSubject,
  days: number,
  privateKeyPath: string,
  certPath: string,
): Promise<void> {
  const privateKeyDir = path.dirname(privateKeyPath)
  if (!fs.existsSync(privateKeyDir)) {
    fs.mkdirSync(privateKeyDir, { recursive: true })
  }

  const certDir = path.dirname(certPath)
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true })
  }

  const startDate = new Date()
  const endDate = new Date(startDate)
  endDate.setDate(startDate.getDate() + days)

  const { cert, private: privateKey } = await generate(subject, {
    keySize: keyLength,
    algorithm: 'sha256',
    notBeforeDate: startDate,
    notAfterDate: endDate,
  })

  fs.writeFileSync(privateKeyPath, privateKey.replace(/\r\n?/g, '\n'))
  fs.writeFileSync(certPath, cert.replace(/\r\n?/g, '\n'))
}

export interface GetKeysOption {
  privateKeyPath: string
  certPath: string
  keyLength: number
  subject: DistinguishedName
  days: number
}

export async function parseKeys({
  keyLength,
  privateKeyPath,
  certPath,
  subject,
  days,
}: GetKeysOption): Promise<{ privateKey: string; cert: string }> {
  const keysDir = path.dirname(privateKeyPath)
  let privateKey = process.env.UPDATER_PK
  let cert = process.env.UPDATER_CERT

  if (privateKey && cert) {
    log.info('Use `UPDATER_PK` and `UPDATER_CERT` from environment variables', { timestamp: true })
    return { privateKey, cert }
  }

  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir)
  }

  if (!fs.existsSync(privateKeyPath) || !fs.existsSync(certPath)) {
    log.info('No key pair found, generate new key pair', { timestamp: true })
    await generateKeyPair(keyLength, parseSubjects(subject), days, privateKeyPath, certPath)
  }

  privateKey = fs.readFileSync(privateKeyPath, 'utf-8')
  cert = fs.readFileSync(certPath, 'utf-8')

  return { privateKey, cert }
}

function parseSubjects(subject: DistinguishedName): CertSubject {
  return Object.entries(subject)
    .filter(([_, value]) => !!value)
    .map(([name, value]) => ({ name, value }))
}
