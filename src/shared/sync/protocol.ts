import { z } from 'zod'
import type { EventStatus, EventVariant, InputModality, OriginDevice } from '@shared/domain/types'
import type {
  ChangeKind,
  ConflictResolution,
  ConflictType,
  DeviceStatus,
  EventSnapshot,
  SyncLastResult
} from './types'

export const SYNC_PROTOCOL_VERSION = 1
export const SYNC_PROTOCOL_MIN = 1
export const SYNC_PROTOCOL_MAX = 1

export const SYNC_PATHS = {
  health: '/sync/v1/health',
  pairBegin: '/sync/v1/pair/begin',
  pairComplete: '/sync/v1/pair/complete',
  status: '/sync/v1/status',
  pull: '/sync/v1/pull',
  push: '/sync/v1/push',
  ack: '/sync/v1/ack',
  calibrate: '/sync/v1/calibrate',
  conflictResolve: '/sync/v1/conflict/resolve',
  deviceProfile: '/sync/v1/device/profile',
  aiParse: '/ai/v1/parse',
  webAuth: '/web/v1/auth',
  webAssets: '/m/*'
} as const

export const SYNC_LIMITS = {
  batchEvents: 200,
  pushBatch: 200,
  requestBytes: 2 * 1024 * 1024,
  ratePerMinute: 30,
  pairingCodeTtlMs: 5 * 60 * 1000,
  pairingLockMs: 10 * 60 * 1000,
  pairingMaxAttempts: 5,
  maxDevices: 3,
  mediaBytes: 10 * 1024 * 1024,
  mediaMs: 60_000,
  proxyBudgetMs: 8000,
  conflictRetentionMs: 30 * 24 * 3600 * 1000,
  changeLogMinRetain: 5000,
  processedOpsMax: 5000
} as const

export interface SyncEnvelope {
  iv: string
  tag: string
  data: string
}

export interface SyncedEvent {
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
  variant: EventVariant
  variantOrigin?: OriginDevice
  importSourceLabel?: string
}

export interface ChangeDto {
  seq: number
  eventId: string
  kind: ChangeKind
  revision: number
  originDevice: string
  event?: SyncedEvent
  cancelledAt?: number
}

export interface OutboundChangeDto {
  opId: string
  eventId: string
  kind: ChangeKind
  baseRevision: number
  revision: number
  event?: SyncedEvent
  cancelledAt?: number
}

export interface PushResultDto {
  opId: string
  outcome: 'applied' | 'duplicate' | 'conflict' | 'rejected'
  eventId: string
  revision?: number
  conflictId?: string
  errorCode?: string
}

export interface StatusRequest {
  cursor: number
  conflictAckCount?: number
}

export interface StatusResponse {
  online: true
  changeSeq: number
  cursor: number
  pendingConflictCount: number
  serverTime: number
  protocolVersion: number
  compatible: true
}

export interface ConflictSummaryDto {
  conflictId: string
  eventId: string
  type: ConflictType
  desktopSnapshot: EventSnapshot
  mobileSnapshot: EventSnapshot
  deviceId: string
  createdAt: number
  status: 'pending' | 'resolved'
}

export interface EventRefDto {
  eventId: string
  revision: number
  hash: string
}

export interface DuplicateGroupDto {
  eventIds: string[]
  title: string
  startAt: number
}

export interface PullRequest {
  since: number
  limit?: number
}

export interface PullResponse {
  cursor: number
  hasMore: boolean
  serverTime: number
  changeSeq: number
  changes: ChangeDto[]
  conflicts: ConflictSummaryDto[]
  duplicateGroups?: DuplicateGroupDto[]
}

export interface PushRequest {
  batchId: string
  cursor: number
  changes: OutboundChangeDto[]
}

export interface PushResponse {
  appliedCursor: number
  results: PushResultDto[]
  serverTime: number
  conflictCount: number
}

export interface AckRequest {
  cursor: number
  appliedSeqs: number[]
  appliedOpIds: string[]
  lastSyncResult?: SyncLastResult
}

export interface AckResponse {
  cursor: number
  lastSyncAt: number
  conflictCount: number
  changeSeq: number
}

export interface CalibrateRequest {
  cursor: number
  digests: EventRefDto[]
}

export interface CalibrateResponse {
  missingOnMobile: EventRefDto[]
  missingOnDesktop: EventRefDto[]
  hashMismatch: EventRefDto[]
  cursor: number
  serverTime: number
}

export interface ConflictResolveRequest {
  conflictId: string
  choice: ConflictResolution
  keepBothTitleSuffix?: string
}

export interface ConflictResolveResponse {
  conflictId: string
  status: 'resolved'
  eventId: string
  newEventId?: string
  resultingRevision: number
  serverTime: number
}

export interface DeviceProfileRequest {
  name: string
}

export interface DeviceProfileResponse {
  deviceId: string
  name: string
  updatedAt: number
}

