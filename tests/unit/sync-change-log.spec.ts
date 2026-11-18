import { describe, expect, it } from 'vitest'
import { appendChange, changesSince, isCursorExpired, trimChangeLog } from '../../src/main/sync/change-log'
import { createSyncState } from '@shared/storage/normalize'
import type { SyncState } from '@shared/sync/types'

const NOW = 1_700_000_000_000

function filledState(count: number, origin = 'mobile'): SyncState {
  let state = createSyncState(NOW, 'desk-1')
  for (let index = 0; index < count; index += 1) {
    state = appendChange(state, { eventId: `e-${index}`, revision: 1, kind: 'upsert', originDevice: origin }, NOW + index).state
  }
  return state
}

describe('变更日志与游标', () => {
  it('seq 单调递增', () => {
    let state = createSyncState(NOW, 'desk-1')
    const first = appendChange(state, { eventId: 'a', revision: 1, kind: 'upsert', originDevice: 'mobile' }, NOW)
    state = first.state
    const second = appendChange(state, { eventId: 'b', revision: 1, kind: 'upsert', originDevice: 'mobile' }, NOW)
    state = second.state
    const third = appendChange(state, { eventId: 'c', revision: 1, kind: 'upsert', originDevice: 'mobile' }, NOW)
    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(third.seq).toBe(3)
    expect(third.state.changeSeq).toBe(3)
  })

  it('按 since 取增量并跳过来源设备', () => {
    let state = createSyncState(NOW, 'desk-1')
    state = appendChange(state, { eventId: 'a', revision: 1, kind: 'upsert', originDevice: 'mobile' }, NOW).state
    state = appendChange(state, { eventId: 'b', revision: 1, kind: 'upsert', originDevice: 'devA' }, NOW).state
    state = appendChange(state, { eventId: 'c', revision: 1, kind: 'upsert', originDevice: 'mobile' }, NOW).state
    const changes = changesSince(state, 0, 2, 'devA')
    expect(changes).toHaveLength(2)
    expect(changes.some((change) => change.originDevice === 'devA')).toBe(false)
    expect(changes[0]?.seq).toBe(1)
    expect(changes[1]?.seq).toBe(3)
  })

  it('limit 上限为 200', () => {
    const state = filledState(210)
    expect(changesSince(state, 0, 999).length).toBe(200)
  })

  it('裁剪保留最近窗口且不丢最新记录', () => {
    const state = filledState(6000)
    const trimmed = trimChangeLog(state, [5999], NOW + 7000)
    expect(trimmed.changeLog.length <= 5000).toBe(true)
    expect(trimmed.changeLog[trimmed.changeLog.length - 1]?.seq).toBe(6000)
    expect(trimmed.changeLog.some((record) => record.seq <= 0)).toBe(false)
  })

  it('旧游标被判定过期', () => {
    const state = filledState(6000)
    const trimmed = trimChangeLog(state, [5999], NOW + 7000)
    expect(isCursorExpired(trimmed, 0)).toBe(true)
    expect(isCursorExpired(trimmed, trimmed.changeSeq)).toBe(false)
  })
})