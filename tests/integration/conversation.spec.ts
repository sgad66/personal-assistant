import { describe, expect, it } from 'vitest'
import { at, createHarness } from '../helpers/harness'

describe('会话解析主链路（T1~T5、T22、T23）', () => {
  it('T1 文字录入后写入日程并回显', async () => {
    const harness = createHarness(at(2026, 11, 5, 20, 0))
    const result = await harness.submit('明天下午三点开会')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.state).toBe('idle')
    expect(result.data.createdEventId).toBeDefined()
    expect(result.data.assistantMessage.content).toContain('已安排：开会')
    expect(result.data.assistantMessage.content).toContain('15:00-16:00')

    const events = harness.store.snapshot().events
    expect(events).toHaveLength(1)
    expect(events[0]?.startAt).toBe(at(2026, 11, 6, 15, 0))
    expect(events[0]?.endAt).toBe(at(2026, 11, 6, 16, 0))
    expect(harness.store.snapshot().reminders).toHaveLength(1)
    expect(harness.store.snapshot().reminders[0]?.plannedAt).toBe(at(2026, 11, 6, 14, 50))
  })

  it('T2 下周三上午写入下一自然周周三 09:00', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = await harness.submit('下周三上午碰一下方案')
    expect(result.ok).toBe(true)
    const events = harness.store.snapshot().events
    expect(events).toHaveLength(1)
    expect(events[0]?.startAt).toBe(at(2026, 11, 18, 9, 0))
  })

  it('T3 缺少开始时间只追问、不写入', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = await harness.submit('帮我记一下要买牛奶')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.state).toBe('clarifying')
    expect(result.data.errorCode).toBe('E_MISSING_START_TIME')
    expect(harness.store.snapshot().events).toHaveLength(0)
    expect(result.data.assistantMessage.content).toContain('几点')
  })

  it('T4 一次性追问全部缺失信息', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = await harness.submit('下周一有个会')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.state).toBe('clarifying')
    expect(result.data.assistantMessage.content).toContain('几点开始')
    expect(result.data.assistantMessage.content).toContain('多长时间')
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('T5 结束早于开始返回不一致错误且不写入', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = await harness.submit('明天 15:00 到 14:00 开会')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.errorCode).toBe('E_TIME_INCONSISTENT')
    expect(result.data.assistantMessage.content).toContain('结束时间需晚于开始时间')
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('T22 闲聊只回复、不创建日程', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = await harness.submit('你好')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.state).toBe('idle')
    expect(result.data.assistantMessage.content.length).toBeGreaterThan(0)
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('T23 会话内修正最近事项时间', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const created = await harness.submit('明天下午三点开会')
    expect(created.ok).toBe(true)
    const result = await harness.submit('改到下午四点')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.state).toBe('idle')
    const events = harness.store.snapshot().events
    expect(events).toHaveLength(1)
    expect(events[0]?.startAt).toBe(at(2026, 11, 9, 16, 0))
    expect(result.data.assistantMessage.content).toContain('已修改')
  })

  it('追问后补充信息可继续完成写入', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const first = await harness.submit('下周一有个会')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.state).toBe('clarifying')

    const resolved = await harness.conversation.resolve({ kind: 'supplement', text: '下午三点，大概一小时' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.data.state).toBe('idle')
    const events = harness.store.snapshot().events
    expect(events).toHaveLength(1)
    expect(events[0]?.startAt).toBe(at(2026, 11, 16, 15, 0))
    expect(events[0]?.endAt).toBe(at(2026, 11, 16, 16, 0))
    const messages = harness.store.snapshot().messages
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(messages[2]?.content).toContain('下午三点')
    expect(messages[3]?.content.length).toBeGreaterThan(0)
  })
})

describe('冲突与重复（T6、T8）', () => {
  it('T6 冲突后放弃不产生任何数据', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const first = await harness.submit('明天下午三点开会')
    expect(first.ok).toBe(true)

    const second = await harness.submit('明天下午三点半开会')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.state).toBe('conflict')
    expect(second.data.conflicts?.length).toBeGreaterThan(0)
    expect(harness.store.snapshot().events).toHaveLength(1)

    const abandoned = await harness.conversation.resolve({
      kind: 'conflict_decision',
      choice: 'abandon'
    })
    expect(abandoned.ok).toBe(true)
    if (!abandoned.ok) return
    expect(abandoned.data.state).toBe('idle')
    expect(harness.store.snapshot().events).toHaveLength(1)
    expect(harness.store.snapshot().reminders).toHaveLength(1)
  })

  it('冲突时仍然创建会写入并标记冲突', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    await harness.submit('明天下午三点开会')
    const second = await harness.submit('明天下午三点半开会')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const created = await harness.conversation.resolve({
      kind: 'conflict_decision',
      choice: 'create_anyway'
    })
    expect(created.ok).toBe(true)
    const events = harness.store.snapshot().events
    expect(events).toHaveLength(2)
    expect(events.every((event) => event.hasConflict)).toBe(true)
  })

  it('T8 24 小时内重复提交被抑制', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const first = await harness.submit('明天上午9点晨会')
    expect(first.ok).toBe(true)
    const second = await harness.submit('明天上午9点晨会')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.state).toBe('duplicate')
    expect(second.data.errorCode).toBe('E_DUPLICATE_EVENT')
    expect(harness.store.snapshot().events).toHaveLength(1)
  })
})