import type { DataStore } from '../storage/data-store'
import type { Result } from '@shared/result'
import { createSyncState } from '@shared/storage/normalize'
import { SYNC_LIMITS } from '@shared/sync/protocol'
import type { ChangeRecord, ConflictRecord, ProcessedOp, SyncState, TrustedDevice } from '@shared/sync/types'

export class SyncRepository {
  constructor(
    private readonly store: DataStore,
    private readonly clock: () => number = () => store.now()
  ) {}

  readSync(): SyncState | undefined {
    return this.store.snapshot().sync
  }

  stateOf(): SyncState {
    return this.readSync() ?? createSyncState(this.clock())
  }

  updateSync<T>(work: (state: SyncState) => T): Result<T> {
    return this.store.write((draft) => {
      const state = draft.sync ?? createSyncState(this.clock())
      const value = work(state)
      draft.sync = state
      return value
    })
  }

  nextSeq(): Result<number> {
    return this.updateSync((state) => {
      state.changeSeq += 1
      return state.changeSeq
    })
  }

  appendChange(record: ChangeRecord): Result<void> {
    return this.updateSync((state) => {
      if (record.seq > state.changeSeq) state.changeSeq = record.seq
      state.changeLog.push(record)
    })
  }

  devicesOf(): readonly TrustedDevice[] {
    return this.readSync()?.devices ?? []
  }

  conflictsOf(): readonly ConflictRecord[] {
    return this.readSync()?.conflicts ?? []
  }

  isProcessed(opId: string): boolean {
    return (this.readSync()?.processedOps ?? []).some((op) => op.opId === opId)
  }

  markProcessed(op: ProcessedOp): Result<void> {
    return this.updateSync((state) => {
      const existing = state.processedOps.findIndex((item) => item.opId === op.opId)
      if (existing >= 0) state.processedOps.splice(existing, 1)
      state.processedOps.push(op)
      if (state.processedOps.length > SYNC_LIMITS.processedOpsMax) {
        state.processedOps.splice(0, state.processedOps.length - SYNC_LIMITS.processedOpsMax)
      }
    })
  }
}