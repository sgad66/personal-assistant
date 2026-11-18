import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { messageKeyOf } from '@shared/error-catalog'
import { fail, ok, type AppError, type Result } from '@shared/result'
import {
  migrateLegacyConfig, emptyShellConfig, localMediaBinding,
  type AiAccessConfig,
  type AiConfigWarning,
  type PresetKeyRecord
} from '@shared/ai/access-config'
import type { PresetCatalog } from '@shared/ai/preset-catalog'
import type { ICredentialVault, SealedSecret } from './credential-vault'

export interface ConfigLoadResult {
  readonly config: AiAccessConfig
  readonly migrated: boolean
  readonly warnings: readonly AiConfigWarning[]
  readonly loadError?: AppError
}

export interface ConfigStoreOptions {
  readonly filePath: string
  readonly vault: ICredentialVault
  readonly clock: () => number
  readonly catalog: PresetCatalog
}

/**
 * 版本化配置存储：读取时迁移（不写盘），写入时临时文件 + rename，成功后才替换内存快照。
 */
export class VersionedConfigStore {
  private config: AiAccessConfig | undefined
  private readonly options: ConfigStoreOptions

  constructor(options: ConfigStoreOptions) {
    this.options = options
  }

  read(): ConfigLoadResult {
    const now = this.options.clock()
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.options.filePath, 'utf-8')) as unknown
    } catch (error) {
      if (isMissingFile(error)) {
        const migration = migrateLegacyConfig(undefined, now, this.options.catalog)
        this.config = migration.config
        return { config: migration.config, migrated: false, warnings: migration.warnings }
      }
      const shell = migrateLegacyConfig(undefined, now, this.options.catalog).config
      this.config = shell
      return {
        config: shell,
        migrated: false,
        warnings: [],
        loadError: {
          code: 'E_CONFIG_READ_FAIL',
          messageKey: messageKeyOf('E_CONFIG_READ_FAIL'),
          retryable: true
        }
      }
    }

    const migration = migrateLegacyConfig(raw, now, this.options.catalog)
    if (migration.error) {
      this.config = migration.config
      return {
        config: migration.config,
        migrated: false,
        warnings: migration.warnings,
        loadError: migration.error
      }
    }

    const sealedKeys: PresetKeyRecord[] = migration.config.keys.slice()
    for (const pending of migration.pendingSecrets) {
      const sealed: SealedSecret = this.options.vault.seal(pending.presetId, pending.secret)
      sealedKeys.push({
        presetId: sealed.presetId,
        keyMask: sealed.masked,
        sealed: sealed.sealed,
        vault: sealed.vault,
        updatedAt: sealed.updatedAt
      })
    }

    const config: AiAccessConfig = {
      ...migration.config,
      keys: sealedKeys,
      lastSavedAt: raw !== undefined && typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>).lastSavedAt === 'number'
        ? (raw as Record<string, unknown>).lastSavedAt as number
        : migration.config.lastSavedAt
    }
    const keys = config.keys.filter(key => key.presetId === 'deepseek')
    const deepseek = config.channels.text.enabled && config.channels.text.mode === 'ai' &&
      config.channels.text.presetId === 'deepseek' && keys.length > 0
    const localText = emptyShellConfig(now).channels.text
    const normalized: AiAccessConfig = {
      ...config,
      channels: {
        text: deepseek
          ? { ...config.channels.text, endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-flash', availability: 'available' }
          : { ...localText, presetId: keys.length ? 'deepseek' : 'custom' },
        vision: localMediaBinding('vision'),
        asr: localMediaBinding('asr')
      },
      keys,
      solution: undefined,
      status: deepseek ? 'deepseek_solution' : 'local'
    }
    this.config = normalized
    return {
      config: normalized,
      migrated: migration.migrated,
      warnings: migration.warnings,
      ...(migration.error ? { loadError: migration.error } : {})
    }
  }

  current(): AiAccessConfig {
    if (!this.config) {
      const loaded = this.read()
      return loaded.config
    }
    return this.config
  }

  commit(candidate: AiAccessConfig): Result<void> {
    const tmp = `${this.options.filePath}.tmp`
    try {
      mkdirSync(dirname(this.options.filePath), { recursive: true })
      writeFileSync(tmp, JSON.stringify(candidate), 'utf-8')
      renameSync(tmp, this.options.filePath)
    } catch (error) {
      try {
        rmSync(tmp, { force: true })
      } catch {
        // 清理失败不阻断
      }
      return fail('E_CONFIG_WRITE_FAIL', messageKeyOf('E_CONFIG_WRITE_FAIL'), true, {
        details: { reason: error instanceof Error ? error.message : 'unknown' }
      })
    }
    this.config = candidate
    return ok(undefined)
  }
}

function isMissingFile(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: string }).code
  return code === 'ENOENT'
}