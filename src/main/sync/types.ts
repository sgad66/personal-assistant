export type {
  ChangeKind,
  ChangeRecord,
  ConflictRecord,
  ConflictResolution,
  ConflictType,
  CredentialVaultKind,
  DeviceStatus,
  EventSnapshot,
  MobileConflict,
  MobileDb,
  MobileEvent,
  MobileSettings,
  MobileSyncState,
  OutboxChange,
  PairingState,
  ProcessedOp,
  SyncLastResult,
  SyncState,
  TrustedDevice
} from '@shared/sync/types'

/**
 * 互通运行时占位接口：S2 的 SyncServer 实现并在此扩展。
 * S1 只保证"未开启互通时 context.sync 为 undefined"。
 */
export interface SyncRuntime {
  close(): Promise<void>
}