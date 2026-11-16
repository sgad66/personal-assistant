import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AiDiagnosticsStore, type AiFailureDiagnostic } from '@main/observability/ai-diagnostics'
import { migrateLegacyConfig, projectView } from '@shared/ai/access-config'
import { getPresetCatalog } from '@shared/ai/preset-catalog'

function recordAt(at: number): AiFailureDiagnostic {
  return {
    at,
    channel: 'vision',
    boundPresetName: 'Groq（免费推荐）',
    sourceName: 'Groq',
    stage: 'connect_first_byte',
    failureClass: 'timeout',
    durationMs: 8000,
    autoRetried: true,
    retryCount: 1
  }
}

describe('诊断存储', () => {
  it('最多保留 20 条并淘汰最旧', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-diag-'))
    const store = new AiDiagnosticsStore(join(dir, 'ai-diagnostics.json'), () => 1000)
    for (let index = 1; index <= 25; index += 1) {
      store.record(recordAt(index))
    }
    const list = store.list()
    expect(list).toHaveLength(20)
    expect(list[0]?.at).toBe(6)
    expect(list[19]?.at).toBe(25)
  })

  it('序列化内容不含 Key、端点与媒体路径', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-diag-redact-'))
    const filePath = join(dir, 'ai-diagnostics.json')
    const store = new AiDiagnosticsStore(filePath, () => 1000)
    store.record(recordAt(1))
    const raw = JSON.stringify(store.list())
    expect(raw.includes('sk-')).toBe(false)
    expect(raw.includes('https://')).toBe(false)
    expect(raw.includes('.png')).toBe(false)
    expect(raw.includes('.webm')).toBe(false)
    expect(raw.includes('"endpoint"')).toBe(false)
  })

  it('内存模式与损坏文件都不抛错', () => {
    const memory = new AiDiagnosticsStore(null)
    memory.load()
    expect(memory.readFailed()).toBe(false)
    memory.record(recordAt(1))
    expect(memory.list()).toHaveLength(1)

    const dir = mkdtempSync(join(tmpdir(), 'pa-diag-bad-'))
    const filePath = join(dir, 'ai-diagnostics.json')
    writeFileSync(filePath, '{not json', 'utf-8')
    const broken = new AiDiagnosticsStore(filePath)
    broken.load()
    expect(broken.readFailed()).toBe(true)
    expect(broken.list()).toHaveLength(0)
  })

  it('自定义上限与清空可用', () => {
    const store = new AiDiagnosticsStore(null, () => 1000, 5)
    for (let index = 1; index <= 8; index += 1) store.record(recordAt(index))
    expect(store.list()).toHaveLength(5)
    expect(store.list(2)).toHaveLength(2)
    store.clear()
    expect(store.list()).toHaveLength(0)
  })

  it('配置视图透出只读诊断信息', () => {
    const catalog = getPresetCatalog()
    const config = migrateLegacyConfig(
      { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x-1234', model: 'm' },
      1000,
      catalog
    ).config
    const view = projectView(config, {
      contractVersion: 2,
      catalog,
      diagnostics: { records: [recordAt(1)], readError: false }
    })
    expect(view.diagnostics?.records).toHaveLength(1)
    expect(view.diagnostics?.readError).toBe(false)
    expect(JSON.stringify(view.diagnostics).includes('https://')).toBe(false)
  })
})