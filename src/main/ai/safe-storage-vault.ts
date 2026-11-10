import { safeStorage } from 'electron'
import { maskSecret } from '@shared/ai/access-config'
import type { PresetId } from '@shared/ai/preset-catalog'
import type { ICredentialVault, SealedSecret } from './credential-vault'

/**
 * 系统安全存储封装。仅在 Electron 主进程中使用；
 * safeStorage 不可用时由调用方回落到 PlainFileVault。
 */
export class SafeStorageVault implements ICredentialVault {
  readonly kind = 'safe_storage' as const
  private readonly usable: boolean

  constructor(private readonly clock: () => number = () => Date.now()) {
    let usable = false
    try {
      usable = safeStorage.isEncryptionAvailable()
    } catch {
      usable = false
    }
    this.usable = usable
  }

  get isUsable(): boolean {
    return this.usable
  }

  seal(presetId: PresetId, secret: string): SealedSecret {
    if (!this.usable) {
      return {
        presetId,
        masked: maskSecret(secret),
        sealed: Buffer.from(secret, 'utf-8').toString('base64'),
        vault: 'plain',
        updatedAt: this.clock()
      }
    }
    return {
      presetId,
      masked: maskSecret(secret),
      sealed: safeStorage.encryptString(secret).toString('base64'),
      vault: 'safe_storage',
      updatedAt: this.clock()
    }
  }

  open(record: Pick<SealedSecret, 'sealed' | 'vault'>): string | undefined {
    try {
      const buffer = Buffer.from(record.sealed, 'base64')
      if (record.vault === 'safe_storage' && this.usable) {
        return safeStorage.decryptString(buffer)
      }
      return buffer.toString('utf-8')
    } catch {
      return undefined
    }
  }

  maskOf(secret: string): string {
    return maskSecret(secret)
  }
}