export interface PairBeginRequest {
  deviceId: string
  deviceName: string
  ephemeralPub: string
  appVersionName: string
  appVersionCode: number
  contractVersion: number
  protocolVersion: number
}

export interface PairBeginResponse {
  serverEphemeralPub: string
  serverNonce: string
  serverFingerprintShort: string
  expiresAt: number
  protocolVersion: number
  minProtocol: number
  maxProtocol: number
}

export interface PairCompleteRequest {
  pairingCode: string
  deviceId: string
  deviceName: string
  fingerprintConfirm: string
}

export interface PairCompleteResponse {
  deviceSecret: string
  deviceId: string
  serverTime: number
  credentialFingerprint: string
  syncCursor: number
}

export interface HealthResponse {
  service: 'pa-sync'
  protocolVersion: number
  minProtocol: number
  maxProtocol: number
  serverFingerprintShort: string
  serverTime: number
  pairingAvailable: boolean
  deviceCount: number
  maxDevices: number
}

export interface TrustedDeviceDto {
  deviceId: string
  name: string
  platform: 'android'
  pairedAt: number
  lastSeenAt?: number
  lastSyncAt?: number
  status: DeviceStatus
}

const envelopeSchema = z
  .object({ iv: z.string().min(1), tag: z.string().min(1), data: z.string().min(1) })
  .strict()

const syncedEventSchema = z
  .object({
    title: z.string(),
    startAt: z.number(),
    endAt: z.number(),
    location: z.string().optional(),
    note: z.string().optional(),
    sourceModality: z.enum(['text', 'voice', 'image', 'composite']),
    status: z.enum(['active', 'cancelled']),
    createdAt: z.number(),
    updatedAt: z.number(),
    contentRevision: z.number().int().min(0),
    originDevice: z.enum(['desktop', 'mobile']),
    variant: z.enum(['authoritative', 'conflict']),
    variantOrigin: z.enum(['desktop', 'mobile']).optional(),
    importSourceLabel: z.string().optional()
  })
  .strict()

const upsertChangeSchema = z
  .object({
    opId: z.string().min(1),
    eventId: z.string().min(1),
    kind: z.literal('upsert'),
    baseRevision: z.number().int().min(0),
    revision: z.number().int().min(0),
    event: syncedEventSchema
  })
  .strict()

const tombstoneChangeSchema = z
  .object({
    opId: z.string().min(1),
    eventId: z.string().min(1),
    kind: z.literal('tombstone'),
    baseRevision: z.number().int().min(0),
    revision: z.number().int().min(0),
    event: syncedEventSchema.optional(),
    cancelledAt: z.number().optional()
  })
  .strict()

export const outboundChangeSchema = z.union([upsertChangeSchema, tombstoneChangeSchema])

const pullChangeUpsertSchema = z
  .object({
    seq: z.number().int().positive(),
    eventId: z.string().min(1),
    kind: z.literal('upsert'),
    revision: z.number().int().min(0),
    originDevice: z.string().min(1),
    event: syncedEventSchema
  })
  .strict()

const pullChangeTombstoneSchema = z
  .object({
    seq: z.number().int().positive(),
    eventId: z.string().min(1),
    kind: z.literal('tombstone'),
    revision: z.number().int().min(0),
    originDevice: z.string().min(1),
    event: syncedEventSchema.optional(),
    cancelledAt: z.number().optional()
  })
  .strict()

export const changeSchema = z.union([pullChangeUpsertSchema, pullChangeTombstoneSchema])

export const statusRequestSchema = z
  .object({ cursor: z.number().int().min(0), conflictAckCount: z.number().int().min(0).optional() })
  .strict()

export const pullRequestSchema = z
  .object({ since: z.number().int().min(0), limit: z.number().int().min(1).max(SYNC_LIMITS.batchEvents).optional() })
  .strict()

export const pushRequestSchema = z
  .object({
    batchId: z.string().min(1),
    cursor: z.number().int().min(0),
    changes: z.array(outboundChangeSchema).max(SYNC_LIMITS.pushBatch)
  })
  .strict()

export const ackRequestSchema = z
  .object({
    cursor: z.number().int().min(0),
    appliedSeqs: z.array(z.number().int().min(0)),
    appliedOpIds: z.array(z.string()),
    lastSyncResult: z.enum(['success', 'partial', 'failed', 'cancelled']).optional()
  })
  .strict()

const eventRefSchema = z
  .object({ eventId: z.string().min(1), revision: z.number().int().min(0), hash: z.string().min(1) })
  .strict()

export const calibrateRequestSchema = z
  .object({ cursor: z.number().int().min(0), digests: z.array(eventRefSchema) })
  .strict()

export const conflictResolveSchema = z
  .object({
    conflictId: z.string().min(1),
    choice: z.enum(['desktop', 'mobile', 'both']),
    keepBothTitleSuffix: z.string().optional()
  })
  .strict()

export { envelopeSchema, syncedEventSchema, eventRefSchema }

export function syncPathList(): readonly string[] {
  return Object.values(SYNC_PATHS)
}