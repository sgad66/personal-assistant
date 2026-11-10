import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AiConfig, AiConfigInput } from '@shared/ipc-contracts'
import { ok, type Result } from '@shared/result'
import type { ProviderConfig } from './providers/types'

const DEFAULT_CONFIG: AiConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  visionModel: 'gpt-4o-mini',
  asrModel: 'whisper-1'
}

export class AiConfigStore {
  private config: AiConfig

  constructor(private readonly filePath: string) {
    this.config = { ...DEFAULT_CONFIG }
    this.load()
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AiConfig>
      this.config = { ...DEFAULT_CONFIG, ...parsed }
    } catch {
      const envConfig = configFromEnv()
      if (envConfig) this.config = envConfig
    }
  }

  get(): AiConfig {
    return { ...this.config }
  }

  set(input: AiConfigInput): Result<AiConfig> {
    this.config = {
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      apiKey: input.apiKey.trim(),
      model: input.model.trim() || DEFAULT_CONFIG.model,
      visionModel: input.visionModel.trim() || DEFAULT_CONFIG.visionModel,
      asrModel: input.asrModel.trim() || DEFAULT_CONFIG.asrModel
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.config), 'utf-8')
    } catch {
      // 凭据保存失败不影响当前会话内使用
    }
    return ok(this.get())
  }

  configured(): boolean {
    return this.config.apiKey.length > 0 && this.config.baseUrl.startsWith('https://')
  }

  providerConfig(): ProviderConfig {
    return {
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      model: this.config.model,
      visionModel: this.config.visionModel,
      asrModel: this.config.asrModel
    }
  }
}

export function configFromEnv(): AiConfig | undefined {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_API_KEY
  if (!apiKey) return undefined
  const baseUrl = process.env.OPENAI_BASE_URL ?? process.env.AI_BASE_URL ?? DEFAULT_CONFIG.baseUrl
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model: process.env.AI_MODEL ?? DEFAULT_CONFIG.model,
    visionModel: process.env.AI_VISION_MODEL ?? DEFAULT_CONFIG.visionModel,
    asrModel: process.env.AI_ASR_MODEL ?? DEFAULT_CONFIG.asrModel
  }
}