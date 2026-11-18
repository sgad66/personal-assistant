import type { EventStatus, OriginDevice } from '@shared/domain/types'
import type { OutboundChangeDto, SyncedEvent } from './protocol'
import type { ConflictType } from './types'

export const CONFLICT_COPY_PREFIX = '[副本]'

export type ConflictKind = ConflictType

export interface ConflictDecision {
  outcome: 'apply_mobile' | 'keep_desktop' | 'apply_tombstone' | 'keep_cancelled' | 'insert' | 'conflict'
  kind?: ConflictKind
  nextRevision: number
  copyOf?: 'mobile' | 'desktop'
}

function revisionOf(incoming: OutboundChangeDto): number {
  return Math.max(incoming.revision, 0)
}

export function decideSync(existing: SyncedEvent | undefined, incoming: OutboundChangeDto): ConflictDecision {
  const mobileRevision = revisionOf(incoming)
  const baseRevision = Math.max(incoming.baseRevision, 0)

  if (!existing) {
    if (incoming.kind === 'tombstone') {
      return { outcome: 'apply_tombstone', nextRevision: Math.max(mobileRevision, 1) }
    }
    return { outcome: 'insert', nextRevision: Math.max(mobileRevision, 1) }
  }

  const desktopRevision = Math.max(existing.contentRevision, 0)
  const nextRevision = Math.max(desktopRevision, mobileRevision) + 1

  if (existing.status === 'cancelled') {
    if (incoming.kind === 'tombstone') {
      return { outcome: 'keep_cancelled', nextRevision: desktopRevision }
    }
    return { outcome: 'conflict', kind: 'modify_vs_cancel', copyOf: 'mobile', nextRevision }
  }

  if (desktopRevision === baseRevision) {
    if (incoming.kind === 'tombstone') {
      return { outcome: 'apply_tombstone', nextRevision }
    }
    return { outcome: 'apply_mobile', nextRevision }
  }

  if (desktopRevision > baseRevision && incoming.kind === 'upsert' && mobileRevision === baseRevision) {
    return { outcome: 'keep_desktop', nextRevision: desktopRevision }
  }

  if (incoming.kind === 'tombstone') {
    return { outcome: 'apply_tombstone', kind: 'cancel_vs_modify', copyOf: 'desktop', nextRevision }
  }

  return { outcome: 'conflict', kind: 'both_modified', copyOf: 'mobile', nextRevision }
}

function eventIdSeed(event: { eventId: string; title: string; startAt: number }, now: number): string {
  const raw = `${event.eventId}|${event.title}|${event.startAt}|${now}`
  let hash = 0
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

export function buildConflictCopy(
  event: SyncedEvent & { eventId: string },
  origin: OriginDevice,
  conflictId: string,
  now: number
): SyncedEvent & { eventId: string; conflictId: string } {
  return {
    eventId: `conflict-${eventIdSeed(event, now)}`,
    title: `${CONFLICT_COPY_PREFIX}${event.title}`,
    startAt: event.startAt,
    endAt: event.endAt,
    ...(event.location !== undefined ? { location: event.location } : {}),
    ...(event.note !== undefined ? { note: event.note } : {}),
    sourceModality: event.sourceModality,
    status: 'active' as EventStatus,
    createdAt: event.createdAt,
    updatedAt: now,
    contentRevision: 1,
    originDevice: event.originDevice,
    variant: 'conflict',
    variantOrigin: origin,
    ...(event.importSourceLabel !== undefined ? { importSourceLabel: event.importSourceLabel } : {}),
    conflictId
  }
}

export function conflictTypeOf(existingCancelled: boolean, incomingKind: OutboundChangeDto['kind']): ConflictType {
  if (existingCancelled) return 'modify_vs_cancel'
  if (incomingKind === 'tombstone') return 'cancel_vs_modify'
  return 'both_modified'
}