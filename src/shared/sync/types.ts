import type {
  ConversationMessage,
  EventStatus,
  EventVariant,
  InputModality,
  OriginDevice,
  ReminderRecord,
  SyncStatus
} from '@shared/domain/types'

export type ChangeKind = 'upsert' | 'tombstone'
export type DeviceStatus = 'trusted' | 'revoked' | 'expired'
export type ConflictType = 'both_modified' | 'cancel_vs_modify' | 'modify_vs_cancel'
export type ConflictResolution = 'desktop' | 'mobile' | 'both'
export type CredentialVaultKind = 'safe_storage' | 'plain'
export type SyncLastResult = 'success' | 'partial' | 'failed' | 'cancelled'

export interface EventSnapshot {
  title: string
  startAt: number
  endAt: number
  location?: string
  note?: string
}

export interface ChangeRecord {
  seq: number
  eventId: string
  revision: number
  kind: ChangeKind
  originDevice: string
  at: number
}

export interface TrustedDevice {
  deviceId: string
  name: string
  platform: 'android'
  pairedAt: number
  lastSeenAt?: number
  lastSyncAt?: number
  status: DeviceStatus
  permission: 'read_write'
  credentialFingerprint: string
  credentialVault: CredentialVaultKind
  revocationEpoch: number
  lastClientSeq: number
  lastAckedCursor: number
  appVersionCode: number
}

export interface ConflictRecord {
  conflictId: string
  eventId: string
  type: ConflictType
  desktopSnapshot: EventSnapshot
  mobileSnapshot: EventSnapshot
  deviceId: string
  createdAt: number
  status: 'pending' | 'resolved'
  resolution?: ConflictResolution
  resolvedAt?: number
  archivedAt?: number
}

export interface ProcessedOp {
  opId: string
  deviceId: string
  eventId: string
  outcome: string
  at: number
}

export interface PairingState {
  codeDigest: string
  expiresAt: number
  attempts: number
  lockedUntil?: number
  nonceDigest?: string
}

export interface SyncState {
  schemaVersion: number
  deviceId: string
  enabled: boolean
  changeSeq: number
  changeLog: ChangeRecord[]
  devices: TrustedDevice[]
  conflicts: ConflictRecord[]
  processedOps: ProcessedOp[]
  pairing?: PairingState
}

export interface MobileEvent {
  eventId: string
  title: string
  startAt: number
  endAt: number
  location?: string
  note?: string
  sourceModality: InputModality
  status: EventStatus
  createdAt: number
  updatedAt: number
  contentRevision: number
  originDevice: OriginDevice
  syncStatus: SyncStatus
  baseRevision: number
  variant: EventVariant
  variantOrigin?: OriginDevice
  cancelledAt?: number
  conflictId?: string
}

export interface OutboxChange {
  opId: string
  eventId: string
  kind: ChangeKind
  baseRevision: number
  revision: number
  event?: MobileEvent
  cancelledAt?: number
  enqueuedAt: number
  attempts: number
  lastErrorCode?: string
}

export interface MobileConflict {
  conflictId: string
  eventId: string
  type: string
  desktopSnapshot: EventSnapshot
  mobileSnapshot: EventSnapshot
  createdAt: number
  status: 'pending' | 'resolved'
  resolution?: ConflictResolution
}

export interface MobileSyncState {
  deviceId: string
  peerDeviceId?: string
  peerAddress?: string
  peerFingerprintShort?: string
  peerName?: string
  cursor: number
  changeSeq: number
  lastSyncAt?: number
  lastResult?: SyncLastResult
  baselineEstablishedAt?: number
  clockOffsetMs: number
  protocolVersion: number
}

export interface MobileSettings {
  theme: 'light' | 'dark'
  reminderEnabled: boolean
  notifyShowTitle: boolean
  syncEnabled: boolean
  exactAlarmAcknowledged: boolean
  weekViewMode: 'list' | 'timeline'
}

export interface MobileDb {
  schemaVersion: number
  revision: number
  events: MobileEvent[]
  reminders: ReminderRecord[]
  messages: ConversationMessage[]
  outbox: OutboxChange[]
  conflicts: MobileConflict[]
  sync: MobileSyncState
  settings: MobileSettings
}