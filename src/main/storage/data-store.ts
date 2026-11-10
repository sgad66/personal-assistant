import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ConversationSession, ConversationMessage, ReminderRecord, ScheduleEvent } from '@shared/domain/types'
import { messageKeyOf } from '@shared/error-catalog'
import { fail, ok, type Result } from '@shared/result'

export const SCHEMA_VERSION = 1

export interface DbShape {
  schemaVersion: number
  revision: number
  events: ScheduleEvent[]
  messages: ConversationMessage[]
  session: ConversationSession
  reminders: ReminderRecord[]
}

export function createSession(now: number): ConversationSession {
  return { state: 'idle', updatedAt: now }
}

export function createEmptyDb(now = Date.now()): DbShape {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    events: [],
    messages: [],
    session: createSession(now),
    reminders: []
  }
}

function normalizeDb(raw: unknown, now: number): DbShape {
  const base = createEmptyDb(now)
  if (typeof raw !== 'object' || raw === null) return base
  const value = raw as Partial<DbShape>
  let session: ConversationSession = createSession(now)
  if (typeof value.session === 'object' && value.session !== null) {
    session = { ...session, ...value.session }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: typeof value.revision === 'number' ? value.revision : 0,
    events: Array.isArray(value.events) ? value.events : [],
    messages: Array.isArray(value.messages) ? value.messages : [],
    session,
    reminders: Array.isArray(value.reminders) ? value.reminders : []
  }
}

export class DataStore {
  private data: DbShape
  private readonly filePath: string | null
  private readonly clock: () => number
  loadFailed = false

  constructor(options?: { filePath?: string; clock?: () => number; initial?: DbShape }) {
    this.filePath = options?.filePath ?? null
    this.clock = options?.clock ?? (() => Date.now())
    this.data = options?.initial ? normalizeDb(options.initial, this.clock()) : createEmptyDb(this.clock())
    if (this.filePath) {
      this.load()
    }
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) {
      this.persistOrThrow()
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as unknown
      this.data = normalizeDb(raw, this.clock())
    } catch {
      this.loadFailed = true
      if (this.filePath) {
        try {
          copyFileSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
        } catch {
          // 备份失败不影响空库启动
        }
      }
      this.data = createEmptyDb(this.clock())
    }
  }

  private persistOrThrow(): void {
    if (!this.filePath) return
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data), 'utf-8')
    renameSync(tmp, this.filePath)
  }

  snapshot(): DbShape {
    return structuredClone(this.data)
  }

  read<T>(work: (db: DbShape) => T): Result<T> {
    try {
      return ok(work(structuredClone(this.data)))
    } catch (error) {
      return fail('E_STORE_READ_FAIL', messageKeyOf('E_STORE_READ_FAIL'), true, {
        details: { reason: error instanceof Error ? error.message : 'unknown' }
      })
    }
  }

  /**
   * 原子写入：在副本上执行全部变更，持久化成功后才替换内存状态；任一环节失败整体回滚。
   */
  write<T>(work: (draft: DbShape) => T): Result<T> {
    const draft = structuredClone(this.data)
    let result: T
    try {
      result = work(draft)
    } catch (error) {
      return fail('E_STORE_WRITE_FAIL', messageKeyOf('E_STORE_WRITE_FAIL'), true, {
        details: { reason: error instanceof Error ? error.message : 'unknown' }
      })
    }
    draft.revision = this.data.revision + 1
    const previous = this.data
    this.data = draft
    try {
      this.persistOrThrow()
    } catch (error) {
      this.data = previous
      return fail('E_STORE_WRITE_FAIL', messageKeyOf('E_STORE_WRITE_FAIL'), true, {
        details: { reason: error instanceof Error ? error.message : 'unknown' }
      })
    }
    return ok(result)
  }

  get revision(): number {
    return this.data.revision
  }

  now(): number {
    return this.clock()
  }

  get session(): ConversationSession {
    return this.data.session
  }

  close(): void {
    if (!this.filePath) return
    try {
      this.persistOrThrow()
    } catch {
      // 关闭时持久化失败不抛出
    }
  }
}

export function memoryStore(clock?: () => number): DataStore {
  return new DataStore({ clock })
}