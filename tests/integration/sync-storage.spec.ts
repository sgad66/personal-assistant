import { describe, expect, it } from 'vitest'
import { DataStore, SCHEMA_VERSION, createEmptyDb, memoryStore } from '../../src/main/storage/data-store'
import { SyncRepository } from '../../src/main/sync/sync-repository'
import { createSyncState } from '@shared/storage/normalize'
import type { ScheduleEvent } from '@shared/domain/types'

const NOW = 1_700_000_000_000

function event(eventId: string): ScheduleEvent {
  return {
    eventId,
    title: '项目周会',
    startAt: NOW + 3_600_000,
    endAt: NOW + 7_200_000,
    sourceModality: 'text',
    hasConflict: false,
    status: 'active',
    reminderStatus: 'not_reminded',
    snoozeCount: 0,
    createdAt: NOW,
    updatedAt: NOW
  }
}

describe('同步状态持久化', () => {
  it('旧数据无 sync 键时读取后仍为 undefined', () => {
    const store = new DataStore({ initial: createEmptyDb(NOW) })
    expect(store.snapshot().sync).toBeUndefined()
    expect(store.snapshot().schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('事件与同步游标在同一次写入提交', () => {
    const store = memoryStore(() => NOW)
    const repo = new SyncRepository(store, () => NOW)
    const written = store.write((draft) => {
      draft.events.push(event('e1'))
      const state = draft.sync ?? createSyncState(NOW)
      state.changeSeq = 7
      draft.sync = state
    })
    expect(written.ok).toBe(true)
    const snapshot = store.snapshot()
    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.sync?.changeSeq).toBe(7)
    expect(snapshot.revision).toBe(1)
    void repo
  })

  it('seq 连续推进且在重启后继续', () => {
    const store = memoryStore(() => NOW)
    const repo = new SyncRepository(store, () => NOW)
    expect(repo.nextSeq()).toEqual({ ok: true, data: 1 })
    expect(repo.nextSeq()).toEqual({ ok: true, data: 2 })
    expect(repo.nextSeq()).toEqual({ ok: true, data: 3 })
    const reopened = new DataStore({ initial: store.snapshot() })
    const repo2 = new SyncRepository(reopened, () => NOW)
    expect(repo2.nextSeq()).toEqual({ ok: true, data: 4 })
  })

  it('去重表超过 5000 条裁掉最旧', () => {
    const store = memoryStore(() => NOW)
    const repo = new SyncRepository(store, () => NOW)
    for (let index = 0; index < 5005; index += 1) {
      repo.markProcessed({ opId: `op-${index}`, deviceId: 'dev', eventId: 'e', outcome: 'applied', at: NOW })
    }
    const state = store.snapshot().sync
    expect(state?.processedOps).toHaveLength(5000)
    expect(repo.isProcessed('op-0')).toBe(false)
    expect(repo.isProcessed('op-5004')).toBe(true)
  })
})