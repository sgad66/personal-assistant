import { describe, expect, it } from 'vitest'
import { archiveResolved, closeConflict, pendingOf, upsertConflict } from '../../src/main/sync/conflict-service'
import { createSyncState } from '@shared/storage/normalize'
import type { EventSnapshot } from '@shared/sync/types'

const NOW = 1_700_000_000_000
const DAY = 24 * 3600 * 1000

function snapshot(title: string): EventSnapshot {
  return { title, startAt: NOW, endAt: NOW + 3_600_000 }
}

function withConflict() {
  return upsertConflict(
    createSyncState(NOW, 'desk-1'),
    {
      conflictId: 'c1',
      eventId: 'e1',
      type: 'both_modified',
      desktopSnapshot: snapshot('电脑端版本'),
      mobileSnapshot: snapshot('手机端版本'),
      deviceId: 'dev-a'
    },
    NOW
  )
}

describe('冲突持久化', () => {
  it('同一事项未解决冲突只保留一条并更新摘要', () => {
    let state = withConflict()
    state = upsertConflict(
      state,
      {
        conflictId: 'c2',
        eventId: 'e1',
        type: 'both_modified',
        desktopSnapshot: snapshot('电脑端版本2'),
        mobileSnapshot: snapshot('手机端版本2'),
        deviceId: 'dev-a'
      },
      NOW + 1000
    )
    expect(state.conflicts).toHaveLength(1)
    expect(state.conflicts[0]?.desktopSnapshot.title).toBe('电脑端版本2')
    expect(state.conflicts[0]?.conflictId).toBe('c1')
  })

  it('关闭冲突写入结果与时间', () => {
    const closed = closeConflict(withConflict(), 'c1', 'mobile', NOW + 2000)
    expect(closed.conflicts[0]?.status).toBe('resolved')
    expect(closed.conflicts[0]?.resolution).toBe('mobile')
    expect(closed.conflicts[0]?.resolvedAt).toBe(NOW + 2000)
    expect(pendingOf(closed)).toHaveLength(0)
  })

  it('未解决冲突永不被自动归档', () => {
    const archived = archiveResolved(withConflict(), NOW + 400 * DAY)
    expect(archived.conflicts[0]?.archivedAt).toBeUndefined()
    expect(pendingOf(archived)).toHaveLength(1)
  })

  it('已解决 31 天后归档', () => {
    const closed = closeConflict(withConflict(), 'c1', 'desktop', NOW)
    const archived = archiveResolved(closed, NOW + 31 * DAY)
    expect(archived.conflicts[0]?.archivedAt).toBe(NOW + 31 * DAY)
  })
})