import type { AiConfigChangedNotice, AccessStatus } from '@shared/ipc-contracts'

export function aiConfigChangedMessage(revision: number, status: AccessStatus): AiConfigChangedNotice {
  return { revision, status }
}

export function fakeSealedKey(presetId: string, tail: string): {
  readonly presetId: string
  readonly keyMask: string
  readonly sealed: string
  readonly vault: 'plain'
  readonly updatedAt: number
} {
  return {
    presetId,
    keyMask: `••••${tail}`,
    sealed: `sealed-${presetId}-${tail}`,
    vault: 'plain',
    updatedAt: 1000
  }
}