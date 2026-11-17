import type { SyncedEvent } from '@shared/sync/protocol'

export const TEST_NOW = 1_700_000_000_000

export function makeSyncedEvent(overrides: Partial<SyncedEvent> = {}): SyncedEvent {
  return {
    title: '项目周会',
    startAt: TEST_NOW + 3_600_000,
    endAt: TEST_NOW + 7_200_000,
    sourceModality: 'text',
    status: 'active',
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    contentRevision: 1,
    originDevice: 'desktop',
    variant: 'authoritative',
    ...overrides
  }
}

export function makePairBegin(deviceId: string): Record<string, unknown> {
  return {
    deviceId,
    deviceName: `手机-${deviceId}`,
    ephemeralPub: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    appVersionName: '1.0.0',
    appVersionCode: 1,
    contractVersion: 2,
    protocolVersion: 1
  }
}