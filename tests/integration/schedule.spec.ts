import { describe, expect, it } from 'vitest'
import { at, createHarness } from '../helpers/harness'

function intent(title: string, startAt: number, endAt: number) {
  return { title, startAt, endAt, sourceModality: 'text' as const }
}

describe('日程写入校验链与冲突处理', () => {
  it('T7 首尾相接判定为不冲突', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const first = harness.schedule.createEvent(intent('A', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0)))
    expect(first.ok).toBe(true)
    const second = harness.schedule.createEvent(intent('B', at(2026, 11, 9, 16, 0), at(2026, 11, 9, 17, 0)))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.conflicts).toHaveLength(0)
    expect(second.data.event.hasConflict).toBe(false)
  })

  it('重叠区间返回冲突，放弃后无残留', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    harness.schedule.createEvent(intent('已有事项', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0)))
    const conflicting = harness.schedule.createEvent(
      intent('新事项', at(2026, 11, 9, 15, 30), at(2026, 11, 9, 16, 30))
    )
    expect(conflicting.ok).toBe(false)
    if (conflicting.ok) return
    expect(conflicting.error.code).toBe('E_CONFLICT_EXISTS')
    expect(harness.store.snapshot().events).toHaveLength(1)
  })

  it('仍然创建后两条均带冲突标记', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    harness.schedule.createEvent(intent('已有事项', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0)))
    const created = harness.schedule.createEvent(
      intent('新事项', at(2026, 11, 9, 15, 30), at(2026, 11, 9, 16, 30)),
      { allowConflict: true }
    )
    expect(created.ok).toBe(true)
    const events = harness.store.snapshot().events
    expect(events).toHaveLength(2)
    expect(events.every((event) => event.hasConflict)).toBe(true)
  })

  it('缺少开始时间不写入', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = harness.schedule.createEvent({ title: '无时间', sourceModality: 'text' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('E_MISSING_START_TIME')
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('已过期时间默认拒绝并提示', () => {
    const harness = createHarness(at(2026, 11, 9, 15, 5))
    const result = harness.schedule.createEvent(
      intent('补记事项', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0))
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('E_TIME_IN_PAST')
  })

  it('补记允许写入且不产生未来提醒投递', () => {
    const harness = createHarness(at(2026, 11, 9, 15, 5))
    const result = harness.schedule.createEvent(
      intent('补记事项', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0)),
      { allowPast: true }
    )
    expect(result.ok).toBe(true)
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(0)
  })

  it('T8 同标题同开始时间 24 小时内判定重复', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    expect(harness.schedule.createEvent(intent('晨会', at(2026, 11, 10, 9, 0), at(2026, 11, 10, 10, 0))).ok).toBe(
      true
    )
    const duplicate = harness.schedule.createEvent(
      intent('晨会', at(2026, 11, 10, 9, 0), at(2026, 11, 10, 10, 0))
    )
    expect(duplicate.ok).toBe(false)
    if (duplicate.ok) return
    expect(duplicate.error.code).toBe('E_DUPLICATE_EVENT')
    expect(harness.store.snapshot().events).toHaveLength(1)
  })

  it('T11 改期后作废旧提醒并按新时间登记', () => {
    const harness = createHarness(at(2026, 11, 9, 14, 50))
    const created = harness.schedule.createEvent(
      intent('评审会', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0))
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(1)

    const updated = harness.schedule.updateEvent(created.data.eventId, {
      startAt: at(2026, 11, 9, 17, 0),
      endAt: at(2026, 11, 9, 18, 0)
    })
    expect(updated.ok).toBe(true)
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(1)

    harness.setNow(at(2026, 11, 9, 16, 50))
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(2)
    expect(harness.presented[1]?.eventId).toBe(created.data.eventId)
  })

  it('T16 取消后周视图不可见且提醒作废', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const created = harness.schedule.createEvent(
      intent('将被取消', at(2026, 11, 9, 15, 0), at(2026, 11, 9, 16, 0))
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(harness.schedule.cancelEvent(created.data.eventId).ok).toBe(true)

    const week = harness.schedule.getWeek(at(2026, 11, 9, 10, 0))
    expect(week.ok).toBe(true)
    if (!week.ok) return
    expect(week.data.totalCount).toBe(0)

    harness.setNow(at(2026, 11, 9, 14, 55))
    harness.scheduler.pollNow()
    expect(harness.presented).toHaveLength(0)
  })

  it('T18 事务失败后事项与提醒均无残留', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    harness.schedule.createEvent(intent('基础事项', at(2026, 11, 10, 9, 0), at(2026, 11, 10, 10, 0)))
    const before = harness.store.snapshot()
    const failed = harness.store.write(() => {
      throw new Error('injected failure')
    })
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.error.code).toBe('E_STORE_WRITE_FAIL')
    const after = harness.store.snapshot()
    expect(after.events).toHaveLength(before.events.length)
    expect(after.reminders).toHaveLength(before.reminders.length)
  })

  it('详情查询返回完整字段，取消后不可查', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const created = harness.schedule.createEvent({
      title: '带地点的事项',
      startAt: at(2026, 11, 10, 9, 0),
      endAt: at(2026, 11, 10, 10, 0),
      location: '3 号会议室',
      note: '带上材料',
      sourceModality: 'voice'
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const detail = harness.schedule.getDetail(created.data.eventId)
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    expect(detail.data.location).toBe('3 号会议室')
    expect(detail.data.note).toBe('带上材料')
    expect(detail.data.sourceModality).toBe('voice')

    harness.schedule.cancelEvent(created.data.eventId)
    const afterCancel = harness.schedule.getDetail(created.data.eventId)
    expect(afterCancel.ok).toBe(false)
  })
})