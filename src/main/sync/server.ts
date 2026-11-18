import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SYNC_LIMITS } from '@shared/sync/protocol'

export interface SyncHttpRequest {
  method: string
  path: string
  headers: Readonly<Record<string, string | undefined>>
  body: Buffer
  remoteAddress: string
}

export interface SyncHttpResponse {
  status: number
  body: unknown
}

export type SyncDispatcher = (request: SyncHttpRequest) => Promise<SyncHttpResponse>

export interface SyncServerOptions {
  dispatcher: SyncDispatcher
  clock?: () => number
  ratePerMinute?: number
  pairRatePerMinute?: number
  requestBytes?: number
}

interface RateEntry {
  windowStart: number
  count: number
}

const WINDOW_MS = 60_000

function headerOf(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer | 'too_large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        resolve('too_large')
        request.resume()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

/**
 * 传输层：只负责生命周期、请求体上限、限流与单飞锁；业务路由由 dispatcher 决定。
 * 测试使用 port=0 由系统分配，生产监听 0.0.0.0（仅互通开启时）。
 */
export class SyncServer {
  private server: Server | undefined
  private port = 0
  private readonly busy = new Set<string>()
  private readonly hits = new Map<string, RateEntry>()
  private readonly clock: () => number
  private readonly ratePerMinute: number
  private readonly pairRatePerMinute: number
  private readonly requestBytes: number

  constructor(private readonly options: SyncServerOptions) {
    this.clock = options.clock ?? (() => Date.now())
    this.ratePerMinute = options.ratePerMinute ?? SYNC_LIMITS.ratePerMinute
    this.pairRatePerMinute = options.pairRatePerMinute ?? 10
    this.requestBytes = options.requestBytes ?? SYNC_LIMITS.requestBytes
  }

  get isListening(): boolean {
    return this.server !== undefined
  }

  address(): { port: number } | undefined {
    return this.server ? { port: this.port } : undefined
  }

  async start(options?: { port?: number; host?: string }): Promise<{ port: number }> {
    if (this.server) return { port: this.port }
    const server = createServer((request, response) => {
      void this.handle(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      server.once('error', onError)
      server.listen(options?.port ?? 0, options?.host ?? '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })
    this.server = server
    const address = server.address() as AddressInfo | null
    this.port = address?.port ?? 0
    return { port: this.port }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.busy.clear()
    this.hits.clear()
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private take(key: string, limit: number): boolean {
    const now = this.clock()
    const entry = this.hits.get(key)
    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      this.hits.set(key, { windowStart: now, count: 1 })
      return true
    }
    entry.count += 1
    return entry.count <= limit
  }

  private async handle(request: IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
    const method = request.method ?? 'GET'
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const deviceId = headerOf(request.headers['x-pa-device'])
    const isPairPath = path.startsWith('/sync/v1/pair/')
    const isSyncOp = path.startsWith('/sync/v1/') && path !== '/sync/v1/health' && !isPairPath

    const respond = (status: number, body: unknown): void => {
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      })
      response.end(JSON.stringify(body))
    }

    const length = Number(headerOf(request.headers['content-length']) ?? 0)
    if (Number.isFinite(length) && length > this.requestBytes) {
      request.resume()
      respond(413, { errorCode: 'E_M_PAYLOAD_TOO_LARGE' })
      return
    }

    const rateKey = isPairPath ? `pair:${request.socket.remoteAddress ?? 'unknown'}` : deviceId ?? request.socket.remoteAddress ?? 'unknown'
    if (!this.take(rateKey, isPairPath ? this.pairRatePerMinute : this.ratePerMinute)) {
      request.resume()
      respond(429, { errorCode: 'E_M_SYNC_BUSY' })
      return
    }

    const body = await readBody(request, this.requestBytes)
    if (body === 'too_large') {
      respond(413, { errorCode: 'E_M_PAYLOAD_TOO_LARGE' })
      return
    }

    const lockKey = isSyncOp && deviceId !== undefined ? deviceId : undefined
    if (lockKey !== undefined) {
      if (this.busy.has(lockKey)) {
        respond(409, { errorCode: 'E_M_SYNC_BUSY' })
        return
      }
      this.busy.add(lockKey)
    }

    try {
      const result = await this.options.dispatcher({
        method,
        path,
        headers: request.headers as Record<string, string | undefined>,
        body,
        remoteAddress: request.socket.remoteAddress ?? 'unknown'
      })
      respond(result.status, result.body)
    } catch {
      respond(500, { errorCode: 'E_M_STORE_WRITE_FAIL' })
    } finally {
      if (lockKey !== undefined) this.busy.delete(lockKey)
    }
  }
}