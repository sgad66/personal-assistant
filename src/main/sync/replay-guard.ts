import { syncFail, syncOk, type SyncResult } from '@shared/sync/errors'

export interface ReplayState {
  lastClientSeq: number
}

/**
 * 每设备单调序号：允许跳号，拒绝重复与倒退。
 * 调用方必须把返回状态与业务写入放在同一次 DataStore.write 中提交。
 */
export function checkAndAdvance<T extends ReplayState>(state: T, seq: number): SyncResult<T> {
  if (!Number.isInteger(seq) || seq < 1) return syncFail('E_M_REPLAY_REJECTED')
  if (seq <= state.lastClientSeq) return syncFail('E_M_REPLAY_REJECTED')
  return syncOk({ ...state, lastClientSeq: seq })
}