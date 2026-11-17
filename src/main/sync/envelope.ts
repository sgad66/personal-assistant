import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { syncFail, syncOk, type SyncResult } from '@shared/sync/errors'
import type { SyncEnvelope } from '@shared/sync/protocol'

const HKDF_SALT = Buffer.from('pa-sync-v1', 'utf-8')
const C2M_INFO = Buffer.from('pa-c2m-v1', 'utf-8')
const M2C_INFO = Buffer.from('pa-m2c-v1', 'utf-8')

export interface ChannelKeys {
  c2mKey: Buffer
  m2cKey: Buffer
}

export function deriveChannelKeys(deviceSecret: string): ChannelKeys {
  const ikm = Buffer.from(deviceSecret, 'utf-8')
  const c2mKey = Buffer.from(hkdfSync('sha256', ikm, HKDF_SALT, C2M_INFO, 32))
  const m2cKey = Buffer.from(hkdfSync('sha256', ikm, HKDF_SALT, M2C_INFO, 32))
  return { c2mKey, m2cKey }
}

export function makeIv(seq: number): Buffer {
  const prefix = randomBytes(4)
  const suffix = Buffer.alloc(8)
  const normalized = Number.isFinite(seq) ? Math.max(0, Math.trunc(seq)) : 0
  suffix.writeBigUInt64BE(BigInt(normalized))
  return Buffer.concat([prefix, suffix])
}

export interface AadParts {
  protocol: number | string
  deviceId: string
  seq: number
  op: string
  contractVersion: number | string
  requestId?: string
}

export function aadOf(parts: AadParts): string {
  const head = [parts.protocol, parts.deviceId, parts.seq, parts.op, parts.contractVersion].join('|')
  return parts.requestId === undefined ? head : `${head}|${parts.requestId}`
}

export function seal(plaintext: unknown, key: Buffer, aad: string, seq: number): SyncEnvelope {
  const iv = makeIv(seq)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf-8'))
  const data = Buffer.concat([cipher.update(JSON.stringify(plaintext), 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64')
  }
}

/** 解密失败统一映射为授权失效，避免把填充/标签错误详细暴露给调用方。 */
export function open<T>(envelope: SyncEnvelope, key: Buffer, aad: string): SyncResult<T> {
  try {
    const iv = Buffer.from(envelope.iv, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(aad, 'utf-8'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final()
    ]).toString('utf-8')
    return syncOk(JSON.parse(plain) as T)
  } catch {
    return syncFail('E_M_AUTH_EXPIRED')
  }
}