import type { ChangeKind, ChangeRecord, SyncState } from '@shared/sync/types'
import { SYNC_LIMITS } from '@shared/sync/protocol'

export interface AppendChangeInput {
  eventId: string
  revision: number
  kind: ChangeKind
  originDevice: string
}

export function appendChange(
  state: SyncState,
  input: AppendChangeInput,
  now: number
): { state: SyncState; seq: number } {
  const seq = state.changeSeq + 1
  const record: ChangeRecord = { ...input, seq, at: now }
  return {
    state: { ...state, changeSeq: seq, changeLog: [...state.changeLog, record] },
    seq
  }
}

export function changesSince(
  state: SyncState,
  since: number,
  limit: number,
  excludeDeviceId?: string
): ChangeRecord[] {
  const capped = Math.min(Math.max(limit, 0), SYNC_LIMITS.batchEvents)
  return state.changeLog
    .filter((record) => record.seq > since)
    .filter((record) => (excludeDeviceId === undefined ? true : record.originDevice !== excludeDeviceId))
    .sort((left, right) => left.seq - right.seq)
    .slice(0, capped)
}

export function trimChangeLog(
  state: SyncState,
  deviceCursors: readonly number[],
  now: number
): SyncState {
  const cutoff = now - SYNC_LIMITS.conflictRetentionMs
  const minCursor = deviceCursors.length > 0 ? Math.min(...deviceCursors) : 0
  const tailStart = Math.max(state.changeLog.length - SYNC_LIMITS.changeLogMinRetain, 0)
  const keep: ChangeRecord[] = []

  state.changeLog.forEach((record, index) => {
    const fresh = record.at >= cutoff
    const recent = index >= tailStart
    const needed = record.seq > minCursor
    if (fresh || recent || needed) keep.push(record)
  })

  return {
    ...state,
    changeLog: keep.sort((left, right) => left.seq - right.seq).slice(-SYNC_LIMITS.changeLogMinRetain)
  }
}

export function isCursorExpired(state: SyncState, cursor: number): boolean {
  const first = state.changeLog[0]
  if (!first) return false
  return cursor < first.seq - 1
}