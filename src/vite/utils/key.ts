import fs from 'node:fs'
import path from 'node:path'

import { generate } from 'selfsigned'

import { log } from '../constant'

/**
 * Distinguished name for certificate generation
 */
export interface DistinguishedName {
  /** Country name (2-letter code) */
  countryName?: string
  /** State or province name */
  stateOrProvinceName?: string
  /** Locality/city name */
  localityName?: string
  /** Organization name */
  organizationName?: string
  /** Organizational unit name */
  organizationalUnitName?: string
  /** Common name */
  commonName?: string
  /** Serial number */
  serialNumber?: string
  /** Title */
  title?: string
  /** Description */
  description?: string
  /** Business category */
  businessCategory?: string
  /** Email address */
  emailAddress?: string
}

/** Certificate subject name-value pairs */
export type CertSubject = {
  name: string
  value: string
}[]

/**
 * Generate a new key pair for signing
 * @param keyLength - Key length in bits
 * @param subject - Certificate subject
 * @param days - Validity period in days
 * @param privateKeyPath - Output path for private key
 * @param certPath - Output path for certificate
 */
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

/** Options for parsing keys */
export interface GetKeysOption {
  /** Path to private key file */
  privateKeyPath: string
  /** Path to certificate file */
  certPath: string
  /** Key length for generation */
  keyLength: number
  /** Certificate subject */
  subject: DistinguishedName
  /** Validity period in days */
  days: number
}

/**
 * Parse and load keys, generating new ones if they don't exist
 * @param options - Key parsing options
 * @returns Object containing private key and certificate strings
 */
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

/**
 * Convert DistinguishedName object to CertSubject array
 * @param subject - Distinguished name object
 * @returns Certificate subject array
 */
function parseSubjects(subject: DistinguishedName): CertSubject {
  return Object.entries(subject)
    .filter(([_, value]) => !!value)
    .map(([name, value]) => ({ name, value }))
}
