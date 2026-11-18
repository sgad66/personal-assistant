import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiAccessConfigInput, AiConfigChangedNotice, ChannelBindingInput } from '@shared/ipc-contracts'
import { getPresetCatalog, findPreset } from '@shared/ai/preset-catalog'
import { VersionedConfigStore } from '@main/ai/config-store'
import { MemoryVault } from '@main/ai/credential-vault'
import { ProviderRegistry } from '@main/ai/provider-registry'
import { AiConfigService } from '@main/ai/config-service'
import { resolveAccess } from '@main/ai/provider-resolver'
import { silentLogger } from '@main/observability/logger'
import { AiDiagnosticsStore } from '@main/observability/ai-diagnostics'

const catalog = getPresetCatalog()
const NOW = 1_700_000_000_000

function groqBinding(channel: 'text' | 'vision' | 'asr'): ChannelBindingInput {
  const groq = findPreset('groq')
  return {
    enabled: true,
    mode: 'ai',
    presetId: 'groq',
    endpoint: groq?.endpoint ?? '',
    model: groq?.models[channel] ?? '',
    source: 'preset_default'
  }
}

function createService(options?: { readonly brokenPath?: boolean; readonly withDiagnostics?: boolean }): {
  service: AiConfigService
  store: VersionedConfigStore
  registry: ProviderRegistry
  vault: MemoryVault
  emitted: AiConfigChangedNotice[]
  filePath: string
} {
  const dir = mkdtempSync(join(tmpdir(), 'ai-service-'))
  const filePath = options?.brokenPath ? dir : join(dir, 'ai-config.json')
  const vault = new MemoryVault(() => NOW)
  const store = new VersionedConfigStore({ filePath, vault, clock: () => NOW, catalog })
  const registry = new ProviderRegistry(
    resolveAccess(store.read().config, 1, { catalog, vault, logger: silentLogger })
  )
  const emitted: AiConfigChangedNotice[] = []
  const service = new AiConfigService({
    store,
    vault,
    catalog,
    catalogState: 'ok',
    clock: () => NOW,
    logger: silentLogger,
    registry,
    ...(options?.withDiagnostics ? { diagnostics: new AiDiagnosticsStore(null) } : {}),
    emit: (notice) => emitted.push(notice)
  })
  service.initialize()
  return { service, store, registry, vault, emitted, filePath }
}

function groqInput(overrides?: Partial<AiAccessConfigInput>): AiAccessConfigInput {
  return {
    expectedVersion: 2,
    channels: {
      text: groqBinding('text'),
      vision: groqBinding('vision'),
      asr: groqBinding('asr')
    },
    keyOps: [{ op: 'set', presetId: 'groq', secret: 'gsk-test-1234' }],
    ...overrides
  }
}

