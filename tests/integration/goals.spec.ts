import { describe, expect, it } from 'vitest'
import { fail, ok, type Result } from '@shared/result'
import type {
  GoalCheckRequest,
  GoalCheckResult,
  ParseRequest,
  ParseResult
} from '@main/providers/types'
import type { ResolvedAccess } from '@main/ai/provider-resolver'
import { localParse } from '@main/providers/local-parser'
import { at, createHarness } from '../helpers/harness'

function goalAccess(
  checkGoal: (request: GoalCheckRequest) => Promise<Result<GoalCheckResult>>
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
        checkGoal
      }
    },
    vision: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' },
    asr: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' }
  }
}

function localAccess(): ResolvedAccess {
  return {
    revision: 1,
    status: 'local',
    text: {
      kind: 'ready',
      presetId: 'custom',
      actualPresetId: 'local',
      presetName: '本地解析',
      endpoint: 'local',
      model: 'local',
      provider: {
        parse: async (request: ParseRequest): Promise<Result<ParseResult>> =>
          ok(localParse(request.description, request.referenceTime))
      }
    },
    vision: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' },
    asr: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' }
  }
}

describe('目标跟进服务', () => {
  it('创建每日目标并安排当天最近一次跟进', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const created = harness.goals.create({
      title: '论文初稿',
      instruction: '检查写作进度',
      cadence: 'daily',
      hour: 21,
      minute: 0
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.data.nextRunAt).toBe(at(2026, 11, 9, 21, 0))
    expect(created.data.status).toBe('active')
    expect(created.data.createdBy).toBe('user')
    expect(harness.store.snapshot().goals).toHaveLength(1)
    expect(harness.goalChanges.at(-1)?.reason).toBe('created')
  })

  it('到点执行后写回进度、检查记录与对话消息', async () => {
    const harness = createHarness(at(2026, 11, 9, 20, 55), {
      access: goalAccess(async () =>
        ok({ summary: '今天完成了引言初稿。', progress: 30, nextStep: '明天补实验数据。' })
      )
    })
    const created = harness.goals.create({
      title: '论文',
      instruction: '跟进论文进度',
      cadence: 'daily',
      hour: 21,
      minute: 0
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    harness.setNow(at(2026, 11, 9, 21, 0))
    const run = await harness.goals.run(created.data.goalId)
    expect(run.ok).toBe(true)
    if (!run.ok) return
    expect(run.data.status).toBe('success')
    expect(run.data.source).toBe('ai')

    const goal = harness.store.snapshot().goals[0]
    expect(goal?.progress).toBe(30)
    expect(goal?.progressNote).toBe('今天完成了引言初稿。')
    expect(goal?.nextStep).toBe('明天补实验数据。')
    expect(goal?.runCount).toBe(1)
    expect(goal?.checkpoints).toHaveLength(1)
    expect(goal?.nextRunAt).toBe(at(2026, 11, 10, 21, 0))

    const messages = harness.store.snapshot().messages
    const assistant = messages[messages.length - 1]
    expect(assistant?.role).toBe('assistant')
    expect(assistant?.relatedGoalId).toBe(created.data.goalId)
    expect(assistant?.content).toContain('今天完成了引言初稿。')
    expect(harness.goalChanges.some((notice) => notice.reason === 'run' && notice.message)).toBe(true)
  })

  it('本地模式仍会按时回访，但不虚构进度', async () => {
    const harness = createHarness(at(2026, 11, 9, 20, 55), { access: localAccess() })
    const created = harness.goals.create({
      title: '每日回顾',
      instruction: '回顾今天完成的事',
      cadence: 'daily',
      hour: 21,
      minute: 0
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    harness.setNow(at(2026, 11, 9, 21, 0))
    const run = await harness.goals.run(created.data.goalId)
    expect(run.ok).toBe(true)
    if (!run.ok) return
    expect(run.data.source).toBe('local')
    const goal = harness.store.snapshot().goals[0]
    expect(goal?.progress).toBe(0)
    expect(goal?.checkpoints[0]?.status).toBe('success')
    expect(goal?.checkpoints[0]?.summary).toContain('按计划来跟进')
  })

  it('跟踪失败时保留原进度并继续排下一次', async () => {
    const harness = createHarness(at(2026, 11, 9, 20, 55), {
      access: goalAccess(async () => fail('E_AI_TIMEOUT', 'error.aiTimeout', true))
    })
    const created = harness.goals.create({
      title: '项目推进',
      instruction: '检查项目风险',
      cadence: 'daily',
      hour: 21,
      minute: 0
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    harness.setNow(at(2026, 11, 9, 21, 0))
    const run = await harness.goals.run(created.data.goalId)
    expect(run.ok).toBe(true)
    if (!run.ok) return
    expect(run.data.status).toBe('failed')
    expect(run.data.source).toBe('failed')
    const goal = harness.store.snapshot().goals[0]
    expect(goal?.progress).toBe(0)
    expect(goal?.status).toBe('active')
    expect(goal?.checkpoints[0]?.status).toBe('failed')
    expect(goal?.nextRunAt).toBe(at(2026, 11, 10, 21, 0))
  })

  it('暂停后不出现在到期列表，恢复时重算下一次', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const created = harness.goals.create({
      title: '每周复盘',
      instruction: '复盘本周进展',
      cadence: 'daily',
      hour: 21,
      minute: 0
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const paused = harness.goals.setStatus({ goalId: created.data.goalId, action: 'pause' })
    expect(paused.ok).toBe(true)
    harness.setNow(at(2026, 11, 10, 22, 0))
    expect(harness.goals.dueGoals(harness.now())).toHaveLength(0)

    const resumed = harness.goals.setStatus({ goalId: created.data.goalId, action: 'resume' })
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return
    expect(resumed.data.status).toBe('active')
    expect(resumed.data.nextRunAt).toBe(at(2026, 11, 11, 21, 0))
  })

  it('标记完成后进度归满并从到期列表移除', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const created = harness.goals.create({
      title: '读完一本书',
      instruction: '记录阅读进度',
      cadence: 'daily',
      hour: 21,
      minute: 0
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const completed = harness.goals.setStatus({ goalId: created.data.goalId, action: 'complete' })
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.data.status).toBe('completed')
    expect(completed.data.progress).toBe(100)
    expect(completed.data.checkpoints.at(-1)?.summary).toContain('手动标记')
    harness.setNow(at(2026, 11, 9, 21, 0))
    expect(harness.goals.dueGoals(harness.now())).toHaveLength(0)
  })

  it('一次性目标执行后自动完成', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0), {
      access: goalAccess(async () => ok({ summary: '已检查交付情况。', progress: 60 }))
    })
    const onceAt = at(2026, 11, 9, 15, 0)
    const created = harness.goals.create({
      title: '交付检查',
      instruction: '检查交付物',
      cadence: 'once',
      onceAt
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    harness.setNow(onceAt)
    const run = await harness.goals.run(created.data.goalId)
    expect(run.ok).toBe(true)
    const goal = harness.store.snapshot().goals[0]
    expect(goal?.status).toBe('completed')
    expect(goal?.progress).toBe(60)
  })

  it('AI 与对话：识别跟进意图并自动创建目标，重复请求不重复创建', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const first = await harness.submit('每天 21:00 提醒我复盘今天完成的事')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.assistantMessage.relatedGoalId).toBeDefined()

    const snapshot = harness.store.snapshot()
    expect(snapshot.goals).toHaveLength(1)
    const goal = snapshot.goals[0]
    expect(goal?.createdBy).toBe('ai')
    expect(goal?.cadence).toBe('daily')
    expect(goal?.hour).toBe(21)
    expect(goal?.minute).toBe(0)
    expect(goal?.title).toContain('复盘')
    expect(first.data.assistantMessage.content).toContain('已建立定时跟进')

    const second = await harness.submit('每天 21:00 提醒我复盘今天完成的事')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(harness.store.snapshot().goals).toHaveLength(1)
    expect(second.data.assistantMessage.content).toContain('已经在跟进中')
  })

  it('普通一次性日程不会被误判为目标', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = await harness.submit('明天下午三点开项目周会')
    expect(result.ok).toBe(true)
    expect(harness.store.snapshot().goals).toHaveLength(0)
  })

  it('AI 主动创建的草稿可去重并保留已有进度', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const draft = {
      title: '论文进度',
      instruction: '检查论文写作进度',
      cadence: 'interval' as const,
      intervalMinutes: 120,
      hour: 9,
      minute: 0,
      weekday: 1
    }
    const first = harness.goals.createFromAi(draft, harness.now())
    expect(first.created).toBe(true)
    expect(first.view?.progress).toBe(0)
    const second = harness.goals.createFromAi(draft, harness.now() + 60_000)
    expect(second.created).toBe(false)
    expect(second.view?.goalId).toBe(first.view?.goalId)
    expect(harness.store.snapshot().goals).toHaveLength(1)
  })
})

