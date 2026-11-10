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

function createService(options?: { readonly brokenPath?: boolean }): {
  service: AiConfigService
  store: VersionedConfigStore
  registry: ProviderRegistry
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
    emit: (notice) => emitted.push(notice)
  })
  service.initialize()
  return { service, store, registry, emitted, filePath }
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