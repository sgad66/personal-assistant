import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fail } from '@shared/result'
import type { ResolvedAccess } from '@main/ai/provider-resolver'
import { ParseOrchestrator } from '@main/services/parse-orchestrator'
import { TempFileManager } from '@main/temp-file-manager'
import { silentLogger } from '@main/observability/logger'
import type { ParseRequest, ParseResult } from '@main/providers/types'

function parserWith(parse: (request: ParseRequest) => Promise<ReturnType<typeof fail> | { ok: true; data: ParseResult }>) {
  const access: ResolvedAccess = {
    revision: 1,
    status: 'custom',
    text: {
      kind: 'ready',
      presetId: 'custom',
      endpoint: 'https://example.invalid',
      model: 'remote',
      provider: { parse }
    },
    vision: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' },
    asr: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' }
  }
  return new ParseOrchestrator(
    () => access,
    new TempFileManager(mkdtempSync(join(tmpdir(), 'pa-parse-'))),
    silentLogger
  )
}

const context = { referenceTime: new Date(2026, 10, 16, 9, 0).getTime(), timeZone: 'Asia/Shanghai' }

describe('文本模型失败时的回复', () => {
  it('超时后改用本地解析，仍然给出回复', async () => {
    const orchestrator = parserWith(async () => fail('E_AI_TIMEOUT', 'error.aiTimeout', true, { failureCategory: 'timeout' }))
    const result = await orchestrator.parse(
      { clientMessageId: 'm1', modality: 'text', parts: [{ kind: 'text', text: '明天下午三点开会' }] },
      context
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.replyText.length).toBeGreaterThan(0)
    expect(result.data.candidates.length).toBeGreaterThan(0)
  })

  it('鉴权失败不伪装成本地成功', async () => {
    const orchestrator = parserWith(async () =>
      fail('E_AI_AUTH_FAILED', 'error.aiAuthFailed', false, { failureCategory: 'unauthorized' })
    )
    const result = await orchestrator.parse(
      { clientMessageId: 'm2', modality: 'text', parts: [{ kind: 'text', text: '你好' }] },
      context
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('E_AI_AUTH_FAILED')
  })
})
