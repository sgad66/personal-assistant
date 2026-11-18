import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ok, type Result } from '@shared/result'
import type { ParseResult } from '@main/providers/types'
import type { ITextUnderstandingProvider } from '@main/providers/types'
import type { ResolvedAccess } from '@main/ai/provider-resolver'
import { Logger } from '@main/observability/logger'
import { encodeImportHeader } from '@shared/import/header'
import { at, createHarness } from '../helpers/harness'

type Candidate = { title: string; startExpression: string }

function textProvider(candidates: Candidate[], confidence = 0.9): ITextUnderstandingProvider {
  return {
    parse: async (): Promise<Result<ParseResult>> =>
      ok({
        intentKind: candidates.length > 0 ? 'schedule' : 'unknown',
        candidates,
        replyText: candidates.length > 0 ? '识别到安排' : '未识别到安排',
        confidence
      })
  }
}

function accessWith(candidates: Candidate[]): ResolvedAccess {
  return {
    revision: 1,
    status: 'custom',
    timeouts: { relaxed: false },
    text: {
      kind: 'ready',
      presetId: 'deepseek',
      presetName: 'DeepSeek（官方 API）',
      endpoint: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      provider: textProvider(candidates)
    },
    vision: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED', presetId: 'groq' },
    asr: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED', presetId: 'groq' }
  }
}

function importText(body: string, fileName = '排班表.txt'): string {
  const header = encodeImportHeader({
    ext: 'txt',
    bytes: body.length,
    chars: body.length,
    clipped: false,
    fileName
  })
  return `${header}\n${body}`
}

const BODY = '明天下午三点周会，后天上午十点复盘'

describe('导入端到端（主进程 + harness）', () => {
  it('剥离导入头、标注来源并进入候选确认', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0), {
      access: accessWith([
        { title: '周会', startExpression: '明天下午三点' },
        { title: '复盘', startExpression: '后天上午十点' }
      ])
    })
    const result = await harness.submitParts([{ kind: 'text', text: importText(BODY) }], 'text')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.userMessage.content.includes('⟦pa-import:')).toBe(false)
    expect(result.data.userMessage.content).toBe(BODY)
    expect(result.data.assistantMessage.sourceLabel).toBe('来源：导入文件 · 排班表.txt')
    expect(result.data.state).toBe('candidate_select')
    expect(result.data.candidates).toHaveLength(2)
  })

  it('确认后写入事项且来源只含文件名', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0), {
      access: accessWith([{ title: '周会', startExpression: '明天下午三点' }])
    })
    const submitted = await harness.submitParts([{ kind: 'text', text: importText(BODY) }], 'text')
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return
    const confirmed = await harness.conversation.resolve({
      kind: 'confirm_candidates',
      selectedIndexes: [0]
    })
    expect(confirmed.ok).toBe(true)
    const events = harness.store.snapshot().events
    expect(events).toHaveLength(1)
    expect(events[0]?.importSourceLabel).toBe('来源：导入文件 · 排班表.txt')
    const serialized = JSON.stringify(events)
    expect(serialized.includes('C:\\\\')).toBe(false)
    expect(serialized.includes('/home/')).toBe(false)
  })

  it('无候选时不写入任何事项', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access: accessWith([]) })
    const result = await harness.submitParts([{ kind: 'text', text: '甲乙丙' }], 'text')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.candidates ?? []).toHaveLength(0)
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('重复导入同样事项不新增', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0), {
      access: accessWith([{ title: '周会', startExpression: '明天下午三点' }])
    })
    const first = await harness.submitParts([{ kind: 'text', text: importText(BODY) }], 'text')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.state).toBe('idle')
    expect(harness.store.snapshot().events).toHaveLength(1)

    const second = await harness.submitParts([{ kind: 'text', text: importText(BODY) }], 'text')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.state).toBe('duplicate')
    expect(second.data.errorCode).toBe('E_DUPLICATE_EVENT')
    expect(harness.store.snapshot().events).toHaveLength(1)
  })

  it('导入模式部分勾选后保留未勾选候选', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0), {
      access: accessWith([
        { title: '周会', startExpression: '明天下午三点' },
        { title: '复盘', startExpression: '后天上午十点' },
        { title: '值班', startExpression: '大后天上午九点' }
      ])
    })
    const submitted = await harness.submitParts([{ kind: 'text', text: importText(BODY) }], 'text')
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return
    const confirmed = await harness.conversation.resolve({
      kind: 'confirm_candidates',
      selectedIndexes: [0]
    })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(confirmed.data.state).toBe('candidate_select')
    expect(confirmed.data.assistantMessage.content.includes('已安排 1 项')).toBe(true)
    expect(harness.store.session.pendingCandidates).toHaveLength(2)
    expect(harness.store.snapshot().events).toHaveLength(1)
  })

  it('导入失败日志不含文件名、内容与路径', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-import-log-'))
    const logPath = join(dir, 'app.log')
    const logger = new Logger(logPath)
    const harness = createHarness(at(2026, 11, 9, 10, 0), {
      access: {
        ...accessWith([{ title: '周会', startExpression: '明天下午三点' }]),
        text: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED', presetId: 'deepseek' }
      },
      logger
    })
    const result = await harness.submitParts([{ kind: 'text', text: importText(BODY, '排班表-最终版.txt') }], 'text')
    expect(result.ok).toBe(true)
    const log = readFileSync(logPath, 'utf-8')
    expect(log.includes('import.failed')).toBe(true)
    expect(log.includes('排班表-最终版.txt')).toBe(false)
    expect(log.includes('明天下午三点')).toBe(false)
    expect(log.includes('C:\\\\')).toBe(false)
  })

  it('无导入头的普通文字显示文本服务来源', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0), {
      access: accessWith([{ title: '周会', startExpression: '明天下午三点' }])
    })
    const result = await harness.submitParts([{ kind: 'text', text: BODY }], 'text')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.assistantMessage.sourceLabel).toBe('文字理解：DeepSeek')
  })
})

describe('首页附件分流', () => {
  it('一次写入两个确定的行程，重复发送不重复创建', async () => {
    const harness = createHarness(at(2026, 11, 9, 10), {
      access: accessWith([
        { title: '项目讨论', startExpression: '2026-11-10 09:00-09:45' },
        { title: '阅读', startExpression: '2026-11-10 15:00' }
      ])
    })
    const submit = () => harness.conversation.submit({
      ...harness.envelope(BODY), attachment: { name: '计划.txt' }
    })
    const first = await submit()
    expect(first.ok).toBe(true)
    if (first.ok) expect(first.data.state).toBe('idle')
    await submit()
    const events = harness.store.snapshot().events
    expect(events).toHaveLength(2)
    expect(events[0]?.endAt).toBe(at(2026, 11, 10, 9, 45))
  })

  it('缺少时间的事项不会借用另一个事项的时间', async () => {
    const harness = createHarness(at(2026, 11, 9, 10), {
      access: accessWith([
        { title: '周会', startExpression: '明天下午三点' },
        { title: '取书', startExpression: '' }
      ])
    })
    const result = await harness.conversation.submit({
      ...harness.envelope('明天下午三点开周会；取书时间待定'), attachment: { name: '计划.txt' }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.state).toBe('clarifying')
    expect(result.data.parsePreview?.title).toBe('取书')
    expect(harness.store.snapshot().events).toHaveLength(1)
  })
})
