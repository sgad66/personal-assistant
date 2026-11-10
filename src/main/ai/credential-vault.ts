import { randomUUID } from 'node:crypto'
import { maskSecret } from '@shared/ai/access-config'
import type { PresetId } from '@shared/ai/preset-catalog'

export interface SealedSecret {
  readonly presetId: PresetId
  readonly masked: string
  readonly sealed: string
  readonly vault: 'safe_storage' | 'plain'
  readonly updatedAt: number
}

export interface ICredentialVault {
  readonly kind: 'safe_storage' | 'plain'
  seal(presetId: PresetId, secret: string): SealedSecret
  open(record: Pick<SealedSecret, 'sealed' | 'vault'>): string | undefined
  maskOf(secret: string): string
}

export class MemoryVault implements ICredentialVault {
  readonly kind = 'plain' as const
  private readonly store = new Map<string, string>()
  private readonly clock: () => number

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock
  }

  seal(presetId: PresetId, secret: string): SealedSecret {
    const sealed = `mem_${randomUUID()}`
    this.store.set(sealed, secret)
    return {
      presetId,
      masked: maskSecret(secret),
      sealed,
      vault: 'plain',
      updatedAt: this.clock()
    }
  }

  open(record: Pick<SealedSecret, 'sealed' | 'vault'>): string | undefined {
    return this.store.get(record.sealed)
  }

  maskOf(secret: string): string {
    return maskSecret(secret)
  }
}

/**
 * 受限文件包装：在无法使用系统加密时使用 base64 包装（仅混淆，不作为安全边界）。
 * 对外仍只暴露 keyMask。
 */
export class PlainFileVault implements ICredentialVault {
  readonly kind = 'plain' as const
  constructor(private readonly clock: () => number = () => Date.now()) {}

  seal(presetId: PresetId, secret: string): SealedSecret {
    return {
      presetId,
      masked: maskSecret(secret),
      sealed: Buffer.from(secret, 'utf-8').toString('base64'),
      vault: 'plain',
      updatedAt: this.clock()
    }
  }

  open(record: Pick<SealedSecret, 'sealed' | 'vault'>): string | undefined {
    try {
      return Buffer.from(record.sealed, 'base64').toString('utf-8')
    } catch {
      return undefined
    }
  }

  maskOf(secret: string): string {
    return maskSecret(secret)
  }
}