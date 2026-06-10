import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'

const nextResponse = {
  body: '',
  headers: {} as Record<string, string>,
  statusCode: 200,
  statusMessage: 'OK',
}

describe('download utils', () => {
  it('rejects non-success HTTP responses before parsing update json', async () => {
    nextResponse.statusCode = 404
    nextResponse.statusMessage = 'Not Found'
    nextResponse.body = '<html>missing update json</html>'
    globalThis.__EIU_TEST_NET_REQUEST_FACTORY__ = () => {
      const request = new EventEmitter() as EventEmitter & {
        abort: () => void
        end: () => void
      }
      request.abort = () => request.emit('error', new Error('Aborted'))
      request.end = () => {
        queueMicrotask(() => {
          const response = new EventEmitter() as EventEmitter & {
            headers: Record<string, string>
            statusCode: number
            statusMessage: string
          }
          response.headers = nextResponse.headers
          response.statusCode = nextResponse.statusCode
          response.statusMessage = nextResponse.statusMessage
          request.emit('response', response)
          response.emit('data', Buffer.from(nextResponse.body))
          response.emit('end')
        })
      }
      return request
    }

    const { defaultDownloadUpdateJSON } = await import('../src/utils/download')

    await expect(
      defaultDownloadUpdateJSON(
        'https://example.com/release/version.json',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(
      'Unexpected response status 404 Not Found from https://example.com/release/version.json: "<html>missing update json</html>"',
    )
    globalThis.__EIU_TEST_NET_REQUEST_FACTORY__ = undefined
  })
})
