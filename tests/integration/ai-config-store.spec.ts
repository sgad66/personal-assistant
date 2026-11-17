import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPresetCatalog } from '@shared/ai/preset-catalog'
import { VersionedConfigStore } from '@main/ai/config-store'
import { MemoryVault } from '@main/ai/credential-vault'

const catalog = getPresetCatalog()
const NOW = 1_700_000_000_000

function createStore(dir: string, filePath = join(dir, 'ai-config.json')): VersionedConfigStore {
  return new VersionedConfigStore({
    filePath,
    vault: new MemoryVault(() => NOW),
    clock: () => NOW,
    catalog
  })
}

describe('配置存储：读取与迁移', () => {
  it('首次读取生成 v2 空壳，默认文本为本地解析', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-store-'))
    const store = createStore(dir)
    const loaded = store.read()
    expect(loaded.config.version).toBe(2)
    expect(loaded.config.status).toBe('local')
    expect(loaded.config.channels.text.mode).toBe('local')
    expect(loaded.config.channels.text.enabled).toBe(true)
    expect(loaded.config.channels.vision.mode).toBe('local')
    expect(loaded.config.channels.asr.availability).toBe('available')
  })

  it('旧服务迁移到本地模式，不载入旧服务密钥', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-store-v1-'))
    const filePath = join(dir, 'ai-config.json')
    const v1 = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-legacy-9876',
      model: 'gpt-4o-mini',
      visionModel: 'gpt-4o-mini',
      asrModel: 'whisper-1'
    }
    writeFileSync(filePath, JSON.stringify(v1), 'utf-8')
    const before = readFileSync(filePath, 'utf-8')
    const store = createStore(dir, filePath)
    const loaded = store.read()
    expect(loaded.migrated).toBe(true)
    expect(loaded.config.channels.text.presetId).toBe('custom')
    expect(loaded.config.keys.length).toBe(0)
    expect(loaded.config.status).toBe('local')
    expect(readFileSync(filePath, 'utf-8')).toBe(before)
  })

  it('损坏文件返回读取失败且不覆盖原文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-store-bad-'))
    const filePath = join(dir, 'ai-config.json')
    writeFileSync(filePath, '{not json', 'utf-8')
    const store = createStore(dir, filePath)
    const loaded = store.read()
    expect(loaded.loadError?.code).toBe('E_CONFIG_READ_FAIL')
    expect(readFileSync(filePath, 'utf-8')).toBe('{not json')
  })

  it('高版本配置拒绝读取', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-store-v3-'))
    const filePath = join(dir, 'ai-config.json')
    writeFileSync(filePath, JSON.stringify({ version: 3, channels: {} }), 'utf-8')
    const store = createStore(dir, filePath)
    const loaded = store.read()
    expect(loaded.loadError?.code).toBe('E_CONFIG_READ_FAIL')
  })

  it('读取旧严格模式配置时恢复本地媒体模型', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-store-solution-'))
    const filePath = join(dir, 'ai-config.json')
    const first = createStore(dir, filePath)
    const loaded = first.read()
    const committed = first.commit({ ...loaded.config, solution: 'deepseek_strict' })
    expect(committed.ok).toBe(true)
    const beforeRaw = readFileSync(filePath, 'utf-8')
    const beforeMtime = statSync(filePath).mtimeMs
    const again = createStore(dir, filePath)
    const reread = again.read()
    expect(reread.config.solution).toBeUndefined()
    expect(reread.config.channels.asr.model).toBe('SenseVoiceSmall')
    expect(readFileSync(filePath, 'utf-8')).toBe(beforeRaw)
    expect(statSync(filePath).mtimeMs).toBe(beforeMtime)
  })

  it('缺少 solution 与含未知字段时不报错、不改写文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-store-unknown-'))
    const filePath = join(dir, 'ai-config.json')
    const seed = createStore(dir, filePath)
    const base = seed.read().config
    const raw = JSON.stringify({ ...base, sourceNotes: { vision: 'Groq' } })
    writeFileSync(filePath, raw, 'utf-8')
    const store = createStore(dir, filePath)
    const loaded = store.read()
    expect(loaded.loadError).toBeUndefined()
    expect(loaded.config.solution).toBeUndefined()
    expect(loaded.config.channels.text.presetId).toBe(base.channels.text.presetId)
    expect(readFileSync(filePath, 'utf-8')).toBe(raw)
  })
})

describe('配置存储：原子提交', () => {
  it('提交成功后磁盘为 v2 且内存与磁盘一致', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-store-commit-'))
    const store = createStore(dir)
    const loaded = store.read()
    const committed = store.commit({ ...loaded.config, lastSavedAt: NOW })
    expect(committed.ok).toBe(true)
    const persisted = JSON.parse(readFileSync(join(dir, 'ai-config.json'), 'utf-8')) as { version: number }
    expect(persisted.version).toBe(2)
    expect(store.current().lastSavedAt).toBe(NOW)
  })

  it('提交失败时内存与磁盘均保持不变', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-store-fail-'))
    const store = createStore(dir)
    const loaded = store.read()
    store.commit({ ...loaded.config, lastSavedAt: 111 })
    const beforeRaw = readFileSync(join(dir, 'ai-config.json'), 'utf-8')
    const beforeMemory = store.current()
    const broken = new VersionedConfigStore({
      filePath: dir,
      vault: new MemoryVault(() => NOW),
      clock: () => NOW,
      catalog
    })
    const failed = broken.commit({ ...loaded.config, lastSavedAt: 222 })
    expect(failed.ok).toBe(false)
    expect(readFileSync(join(dir, 'ai-config.json'), 'utf-8')).toBe(beforeRaw)
    expect(store.current()).toEqual(beforeMemory)
  })
})
describe('配置存储：档位读写', () => {
  it('写入档位不改变版本且可回读', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-store-timeout-'))
    const store = createStore(dir)
    const loaded = store.read()
    expect(loaded.config.version).toBe(2)
    expect(loaded.config.timeouts).toBeUndefined()
    const committed = store.commit({ ...loaded.config, timeouts: { relaxed: true } })
    expect(committed.ok).toBe(true)
    const persisted = JSON.parse(readFileSync(join(dir, 'ai-config.json'), 'utf-8')) as {
      version: number
      timeouts: { relaxed: boolean }
    }
    expect(persisted.version).toBe(2)
    expect(persisted.timeouts.relaxed).toBe(true)
    const reread = createStore(dir).read()
    expect(reread.config.timeouts?.relaxed).toBe(true)
    expect(reread.migrated).toBe(false)
  })

  it('未变更档位再保存不产生 timeouts 键', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-store-no-timeout-'))
    const store = createStore(dir)
    const loaded = store.read()
    store.commit({ ...loaded.config, lastSavedAt: NOW })
    const persisted = JSON.parse(readFileSync(join(dir, 'ai-config.json'), 'utf-8')) as Record<string, unknown>
    expect('timeouts' in persisted).toBe(false)
    expect(persisted.version).toBe(2)
  })
})
