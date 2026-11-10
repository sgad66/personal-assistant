import type { PaBridge } from '@shared/ipc-contracts'

declare global {
  interface Window {
    readonly pa: PaBridge
    readonly paContractVersion: number
  }
}

export {}