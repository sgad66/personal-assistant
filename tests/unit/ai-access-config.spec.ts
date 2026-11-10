import { describe, expect, it } from 'vitest'
import {
  deriveAvailability,
  deriveStatus,
  migrateLegacyConfig,
  validateChannels,
  projectView,
  type AiAccessConfigInput,
  type ChannelBindingInput
} from '@shared/ai/access-config'
import { getPresetCatalog, findPreset } from '@shared/ai/preset-catalog'

function binding(overrides: Partial<ChannelBindingInput> = {}): ChannelBindingInput {
  return {
    enabled: true,
    mode: 'ai',
    presetId: 'custom',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    source: 'custom_override',
    ...overrides
  }
}

describe('v1 → v2 配置迁移', () => {
  it('旧配置映射为自定义且保留端点与模型', () => {
    const result = migrateLegacyConfig(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-legacy-1234',
        model: 'gpt-4o-mini',
        visionModel: 'gpt-4o-vision',
        asrModel: 'whisper-1'
      },
      1000,
      getPresetCatalog()
    )
    expect(result.migrated).toBe(true)
    expect(result.config.version).toBe(2)
    expect(result.config.channels.text.presetId).toBe('custom')
    expect(result.config.channels.vision.presetId).toBe('custom')
    expect(result.config.channels.asr.presetId).toBe('custom')
    expect(result.config.channels.text.endpoint).toBe('https://api.openai.com/v1')
    expect(result.config.channels.vision.model).toBe('gpt-4o-vision')
    expect(result.config.status).toBe('custom')
    expect(result.config.legacy?.apiKey).toBe('')
    expect(result.pendingSecrets.length).toBe(1)
    expect(result.pendingSecrets[0]?.presetId).toBe('custom')
  })

  it('端点等于某预设默认值时不自动改判', () => {
    const groq = findPreset('groq')
    const result = migrateLegacyConfig(
      {
        baseUrl: groq?.endpoint,
        apiKey: 'sk-legacy-1234',
        model: 'llama-3.3-70b-versatile',
        visionModel: 'x',
        asrModel: 'y'
      },
      1000,
      getPresetCatalog()
    )
    expect(result.config.channels.text.presetId).toBe('custom')
    expect(result.config.status).toBe('custom')
  })

  it('缺少视觉与语音模型时补齐出厂默认且文本不变', () => {
    const result = migrateLegacyConfig(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-legacy-1234',
        model: 'my-model'
      },
      1000,
      getPresetCatalog()
    )
    expect(result.config.channels.text.model).toBe('my-model')
    expect(result.config.channels.vision.model).toBe('gpt-4o-mini')
    expect(result.config.channels.asr.model).toBe('whisper-1')
  })

  it('空 Key 时停用通道且保留端点与模型', () => {
    const result = migrateLegacyConfig(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini',
        visionModel: 'v',
        asrModel: 'a'
      },
      1000,
      getPresetCatalog()
    )
    expect(result.config.channels.text.enabled).toBe(false)
    expect(result.config.channels.text.availability).toBe('missing_key')
    expect(result.config.channels.text.endpoint).toBe('https://api.openai.com/v1')
    expect(result.config.status).toBe('local')
  })

  it('非 HTTPS 端点保留原值并标记无效', () => {
    const result = migrateLegacyConfig(
      {
        baseUrl: 'http://api.example.com',
        apiKey: 'sk-legacy-1234',
        model: 'm',
        visionModel: 'v',
        asrModel: 'a'
      },
      1000,
      getPresetCatalog()
    )
    expect(result.config.channels.text.endpoint).toBe('http://api.example.com')
    expect(result.config.channels.text.availability).toBe('invalid_endpoint')
    expect(result.warnings.some((warning) => warning.code === 'non_https_endpoint')).toBe(true)
  })

  it('高版本配置拒绝读取且不产生可写快照', () => {
    const result = migrateLegacyConfig({ version: 3 }, 1000, getPresetCatalog())
    expect(result.error?.code).toBe('E_CONFIG_READ_FAIL')
    expect(result.config.status).toBe('local')
  })
})

