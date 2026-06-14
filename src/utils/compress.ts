import zlib from 'node:zlib'

/**
 * Default function to compress file using brotli
 * @param buffer uncompressed file buffer
 */
export async function defaultCompressFile(buffer: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    zlib.brotliCompress(buffer, (err, buffer) => (err ? reject(err) : resolve(buffer)))
  })
}

/**
 * Default function to decompress file using brotli
 * @param buffer compressed file buffer
 */
export async function defaultDecompressFile(buffer: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    zlib.brotliDecompress(buffer, (err, buffer) => (err ? reject(err) : resolve(buffer)))
  })
}
