import { SYNC_LIMITS } from '@shared/sync/protocol'
import type { ConflictRecord, ConflictResolution, ConflictType, EventSnapshot, SyncState } from '@shared/sync/types'

export interface UpsertConflictInput {
  conflictId: string
  eventId: string
  type: ConflictType
  desktopSnapshot: EventSnapshot
  mobileSnapshot: EventSnapshot
  deviceId: string
}

export function upsertConflict(state: SyncState, input: UpsertConflictInput, now: number): SyncState {
  const pending = state.conflicts.find(
    (conflict) => conflict.eventId === input.eventId && conflict.status === 'pending'
  )
  if (pending) {
    return {
      ...state,
      conflicts: state.conflicts.map((conflict) =>
        conflict.conflictId === pending.conflictId
          ? {
              ...conflict,
              type: input.type,
              desktopSnapshot: input.desktopSnapshot,
              mobileSnapshot: input.mobileSnapshot
            }
          : conflict
      )
    }
  }
  const record: ConflictRecord = {
    conflictId: input.conflictId,
    eventId: input.eventId,
    type: input.type,
    desktopSnapshot: input.desktopSnapshot,
    mobileSnapshot: input.mobileSnapshot,
    deviceId: input.deviceId,
    createdAt: now,
    status: 'pending'
  }
  return { ...state, conflicts: [...state.conflicts, record] }
}

export function closeConflict(
  state: SyncState,
  conflictId: string,
  resolution: ConflictResolution,
  now: number
): SyncState {
  return {
    ...state,
    conflicts: state.conflicts.map((conflict) =>
      conflict.conflictId === conflictId
        ? { ...conflict, status: 'resolved', resolution, resolvedAt: now }
        : conflict
    )
  }
}

export function archiveResolved(state: SyncState, now: number): SyncState {
  const cutoff = now - SYNC_LIMITS.conflictRetentionMs
  return {
    ...state,
    conflicts: state.conflicts.map((conflict) =>
      conflict.status === 'resolved' &&
      conflict.resolvedAt !== undefined &&
      conflict.resolvedAt < cutoff &&
      conflict.archivedAt === undefined
        ? { ...conflict, archivedAt: now }
        : conflict
    )
  }
}

export function pendingOf(state: SyncState): readonly ConflictRecord[] {
  return state.conflicts.filter((conflict) => conflict.status === 'pending')
}