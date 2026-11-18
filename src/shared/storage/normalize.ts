import type {
  ConversationMessage,
  EventStatus,
  EventVariant,
  InputModality,
  OriginDevice,
  ReminderRecord,
  ScheduleEvent,
  SyncStatus
} from '@shared/domain/types'
import type {
  ChangeKind,
  ChangeRecord,
  ConflictRecord,
  DeviceStatus,
  MobileConflict,
  MobileDb,
  MobileEvent,
  MobileSettings,
  MobileSyncState,
  OutboxChange,
  PairingState,
  ProcessedOp,
  SyncState,
  TrustedDevice
} from '@shared/sync/types'

export const SYNC_STATE_SCHEMA_VERSION = 1
export const MOBILE_SCHEMA_VERSION = 1

const MAX_TRUSTED_DEVICES = 3

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOf(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function enumOr<E extends string>(value: unknown, fallback: E): E {
  return typeof value === 'string' ? (value as E) : fallback
}

function normalizeChangeRecord(raw: unknown): ChangeRecord | undefined {
  if (!isRecord(raw)) return undefined
  const seq = numberOr(raw.seq, 0)
  if (seq <= 0) return undefined
  return {
    seq,
    eventId: stringOf(raw.eventId, ''),
    revision: numberOr(raw.revision, 0),
    kind: enumOr<ChangeKind>(raw.kind, 'upsert'),
    originDevice: stringOf(raw.originDevice, 'desktop'),
    at: numberOr(raw.at, 0)
  }
}

function normalizeTrustedDevice(raw: unknown, index: number): TrustedDevice | undefined {
  if (!isRecord(raw)) return undefined
  const status = enumOr<DeviceStatus>(raw.status, 'trusted')
  return {
    deviceId: stringOf(raw.deviceId, `device-${index + 1}`),
    name: stringOf(raw.name, ''),
    platform: 'android',
    pairedAt: numberOr(raw.pairedAt, 0),
    ...(typeof raw.lastSeenAt === 'number' ? { lastSeenAt: raw.lastSeenAt } : {}),
    ...(typeof raw.lastSyncAt === 'number' ? { lastSyncAt: raw.lastSyncAt } : {}),
    status: index >= MAX_TRUSTED_DEVICES && status === 'trusted' ? 'expired' : status,
    permission: 'read_write',
    credentialFingerprint: stringOf(raw.credentialFingerprint, ''),
    credentialVault: enumOr(raw.credentialVault, 'plain'),
    revocationEpoch: numberOr(raw.revocationEpoch, 0),
    lastClientSeq: numberOr(raw.lastClientSeq, 0),
    lastAckedCursor: numberOr(raw.lastAckedCursor, 0),
    appVersionCode: numberOr(raw.appVersionCode, 0)
  }
}

function normalizeConflictRecord(raw: unknown): ConflictRecord | undefined {
  if (!isRecord(raw)) return undefined
  const desktop = isRecord(raw.desktopSnapshot) ? raw.desktopSnapshot : {}
  const mobile = isRecord(raw.mobileSnapshot) ? raw.mobileSnapshot : {}
  return {
    conflictId: stringOf(raw.conflictId, ''),
    eventId: stringOf(raw.eventId, ''),
    type: enumOr(raw.type, 'both_modified'),
    desktopSnapshot: {
      title: stringOf(desktop.title, ''),
      startAt: numberOr(desktop.startAt, 0),
      endAt: numberOr(desktop.endAt, 0),
      ...(typeof desktop.location === 'string' ? { location: desktop.location } : {}),
      ...(typeof desktop.note === 'string' ? { note: desktop.note } : {})
    },
    mobileSnapshot: {
      title: stringOf(mobile.title, ''),
      startAt: numberOr(mobile.startAt, 0),
      endAt: numberOr(mobile.endAt, 0),
      ...(typeof mobile.location === 'string' ? { location: mobile.location } : {}),
      ...(typeof mobile.note === 'string' ? { note: mobile.note } : {})
    },
    deviceId: stringOf(raw.deviceId, ''),
    createdAt: numberOr(raw.createdAt, 0),
    status: enumOr(raw.status, 'pending'),
    ...(typeof raw.resolution === 'string' ? { resolution: raw.resolution as ConflictRecord['resolution'] } : {}),
    ...(typeof raw.resolvedAt === 'number' ? { resolvedAt: raw.resolvedAt } : {}),
    ...(typeof raw.archivedAt === 'number' ? { archivedAt: raw.archivedAt } : {})
  }
}

function normalizeProcessedOp(raw: unknown): ProcessedOp | undefined {
  if (!isRecord(raw)) return undefined
  const opId = stringOf(raw.opId, '')
  if (opId.length === 0) return undefined
  return {
    opId,
    deviceId: stringOf(raw.deviceId, ''),
    eventId: stringOf(raw.eventId, ''),
    outcome: stringOf(raw.outcome, ''),
    at: numberOr(raw.at, 0)
  }
}

function normalizePairingState(raw: unknown): PairingState | undefined {
  if (!isRecord(raw)) return undefined
  return {
    codeDigest: stringOf(raw.codeDigest, ''),
    expiresAt: numberOr(raw.expiresAt, 0),
    attempts: numberOr(raw.attempts, 0),
    ...(typeof raw.lockedUntil === 'number' ? { lockedUntil: raw.lockedUntil } : {}),
    ...(typeof raw.nonceDigest === 'string' ? { nonceDigest: raw.nonceDigest } : {})
  }
}

export function createSyncState(_now: number, deviceId?: string): SyncState {
  return {
    schemaVersion: SYNC_STATE_SCHEMA_VERSION,
    deviceId: deviceId ?? '',
    enabled: false,
    changeSeq: 0,
    changeLog: [],
    devices: [],
    conflicts: [],
    processedOps: []
  }
}

export function normalizeSyncState(raw: unknown, now: number, deviceId?: string): SyncState {
  const base = createSyncState(now, deviceId)
  if (!isRecord(raw)) return base
  const devices = asArray<unknown>(raw.devices)
    .map((item, index) => normalizeTrustedDevice(item, index))
    .filter((item): item is TrustedDevice => item !== undefined)
  const pairing = normalizePairingState(raw.pairing)
  return {
    schemaVersion: SYNC_STATE_SCHEMA_VERSION,
    deviceId: stringOf(raw.deviceId, base.deviceId),
    enabled: raw.enabled === true,
    changeSeq: numberOr(raw.changeSeq, 0),
    changeLog: asArray<unknown>(raw.changeLog)
      .map((item) => normalizeChangeRecord(item))
      .filter((item): item is ChangeRecord => item !== undefined),
    devices,
    conflicts: asArray<unknown>(raw.conflicts)
      .map((item) => normalizeConflictRecord(item))
      .filter((item): item is ConflictRecord => item !== undefined),
    processedOps: asArray<unknown>(raw.processedOps)
      .map((item) => normalizeProcessedOp(item))
      .filter((item): item is ProcessedOp => item !== undefined),
    ...(pairing ? { pairing } : {})
  }
}

export function createMobileSettings(): MobileSettings {
  return {
    theme: 'light',
    reminderEnabled: true,
    notifyShowTitle: false,
    syncEnabled: false,
    exactAlarmAcknowledged: false,
    weekViewMode: 'list'
  }
}

export function normalizeMobileSettings(raw: unknown): MobileSettings {
  const base = createMobileSettings()
  if (!isRecord(raw)) return base
  return {
    theme: enumOr(raw.theme, base.theme),
    reminderEnabled: raw.reminderEnabled !== false,
    notifyShowTitle: raw.notifyShowTitle === true,
    syncEnabled: raw.syncEnabled === true,
    exactAlarmAcknowledged: raw.exactAlarmAcknowledged === true,
    weekViewMode: enumOr(raw.weekViewMode, base.weekViewMode)
  }
}

export function normalizeMobileEvent(raw: unknown): MobileEvent {
  const value = isRecord(raw) ? raw : {}
  return {
    eventId: stringOf(value.eventId, ''),
    title: stringOf(value.title, ''),
    startAt: numberOr(value.startAt, 0),
    endAt: numberOr(value.endAt, 0),
    ...(typeof value.location === 'string' ? { location: value.location } : {}),
    ...(typeof value.note === 'string' ? { note: value.note } : {}),
    sourceModality: enumOr<InputModality>(value.sourceModality, 'text'),
    status: enumOr<EventStatus>(value.status, 'active'),
    createdAt: numberOr(value.createdAt, 0),
    updatedAt: numberOr(value.updatedAt, 0),
    contentRevision: numberOr(value.contentRevision, 0),
    originDevice: enumOr<OriginDevice>(value.originDevice, 'desktop'),
    syncStatus: enumOr<SyncStatus>(value.syncStatus, 'synced'),
    baseRevision: numberOr(value.baseRevision, 0),
    variant: enumOr<EventVariant>(value.variant, 'authoritative'),
    ...(typeof value.variantOrigin === 'string' ? { variantOrigin: value.variantOrigin as OriginDevice } : {}),
    ...(typeof value.cancelledAt === 'number' ? { cancelledAt: value.cancelledAt } : {}),
    ...(typeof value.conflictId === 'string' ? { conflictId: value.conflictId } : {})
  }
}

export function normalizeEventForDesktop(raw: unknown): ScheduleEvent {
  const value = isRecord(raw) ? raw : {}
  return {
    ...(value as unknown as ScheduleEvent),
    contentRevision: numberOr(value.contentRevision, 0),
    originDevice: enumOr<OriginDevice>(value.originDevice, 'desktop'),
    syncStatus: enumOr<SyncStatus>(value.syncStatus, 'synced'),
    baseRevision: numberOr(value.baseRevision, 0),
    variant: enumOr<EventVariant>(value.variant, 'authoritative'),
    ...(typeof value.variantOrigin === 'string' ? { variantOrigin: value.variantOrigin as OriginDevice } : {}),
    ...(typeof value.cancelledAt === 'number' ? { cancelledAt: value.cancelledAt } : {}),
    ...(typeof value.conflictId === 'string' ? { conflictId: value.conflictId } : {})
  }
}

export function normalizeOutboxChange(raw: unknown): OutboxChange | undefined {
  if (!isRecord(raw)) return undefined
  const opId = stringOf(raw.opId, '')
  if (opId.length === 0) return undefined
  return {
    opId,
    eventId: stringOf(raw.eventId, ''),
    kind: enumOr<ChangeKind>(raw.kind, 'upsert'),
    baseRevision: numberOr(raw.baseRevision, 0),
    revision: numberOr(raw.revision, 0),
    ...(isRecord(raw.event) ? { event: normalizeMobileEvent(raw.event) } : {}),
    ...(typeof raw.cancelledAt === 'number' ? { cancelledAt: raw.cancelledAt } : {}),
    enqueuedAt: numberOr(raw.enqueuedAt, 0),
    attempts: numberOr(raw.attempts, 0),
    ...(typeof raw.lastErrorCode === 'string' ? { lastErrorCode: raw.lastErrorCode } : {})
  }
}

function normalizeMobileConflict(raw: unknown): MobileConflict | undefined {
  if (!isRecord(raw)) return undefined
  const desktop = isRecord(raw.desktopSnapshot) ? raw.desktopSnapshot : {}
  const mobile = isRecord(raw.mobileSnapshot) ? raw.mobileSnapshot : {}
  return {
    conflictId: stringOf(raw.conflictId, ''),
    eventId: stringOf(raw.eventId, ''),
    type: stringOf(raw.type, 'both_modified'),
    desktopSnapshot: {
      title: stringOf(desktop.title, ''),
      startAt: numberOr(desktop.startAt, 0),
      endAt: numberOr(desktop.endAt, 0),
      ...(typeof desktop.location === 'string' ? { location: desktop.location } : {}),
      ...(typeof desktop.note === 'string' ? { note: desktop.note } : {})
    },
    mobileSnapshot: {
      title: stringOf(mobile.title, ''),
      startAt: numberOr(mobile.startAt, 0),
      endAt: numberOr(mobile.endAt, 0),
      ...(typeof mobile.location === 'string' ? { location: mobile.location } : {}),
      ...(typeof mobile.note === 'string' ? { note: mobile.note } : {})
    },
    createdAt: numberOr(raw.createdAt, 0),
    status: enumOr(raw.status, 'pending'),
    ...(typeof raw.resolution === 'string' ? { resolution: raw.resolution as MobileConflict['resolution'] } : {})
  }
}

export function createMobileSyncState(now: number, deviceId?: string): MobileSyncState {
  void now
  return {
    deviceId: deviceId ?? '',
    cursor: 0,
    changeSeq: 0,
    clockOffsetMs: 0,
    protocolVersion: 1
  }
}

function normalizeMobileSyncState(raw: unknown, now: number): MobileSyncState {
  const base = createMobileSyncState(now)
  if (!isRecord(raw)) return base
  return {
    deviceId: stringOf(raw.deviceId, base.deviceId),
    ...(typeof raw.peerDeviceId === 'string' ? { peerDeviceId: raw.peerDeviceId } : {}),
    ...(typeof raw.peerAddress === 'string' ? { peerAddress: raw.peerAddress } : {}),
    ...(typeof raw.peerFingerprintShort === 'string' ? { peerFingerprintShort: raw.peerFingerprintShort } : {}),
    ...(typeof raw.peerName === 'string' ? { peerName: raw.peerName } : {}),
    cursor: numberOr(raw.cursor, 0),
    changeSeq: numberOr(raw.changeSeq, 0),
    ...(typeof raw.lastSyncAt === 'number' ? { lastSyncAt: raw.lastSyncAt } : {}),
    ...(typeof raw.lastResult === 'string' ? { lastResult: raw.lastResult as MobileSyncState['lastResult'] } : {}),
    ...(typeof raw.baselineEstablishedAt === 'number' ? { baselineEstablishedAt: raw.baselineEstablishedAt } : {}),
    clockOffsetMs: numberOr(raw.clockOffsetMs, 0),
    protocolVersion: numberOr(raw.protocolVersion, 1)
  }
}

export function createEmptyMobileDb(now: number): MobileDb {
  return {
    schemaVersion: MOBILE_SCHEMA_VERSION,
    revision: 0,
    events: [],
    reminders: [],
    messages: [],
    outbox: [],
    conflicts: [],
    sync: createMobileSyncState(now),
    settings: createMobileSettings()
  }
}

export function normalizeMobileDb(raw: unknown, now: number): MobileDb {
  const base = createEmptyMobileDb(now)
  if (!isRecord(raw)) return base
  return {
    schemaVersion: MOBILE_SCHEMA_VERSION,
    revision: numberOr(raw.revision, 0),
    events: asArray<unknown>(raw.events).map((item) => normalizeMobileEvent(item)),
    reminders: asArray<ReminderRecord>(raw.reminders),
    messages: asArray<ConversationMessage>(raw.messages),
    outbox: asArray<unknown>(raw.outbox)
      .map((item) => normalizeOutboxChange(item))
      .filter((item): item is OutboxChange => item !== undefined),
    conflicts: asArray<unknown>(raw.conflicts)
      .map((item) => normalizeMobileConflict(item))
      .filter((item): item is MobileConflict => item !== undefined),
    sync: normalizeMobileSyncState(raw.sync, now),
    settings: normalizeMobileSettings(raw.settings)
  }
}