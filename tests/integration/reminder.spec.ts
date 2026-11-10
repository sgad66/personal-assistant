import { describe, expect, it } from 'vitest'
import { at, createHarness } from '../helpers/harness'

function intent(title: string, startAt: number, endAt: number) {
  return { title, startAt, endAt, sourceModality: 'text' as const }
}

describe('提前十分钟提醒', () => {
  it('T9 距开始不足 10 分钟时创建后立即投递', () => {
    const harness = createHarness(at(2026, 11, 9, 14, 55))
    const created = harness.schedule.createEvent(
      intent('三点会议', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0))
    )
    expect(created.ok).toBe(true)
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(1)
    expect(harness.presented[0]?.remainingMinutes).toBe(5)
  })

  it('T10 已开始事项不触发提醒', () => {
    const harness = createHarness(at(2026, 11, 9, 15, 5))
    const created = harness.schedule.createEvent(
      intent('补记会议', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0)),
      { allowPast: true }
    )
    expect(created.ok).toBe(true)
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(0)
  })

  it('T14 同一事项重复轮询只投递一次', () => {
    const harness = createHarness(at(2026, 11, 9, 14, 50))
    harness.schedule.createEvent(intent('周会', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0)))
    harness.scheduler.pollNow()
    harness.scheduler.pollNow()
    harness.advance(10_000)
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(1)
  })

  it('提醒投递时刻与 plannedAt 偏差不超过 30 秒', () => {
    const planned = at(2026, 11, 9, 14, 50)
    const harness = createHarness(planned)
    harness.schedule.createEvent(intent('偏差检查', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0)))
    harness.advance(20_000)
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(1)
    const record = harness.store.snapshot().reminders[0]
    expect(record?.firedAt).toBe(planned + 20_000)
    expect(Math.abs((record?.firedAt ?? 0) - (record?.plannedAt ?? 0))).toBeLessThanOrEqual(30_000)
  })

  it('T13 同一时刻两条提醒逐个投递不丢失', () => {
    const harness = createHarness(at(2026, 11, 9, 14, 50))
    harness.schedule.createEvent(intent('会议 A', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0)), {
      allowConflict: true
    })
    harness.schedule.createEvent(intent('会议 B', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0)), {
      allowConflict: true
    })
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(2)
    expect(new Set(harness.presented.map((item) => item.title))).toEqual(new Set(['会议 A', '会议 B']))
  })

  it('T12 连续三次稍后提醒后置为已忽略', () => {
    const harness = createHarness(at(2026, 11, 9, 23, 20))
    const created = harness.schedule.createEvent(
      intent('晚间复盘', at(2026, 11, 9, 23, 30), at(2026, 11, 9, 23, 45))
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const eventId = created.data.eventId

    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(1)
    const firstResponse = harness.scheduler.handleResponse({
      eventId,
      plannedAt: harness.presented[0]?.plannedAt ?? 0,
      action: 'snooze'
    })
    expect(firstResponse.ok).toBe(true)
    if (!firstResponse.ok) return
    expect(firstResponse.data.snoozeCount).toBe(1)
    expect(firstResponse.data.nextPlannedAt).toBeDefined()

    harness.setNow(firstResponse.data.nextPlannedAt ?? 0)
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(2)
    const secondResponse = harness.scheduler.handleResponse({
      eventId,
      plannedAt: harness.presented[1]?.plannedAt ?? 0,
      action: 'snooze'
    })
    expect(secondResponse.ok).toBe(true)
    if (!secondResponse.ok) return
    expect(secondResponse.data.snoozeCount).toBe(2)

    harness.setNow(secondResponse.data.nextPlannedAt ?? 0)
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(3)
    const thirdResponse = harness.scheduler.handleResponse({
      eventId,
      plannedAt: harness.presented[2]?.plannedAt ?? 0,
      action: 'snooze'
    })
    expect(thirdResponse.ok).toBe(true)
    if (!thirdResponse.ok) return
    expect(thirdResponse.data.reminderStatus).toBe('ignored')
    expect(thirdResponse.data.snoozeCount).toBe(3)

    const event = harness.store.snapshot().events[0]
    expect(event?.reminderStatus).toBe('ignored')

    const fourth = harness.scheduler.handleResponse({
      eventId,
      plannedAt: harness.presented[2]?.plannedAt ?? 0,
      action: 'snooze'
    })
    expect(fourth.ok).toBe(false)
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(3)
  })

  it('知道了之后不再重复投递', () => {
    const harness = createHarness(at(2026, 11, 9, 14, 50))
    const created = harness.schedule.createEvent(
      intent('确认提醒', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0))
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    harness.scheduler.pollNow()
    const record = harness.store.snapshot().reminders[0]
    const response = harness.scheduler.handleResponse({
      eventId: created.data.eventId,
      plannedAt: record?.plannedAt ?? 0,
      action: 'acknowledge'
    })
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.data.reminderStatus).toBe('reminded')
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(1)
  })

  it('T20 启动时对已过期未提醒事项一次性汇总', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    harness.store.write((draft) => {
      draft.events.push({
        eventId: 'evt_past_1',
        title: '已过期 1',
        startAt: at(2026, 11, 9, 8, 0),
        endAt: at(2026, 11, 9, 9, 0),
        sourceModality: 'text',
        hasConflict: false,
        status: 'active',
        reminderStatus: 'not_reminded',
        snoozeCount: 0,
        createdAt: at(2026, 11, 8, 9, 0),
        updatedAt: at(2026, 11, 8, 9, 0)
      })
      draft.events.push({
        eventId: 'evt_past_2',
        title: '已过期 2',
        startAt: at(2026, 11, 9, 8, 30),
        endAt: at(2026, 11, 9, 9, 30),
        sourceModality: 'text',
        hasConflict: false,
        status: 'active',
        reminderStatus: 'not_reminded',
        snoozeCount: 0,
        createdAt: at(2026, 11, 8, 9, 0),
        updatedAt: at(2026, 11, 8, 9, 0)
      })
      draft.reminders.push(
        { reminderId: 'r1', eventId: 'evt_past_1', plannedAt: at(2026, 11, 9, 7, 50), channel: 'in_app', handled: false },
        { reminderId: 'r2', eventId: 'evt_past_2', plannedAt: at(2026, 11, 9, 8, 20), channel: 'in_app', handled: false }
      )
    })
    expect(harness.scheduler.emitExpiredSummary()).toBe(2)
    expect(harness.scheduler.emitExpiredSummary()).toBe(0)
  })

  it('取消后原提醒失效（T16 提醒侧）', () => {
    const harness = createHarness(at(2026, 11, 9, 14, 50))
    const created = harness.schedule.createEvent(
      intent('取消事项', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0))
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    harness.schedule.cancelEvent(created.data.eventId)
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(0)
  })
})