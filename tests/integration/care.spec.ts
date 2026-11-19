import { describe, expect, it } from 'vitest'
import { ok, type Result } from '@shared/result'
import type {
  CareRequest,
  CareResult,
  GoalCheckResult,
  ParseRequest,
  ParseResult
} from '@main/providers/types'
import type { ResolvedAccess } from '@main/ai/provider-resolver'
import { localParse } from '@main/providers/local-parser'
import { at, createHarness } from '../helpers/harness'

function careAccess(
  generateCare: (request: CareRequest) => Promise<Result<CareResult>>
): ResolvedAccess {
  return {
    revision: 1,
    status: 'custom',
    text: {
      kind: 'ready',
      presetId: 'custom',
      actualPresetId: 'deepseek',
      presetName: 'DeepSeek',
      endpoint: 'https://example.invalid',
      model: 'deepseek-chat',
      provider: {
        parse: async (request: ParseRequest): Promise<Result<ParseResult>> =>
          ok(localParse(request.description, request.referenceTime)),
        checkGoal: async (): Promise<Result<GoalCheckResult>> =>
          ok({ summary: '保持进度', progress: 10 }),
        generateCare
      }
    },
    vision: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' },
    asr: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' }
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

describe('日常回顾服务', () => {
  it('晚间回顾写入对话并只触发一次', async () => {
    const harness = createHarness(at(2026, 11, 9, 21, 30))
    harness.schedule.createEvent(
      {
        title: '方案评审',
        startAt: at(2026, 11, 9, 20, 0),
        endAt: at(2026, 11, 9, 21, 0),
        sourceModality: 'text'
      },
      { allowPast: true }
    )
    harness.schedule.createEvent(
      {
        title: '面试',
        startAt: at(2026, 11, 10, 9, 0),
        endAt: at(2026, 11, 10, 10, 0),
        sourceModality: 'text'
      },
      { allowConflict: true }
    )
    harness.goals.create({
      title: '论文初稿',
      instruction: '跟进写作',
      cadence: 'daily',
      hour: 21,
      minute: 0
    })

    await harness.care.runDue(harness.now())
    expect(harness.careNotices).toHaveLength(1)
    const notice = harness.careNotices[0]
    expect(notice?.kind).toBe('evening')
    expect(notice?.message.sourceLabel).toContain('晚间回顾')
    expect(notice?.message.content).toContain('方案评审')
    expect(notice?.message.content).toContain('论文初稿')
    expect(notice?.message.content).toContain('面试')
    expect(harness.store.snapshot().messages.at(-1)?.sourceLabel).toContain('晚间回顾')

    await harness.care.runDue(harness.now())
    expect(harness.careNotices).toHaveLength(1)
  })

  it('晨间计划关注生日等细节', async () => {
    const harness = createHarness(at(2026, 11, 9, 8, 30))
    harness.memories.add('我的生日是11月9日', 'profile', 'user')
    harness.schedule.createEvent({
      title: '项目周会',
      startAt: at(2026, 11, 9, 9, 30),
      endAt: at(2026, 11, 9, 10, 30),
      sourceModality: 'text'
    })
    await harness.care.runDue(harness.now())
    const notice = harness.careNotices[0]
    expect(notice?.kind).toBe('morning')
    expect(notice?.message.content).toContain('早上好')
    expect(notice?.message.content).toContain('项目周会')
    expect(notice?.message.content).toContain('生日')
  })

  it('周日每周复盘优先，且当天不再叠加晚间复盘', async () => {
    const sunday = at(2026, 11, 15, 20, 30)
    const harness = createHarness(sunday)
    await harness.care.runDue(sunday)
    expect(harness.careNotices[0]?.kind).toBe('weekly')
    harness.setNow(at(2026, 11, 15, 21, 30))
    await harness.care.runDue(harness.now())
    expect(harness.careNotices).toHaveLength(1)
  })

  it('安静时段与关闭开关都不触发', async () => {
    const quiet = createHarness(at(2026, 11, 9, 22, 45))
    await quiet.care.runDue(quiet.now())
    expect(quiet.careNotices).toHaveLength(0)

    const disabled = createHarness(at(2026, 11, 9, 21, 30))
    disabled.care.updateSettings({ enabled: false })
    await disabled.care.runDue(disabled.now())
    expect(disabled.careNotices).toHaveLength(0)
  })

  it('接入模型时使用模型生成的关怀，并吸收记忆候选', async () => {
    const harness = createHarness(at(2026, 11, 9, 21, 30), {
      access: careAccess(async () =>
        ok({
          message: '今晚先看一眼明天的面试材料，别熬太晚。',
          memoryCandidates: [
            { content: '我要参加11月10日的面试', kind: 'commitment', confidence: 0.85 }
          ]
        })
      )
    })
    await harness.care.runDue(harness.now())
    const notice = harness.careNotices[0]
    expect(notice?.message.content).toContain('面试材料')
    expect(harness.memories.list().some((item) => item.content.includes('面试'))).toBe(true)
    expect(harness.memories.list().find((item) => item.content.includes('面试'))?.source).toBe('ai')
    await tick()
  })

  it('设置更新会持久化并控制下次时间', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const updated = harness.care.updateSettings({
      morningTime: '07:45',
      eveningEnabled: false,
      weeklyWeekday: 5
    })
    expect(updated.ok).toBe(true)
    const settings = harness.care.settings()
    expect(settings.morningTime).toBe('07:45')
    expect(settings.eveningEnabled).toBe(false)
    expect(settings.weeklyWeekday).toBe(5)
    expect(harness.store.snapshot().careSettings.morningTime).toBe('07:45')
  })
})