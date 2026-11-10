import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
    expect(loaded.config.channels.vision.enabled).toBe(false)
  })

  it('v1 读取迁移不写盘且 Key 被封装', () => {
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
    expect(loaded.config.keys.length).toBe(1)
    expect(loaded.config.keys[0]?.keyMask).toBe('••••9876')
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