describe('可用性与接入状态派生', () => {
  it('未启用为 disabled，缺 Key 为 missing_key，正常为 available', () => {
    const custom = findPreset('custom')
    expect(deriveAvailability({ ...binding({ enabled: false }), channel: 'vision' }, custom, true)).toBe('disabled')
    expect(deriveAvailability({ ...binding(), channel: 'vision' }, custom, false)).toBe('missing_key')
    expect(deriveAvailability({ ...binding(), channel: 'vision' }, custom, true)).toBe('available')
  })

  it('不支持语音的预设判定为 unsupported', () => {
    const gemini = findPreset('gemini')
    expect(
      deriveAvailability({ ...binding({ presetId: 'gemini' }), channel: 'asr' }, gemini, true)
    ).toBe('unsupported')
  })

  it('本地解析模式可用且状态为 local', () => {
    const channels = {
      text: binding({ mode: 'local', presetId: 'custom', enabled: true }),
      vision: binding({ enabled: false }),
      asr: binding({ enabled: false })
    }
    const entries = new Map(getPresetCatalog().entries.map((entry) => [entry.presetId, entry]))
    expect(deriveStatus(channels, entries, () => false)).toBe('local')
  })

  it('三通道 Groq 默认组合且有 Key 时为免费推荐', () => {
    const channels = {
      text: binding({ presetId: 'groq', endpoint: findPreset('groq')?.endpoint ?? '', model: 'x', source: 'preset_default' }),
      vision: binding({ presetId: 'groq', endpoint: findPreset('groq')?.endpoint ?? '', model: 'x', source: 'preset_default' }),
      asr: binding({ presetId: 'groq', endpoint: findPreset('groq')?.endpoint ?? '', model: 'x', source: 'preset_default' })
    }
    const entries = new Map(getPresetCatalog().entries.map((entry) => [entry.presetId, entry]))
    expect(deriveStatus(channels, entries, (id) => id === 'groq')).toBe('free_recommended')
  })
})

describe('保存前通道校验', () => {
  const catalog = getPresetCatalog()

  function input(channels: Partial<Record<'text' | 'vision' | 'asr', ChannelBindingInput>>): AiAccessConfigInput {
    return {
      expectedVersion: 2,
      channels: {
        text: channels.text ?? binding(),
        vision: channels.vision ?? binding(),
        asr: channels.asr ?? binding()
      },
      keyOps: []
    }
  }

  it('模型为空时定位到 model 字段', () => {
    const issues = validateChannels(input({ text: binding({ model: '' }) }), catalog, () => true)
    expect(issues[0]?.channel).toBe('text')
    expect(issues[0]?.field).toBe('model')
  })

  it('非 HTTPS 端点定位到 endpoint 字段', () => {
    const issues = validateChannels(
      input({ text: binding({ endpoint: 'http://x.com' }) }),
      catalog,
      () => true
    )
    expect(issues[0]?.channel).toBe('text')
    expect(issues[0]?.field).toBe('endpoint')
    expect(issues[0]?.code).toBe('E_AI_ENDPOINT_INVALID')
  })

  it('语音绑定 Gemini 时返回不支持', () => {
    const issues = validateChannels(
      input({
        asr: binding({
          presetId: 'gemini',
          endpoint: findPreset('gemini')?.endpoint ?? '',
          model: 'gemini-2.0-flash',
          source: 'preset_default'
        })
      }),
      catalog,
      () => true
    )
    expect(issues[0]?.channel).toBe('asr')
    expect(issues[0]?.field).toBe('preset')
    expect(issues[0]?.code).toBe('E_ASR_UNSUPPORTED')
  })

  it('视觉绑定 Gemini 属于受支持能力', () => {
    const issues = validateChannels(
      input({
        vision: binding({
          presetId: 'gemini',
          endpoint: findPreset('gemini')?.endpoint ?? '',
          model: 'gemini-2.0-flash',
          source: 'preset_default'
        })
      }),
      catalog,
      () => true
    )
    expect(issues).toHaveLength(0)
  })

  it('启用通道无 Key 时定位到 apiKey', () => {
    const issues = validateChannels(input({}), catalog, () => false)
    expect(issues[0]?.field).toBe('apiKey')
    expect(issues[0]?.code).toBe('E_AI_PROVIDER_NOT_CONFIGURED')
  })

  it('文本本地解析不要求 Key', () => {
    const issues = validateChannels(
      input({
        text: binding({ mode: 'local' }),
        vision: binding({ enabled: false }),
        asr: binding({ enabled: false })
      }),
      catalog,
      () => false
    )
    expect(issues).toHaveLength(0)
  })
})

describe('配置视图投影', () => {
  it('视图不含 sealed 且 apiKey 恒为空串', () => {
    const migrated = migrateLegacyConfig(
      { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-abcdef1234', model: 'm', visionModel: 'v', asrModel: 'a' },
      1000,
      getPresetCatalog()
    )
    const config = {
      ...migrated.config,
      keys: [
        {
          presetId: 'custom' as const,
          keyMask: '••••1234',
          sealed: 'SECRET_SEALED_VALUE',
          vault: 'plain' as const,
          updatedAt: 1000
        }
      ]
    }
    const view = projectView(config, { contractVersion: 2, catalog: getPresetCatalog() })
    expect(view.apiKey).toBe('')
    expect(JSON.stringify(view).includes('SECRET_SEALED_VALUE')).toBe(false)
    expect(view.channels.text.keyMask).toBe('••••1234')
    expect(view.presets.length).toBe(5)
  })
})