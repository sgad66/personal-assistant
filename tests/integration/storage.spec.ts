import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataStore } from '@main/storage/data-store'
import { ReminderRepository } from '@main/storage/reminder-repository'
import { TempFileManager } from '@main/temp-file-manager'

const FIXED_NOW = new Date(2026, 10, 9, 10, 0, 0, 0).getTime()

describe('本地持久化', () => {
  it('写入后重启可完整读取', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-store-'))
    const filePath = join(dir, 'data.json')
    const first = new DataStore({ filePath, clock: () => FIXED_NOW })
    first.write((draft) => {
      draft.events.push({
        eventId: 'evt_1',
        title: '重启完整性',
        startAt: FIXED_NOW + 3_600_000,
        endAt: FIXED_NOW + 7_200_000,
        sourceModality: 'text',
        hasConflict: false,
        status: 'active',
        reminderStatus: 'not_reminded',
        snoozeCount: 0,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW
      })
    })

    const second = new DataStore({ filePath, clock: () => FIXED_NOW })
    expect(second.loadFailed).toBe(false)
    expect(second.snapshot().events).toHaveLength(1)
    expect(second.snapshot().events[0]?.title).toBe('重启完整性')
  })

  it('文件损坏时降级为空库并标记读取失败', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-store-bad-'))
    const filePath = join(dir, 'data.json')
    writeFileSync(filePath, '{this is not json', 'utf-8')
    const store = new DataStore({ filePath, clock: () => FIXED_NOW })
    expect(store.loadFailed).toBe(true)
    expect(store.snapshot().events).toHaveLength(0)
    const backups = readdirSync(dir).filter((name) => name.includes('.corrupt-'))
    expect(backups.length).toBe(1)
  })

  it('事务失败时内存与磁盘均无残留', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-store-tx-'))
    const filePath = join(dir, 'data.json')
    const store = new DataStore({ filePath, clock: () => FIXED_NOW })
    const failed = store.write(() => {
      throw new Error('injected')
    })
    expect(failed.ok).toBe(false)
    const reloaded = new DataStore({ filePath, clock: () => FIXED_NOW })
    expect(reloaded.snapshot().events).toHaveLength(0)
    expect(reloaded.snapshot().reminders).toHaveLength(0)
  })
})

describe('提醒记录幂等', () => {
  it('同一事项重复 upsert 只保留一条待处理记录', () => {
    const store = new DataStore({ clock: () => FIXED_NOW })
    const reminders = new ReminderRepository(store)
    const event = {
      eventId: 'evt_rem',
      title: '提醒事项',
      startAt: FIXED_NOW + 3_600_000,
      endAt: FIXED_NOW + 7_200_000,
      sourceModality: 'text' as const,
      hasConflict: false,
      status: 'active' as const,
      reminderStatus: 'not_reminded' as const,
      snoozeCount: 0,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW
    }
    reminders.upsertForEvent(event, FIXED_NOW)
    reminders.upsertForEvent(event, FIXED_NOW)
    const pending = reminders.allPending()
    expect(pending.ok).toBe(true)
    if (!pending.ok) return
    expect(pending.data).toHaveLength(1)
    expect(pending.data[0]?.plannedAt).toBe(event.startAt - 10 * 60 * 1000)
  })
})

describe('临时文件生命周期', () => {
  it('落盘后可强制释放，目录恢复为空', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-temp-'))
    const manager = new TempFileManager(dir)
    const path = manager.stageBytes('voice.webm', new Uint8Array([1, 2, 3]), 'voice')
    expect(manager.isEmpty()).toBe(false)
    manager.release(path)
    expect(manager.isEmpty()).toBe(true)
  })

  it('releaseAll 清理全部登记文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-temp-all-'))
    const manager = new TempFileManager(dir)
    manager.stageBytes('a.png', new Uint8Array([1]), 'image')
    manager.stageBytes('b.png', new Uint8Array([2]), 'image')
    expect(manager.isEmpty()).toBe(false)
    manager.releaseAll()
    expect(manager.isEmpty()).toBe(true)
  })
})