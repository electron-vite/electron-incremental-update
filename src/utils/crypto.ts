import crypto from 'node:crypto'

export function hashBuffer(data: string | Buffer, length: number): Buffer {
  const hash = crypto.createHash('SHA256').update(data).digest('binary')
  return Buffer.from(hash).subarray(0, length)
}

export function aesEncrypt(plainText: string, key: Buffer, iv: Buffer): string {
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  return cipher.update(plainText, 'utf8', 'base64url') + cipher.final('base64url')
}

/**
 * Default function to generate asar signature, returns generated signature
 * @param buffer file buffer
 * @param privateKey primary key
 * @param cert certificate
 * @param version target version
 */
export function defaultSignature(
  buffer: Buffer,
  privateKey: string,
  cert: string,
  version: string,
): string {
  const sig = crypto
    .createSign('RSA-SHA256')
    .update(buffer)
    .sign(crypto.createPrivateKey(privateKey), 'base64')

  return aesEncrypt(`${sig}%${version}`, hashBuffer(cert, 32), hashBuffer(buffer, 16))
}

export function aesDecrypt(encryptedText: string, key: Buffer, iv: Buffer): string {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  return decipher.update(encryptedText, 'base64url', 'utf8') + decipher.final('utf8')
}

/**
 * Default function to verify asar signature,
 * if signature is valid, returns the version, otherwise returns `undefined`
 * @param buffer file buffer
 * @param version target version
 * @param signature signature
 * @param cert certificate
 */
export function defaultVerifySignature(
  buffer: Buffer,
  version: string,
  signature: string,
  cert: string,
): boolean {
  try {
    const [sig, ver] = aesDecrypt(signature, hashBuffer(cert, 32), hashBuffer(buffer, 16)).split(
      '%',
    )
    if (ver !== version) {
      return false
    }
    return crypto.createVerify('RSA-SHA256').update(buffer).verify(cert, sig, 'base64')
  } catch {
    return false
  }
}