describe('AI 配置服务：保存与生效', () => {
  it('保存免费推荐组合后状态与快照同步更新', async () => {
    const { service, registry, emitted, filePath } = createService()
    const outcome = await service.save(groqInput())
    expect(outcome.ok).toBe(true)
    expect(outcome.view?.status).toBe('free_recommended')
    expect(outcome.view?.channels.text.hasKey).toBe(true)
    expect(outcome.view?.channels.text.keyMask).toBe('••••1234')
    expect(JSON.stringify(outcome.view).includes('gsk-test-1234')).toBe(false)
    expect(emitted.length).toBe(1)
    expect(registry.current().text.kind).toBe('ready')
    const persisted = JSON.parse(readFileSync(filePath, 'utf-8')) as { version: number; status: string }
    expect(persisted.version).toBe(2)
    expect(persisted.status).toBe('free_recommended')
  })

  it('视觉通道清除 Key 后文本仍可用（通道隔离）', async () => {
    const { service, registry } = createService()
    await service.save(groqInput())
    const current = service.current()
    const second = await service.save({
      expectedVersion: 2,
      channels: {
        text: {
          enabled: true,
          mode: 'ai',
          presetId: 'groq',
          endpoint: findPreset('groq')?.endpoint ?? '',
          model: current.channels.text.model,
          source: 'preset_default'
        },
        vision: {
          enabled: true,
          mode: 'ai',
          presetId: 'gemini',
          endpoint: findPreset('gemini')?.endpoint ?? '',
          model: 'gemini-2.0-flash',
          source: 'preset_default'
        },
        asr: {
          enabled: false,
          mode: 'ai',
          presetId: 'groq',
          endpoint: findPreset('groq')?.endpoint ?? '',
          model: current.channels.asr.model,
          source: 'preset_default'
        }
      },
      keyOps: [
        { op: 'keep', presetId: 'groq' },
        { op: 'set', presetId: 'gemini', secret: 'gemini-test-5678' }
      ]
    })
    expect(second.ok).toBe(true)
    expect(registry.current().text.kind).toBe('ready')
    expect(registry.current().vision.kind).toBe('ready')
  })

  it('保存校验失败不落盘不发布', async () => {
    const { service, registry, emitted, filePath } = createService()
    const before = registry.current()
    const outcome = await service.save({
      expectedVersion: 2,
      channels: {
        text: { ...groqBinding('text'), endpoint: 'http://not-https.example.com' },
        vision: groqBinding('vision'),
        asr: groqBinding('asr')
      },
      keyOps: [{ op: 'set', presetId: 'groq', secret: 'gsk-test-1234' }]
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.issues?.[0]?.field).toBe('endpoint')
    expect(outcome.issues?.[0]?.code).toBe('E_AI_ENDPOINT_INVALID')
    expect(emitted.length).toBe(0)
    expect(registry.current()).toEqual(before)
    expect(existsSync(filePath)).toBe(false)
  })

  it('落盘失败时返回写入错误且内存快照不变', async () => {
    const { service, registry } = createService({ brokenPath: true })
    const before = registry.current()
    const outcome = await service.save(groqInput())
    expect(outcome.ok).toBe(false)
    expect(outcome.error?.code).toBe('E_CONFIG_WRITE_FAIL')
    expect(registry.current()).toEqual(before)
  })

  it('并发保存只落盘一次且只广播一次', async () => {
    const { service, emitted } = createService()
    const [first, second] = await Promise.all([service.save(groqInput()), service.save(groqInput())])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(emitted.length).toBe(1)
  })

  it('v1 入参且 apiKey 为空时保留已存 Key', async () => {
    const { service } = createService()
    const first = await service.save({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-old-1234',
      model: 'gpt-4o-mini',
      visionModel: 'gpt-4o-mini',
      asrModel: 'whisper-1'
    })
    expect(first.ok).toBe(true)
    const outcome = await service.save({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      visionModel: 'gpt-4o-mini',
      asrModel: 'whisper-1'
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.view?.channels.text.hasKey).toBe(true)
    expect(outcome.view?.channels.text.keyMask).toBe('••••1234')
  })

  it('测试连接不写盘、不改变当前快照', async () => {
    const { service, store } = createService()
    const before = store.current()
    const result = await service.testConnection({
      channel: 'text',
      binding: groqBinding('text'),
      secret: 'gsk-test-1234'
    })
    expect(result.resultStatus).toBe('success')
    expect(store.current()).toEqual(before)
  })

  it('测试连接缺少 Key 时返回未配置', async () => {
    const { service } = createService()
    const result = await service.testConnection({
      channel: 'vision',
      binding: groqBinding('vision')
    })
    expect(result.resultStatus).toBe('failure')
    expect(result.error?.code).toBe('E_AI_PROVIDER_NOT_CONFIGURED')
  })

  it('不支持的语音预设返回明确错误码', async () => {
    const { service } = createService()
    const gemini = findPreset('gemini')
    const result = await service.testConnection({
      channel: 'asr',
      binding: {
        enabled: true,
        mode: 'ai',
        presetId: 'gemini',
        endpoint: gemini?.endpoint ?? '',
        model: 'gemini-2.0-flash',
        source: 'preset_default'
      },
      secret: 'secret'
    })
    expect(result.resultStatus).toBe('failure')
    expect(result.error?.code).toBe('E_ASR_UNSUPPORTED')
  })
})
function deepseekBinding(channel: 'text' | 'vision' | 'asr'): ChannelBindingInput {
  const deepseek = findPreset('deepseek')
  return {
    enabled: true,
    mode: 'ai',
    presetId: 'deepseek',
    endpoint: deepseek?.endpoint ?? '',
    model: channel === 'text' ? 'deepseek-chat' : deepseek?.models[channel] ?? '',
    source: 'preset_default'
  }
}

function deepseekSolutionInput(
  overrides?: Partial<AiAccessConfigInput>
): AiAccessConfigInput {
  return {
    expectedVersion: 2,
    channels: {
      text: deepseekBinding('text'),
      vision: groqBinding('vision'),
      asr: groqBinding('asr')
    },
    keyOps: [
      { op: 'set', presetId: 'deepseek', secret: 'sk-deepseek-1234' },
      { op: 'set', presetId: 'groq', secret: 'gsk-groq-5678' }
    ],
    solution: 'deepseek_default',
    ...overrides
  }
}

function strictInput(overrides?: Partial<AiAccessConfigInput>): AiAccessConfigInput {
  return {
    expectedVersion: 2,
    channels: {
      text: deepseekBinding('text'),
      vision: { ...deepseekBinding('vision'), enabled: false },
      asr: { ...deepseekBinding('asr'), enabled: false }
    },
    keyOps: [
      { op: 'set', presetId: 'deepseek', secret: 'sk-deepseek-1234' },
      { op: 'set', presetId: 'groq', secret: 'gsk-groq-5678' }
    ],
    solution: 'deepseek_strict',
    ...overrides
  }
}

describe('DeepSeek 方案保存与检查配置', () => {
  it('保存 DeepSeek 默认方案后状态与方案标识同步', async () => {
    const { service, registry, emitted } = createService()
    const outcome = await service.save(deepseekSolutionInput())
    expect(outcome.ok).toBe(true)
    expect(outcome.view?.status).toBe('deepseek_solution')
    expect(service.current().solution).toBe('deepseek_default')
    expect(registry.current().text.kind).toBe('ready')
    expect(registry.current().text.presetId).toBe('deepseek')
    expect(registry.current().vision.presetId).toBe('groq')
    expect(registry.current().asr.presetId).toBe('groq')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.channelStates).toEqual({
      text: 'available',
      vision: 'available',
      asr: 'available'
    })
    expect(JSON.stringify(emitted[0]).includes('sk-deepseek-1234')).toBe(false)
    expect(JSON.stringify(emitted[0]).includes('api.deepseek.com')).toBe(false)
  })

  it('保存严格模式后图片与语音停用且状态为仅文字', async () => {
    const { service } = createService()
    const outcome = await service.save(strictInput())
    expect(outcome.ok).toBe(true)
    expect(outcome.view?.status).toBe('deepseek_text_only')
    expect(outcome.view?.channels.vision.enabled).toBe(false)
    expect(outcome.view?.channels.vision.presetId).toBe('deepseek')
    expect(outcome.view?.channels.asr.enabled).toBe(false)
    expect(service.currentChannelStates()).toEqual({
      text: 'available',
      vision: 'unsupported',
      asr: 'unsupported'
    })
  })

  it('清除 DeepSeek Key 不影响 Groq 通道，文本回落未配置', async () => {
    const { service, store, vault } = createService()
    await service.save(deepseekSolutionInput())
    const current = service.current()
    const config = {
      ...current,
      keys: current.keys.filter((key) => key.presetId !== 'deepseek')
    }
    const access = resolveAccess(config, 2, { catalog, vault, logger: silentLogger })
    expect(access.vision.kind).toBe('ready')
    expect(access.asr.kind).toBe('ready')
    expect(access.text.kind).toBe('not_configured')
    expect(store.current().keys.some((key) => key.presetId === 'groq')).toBe(true)
  })

  it('检查配置对不支持通道零探测并优先返回能力缺口', async () => {
    const { service } = createService()
    const asr = await service.testConnection({
      channel: 'asr',
      binding: { ...deepseekBinding('asr'), enabled: false }
    })
    expect(asr.error?.code).toBe('E_ASR_UNSUPPORTED')
    expect(asr.durationMs).toBe(0)
    const vision = await service.testConnection({
      channel: 'vision',
      binding: deepseekBinding('vision')
    })
    expect(vision.error?.code).toBe('E_OCR_UNSUPPORTED')
    const noKey = await service.testConnection({
      channel: 'text',
      binding: deepseekBinding('text')
    })
    expect(noKey.error?.code).toBe('E_AI_PROVIDER_NOT_CONFIGURED')
    const noModel = await service.testConnection({
      channel: 'text',
      binding: { ...deepseekBinding('text'), model: '' }
    })
    expect(noModel.error?.code).toBe('E_VALIDATION_FAILED')
  })

  it('保存时方案标识与确认记录落盘且最多 20 条', async () => {
    const { service, filePath } = createService()
    const confirmations = Array.from({ length: 25 }, (_item, index) => ({
      kind: 'keep_fallback' as const,
      at: NOW + index,
      result: 'confirmed' as const,
      channelStates: {
        text: { presetId: 'deepseek' as const, enabled: true },
        vision: { presetId: 'groq' as const, enabled: true },
        asr: { presetId: 'groq' as const, enabled: true }
      }
    }))
    const outcome = await service.save(deepseekSolutionInput({ confirmations }))
    expect(outcome.ok).toBe(true)
    const persisted = JSON.parse(readFileSync(filePath, 'utf-8')) as {
      solution: string
      confirmations: unknown[]
    }
    expect(persisted.solution).toBe('deepseek_default')
    expect(persisted.confirmations).toHaveLength(20)
    expect(JSON.stringify(persisted.confirmations).includes('sealed')).toBe(false)
  })
})
describe('超时档位与诊断视图', () => {
  it('保存宽松档后下次请求按宽松档且版本仍为 2', async () => {
    const { service, registry, filePath } = createService()
    const outcome = await service.save({ ...groqInput(), timeouts: { relaxed: true } })
    expect(outcome.ok).toBe(true)
    expect(outcome.view?.timeouts.relaxed).toBe(true)
    expect(registry.current().timeouts?.relaxed).toBe(true)
    const persisted = JSON.parse(readFileSync(filePath, 'utf-8')) as {
      version: number
      timeouts: { relaxed: boolean }
    }
    expect(persisted.version).toBe(2)
    expect(persisted.timeouts.relaxed).toBe(true)
  })

  it('未传档位时保留已选档位，显式关闭可恢复标准档', async () => {
    const { service, registry, filePath } = createService()
    await service.save({ ...groqInput(), timeouts: { relaxed: true } })
    const kept = await service.save(groqInput())
    expect(kept.ok).toBe(true)
    expect(registry.current().timeouts?.relaxed).toBe(true)
    const persisted = JSON.parse(readFileSync(filePath, 'utf-8')) as { timeouts: { relaxed: boolean } }
    expect(persisted.timeouts.relaxed).toBe(true)
    const restored = await service.save({ ...groqInput(), timeouts: { relaxed: false } })
    expect(restored.ok).toBe(true)
    expect(registry.current().timeouts?.relaxed).toBe(false)
  })

  it('视图包含诊断快照且读取失败不阻断配置', async () => {
    const { service } = createService({ withDiagnostics: true })
    const outcome = await service.save(groqInput())
    expect(outcome.ok).toBe(true)
    const view = service.currentView()
    expect(view.diagnostics?.records).toHaveLength(0)
    expect(view.diagnostics?.readError).toBe(false)
  })
})
