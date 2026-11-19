import { describe, expect, it } from 'vitest'
import { at, createHarness } from '../helpers/harness'
import { MAX_MEMORIES } from '@main/services/memory-service'

describe('长期记忆服务', () => {
  it('新增记忆并按置顶与更新时间排序', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const first = harness.memories.add('我更喜欢上午开会', 'preference', 'user')
    expect(first.ok).toBe(true)
    harness.setNow(at(2026, 11, 9, 10, 5))
    harness.memories.add('我住在杭州', 'profile', 'user')
    const list = harness.memories.list()
    expect(list).toHaveLength(2)
    if (!first.ok) return
    harness.memories.update(first.data.memoryId, { pinned: true })
    expect(harness.memories.list()[0]?.content).toBe('我更喜欢上午开会')
  })

  it('内容相同或包含时合并，不重复堆积', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    harness.memories.add('我喜欢把会议安排在上午', 'preference', 'user')
    const result = harness.memories.addMany(
      [
        { content: '我喜欢把会议安排在上午', kind: 'preference', confidence: 0.9 },
        { content: '我喜欢把会议安排在上午，尤其是周一', kind: 'preference', confidence: 0.95 }
      ],
      'ai'
    )
    expect(result.added).toBe(0)
    expect(result.merged).toBeGreaterThanOrEqual(1)
    const list = harness.memories.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.content).toContain('尤其是周一')
  })

  it('按查询词检索相关记忆', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    harness.memories.add('我的生日是5月20日', 'profile', 'user')
    harness.memories.add('我更喜欢上午开会', 'preference', 'user')
    const result = harness.memories.retrieve('生日提醒', 5)
    expect(result.some((item) => item.content.includes('生日'))).toBe(true)
    expect(result.some((item) => item.content.includes('会议'))).toBe(false)
  })

  it('超过上限时淘汰低价值记忆并保留置顶项', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const pinned = harness.memories.add('最重要的一条记忆', 'fact', 'user')
    expect(pinned.ok).toBe(true)
    if (!pinned.ok) return
    harness.memories.update(pinned.data.memoryId, { pinned: true })
    for (let index = 0; index < MAX_MEMORIES + 8; index += 1) {
      harness.memories.add(`编号记录${index}号`, 'fact', 'user')
    }
    const list = harness.memories.list()
    expect(list.length).toBeLessThanOrEqual(MAX_MEMORIES)
    expect(list.some((item) => item.memoryId === pinned.data.memoryId)).toBe(true)
  })

  it('迁移旧记忆并标记来源', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const imported = harness.memories.importLegacy(['会议尽量安排在工作日上午', '会议尽量安排在工作日上午'])
    expect(imported).toBeGreaterThan(0)
    const list = harness.memories.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.source).toBe('legacy')
  })

  it('修改、删除与清空', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const created = harness.memories.add('我喜欢晚上运动', 'preference', 'user')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const updated = harness.memories.update(created.data.memoryId, { content: '我喜欢傍晚运动' })
    expect(updated.ok).toBe(true)
    const removed = harness.memories.remove(created.data.memoryId)
    expect(removed.ok).toBe(true)
    expect(harness.memories.list()).toHaveLength(0)
    harness.memories.add('临时记忆', 'fact', 'user')
    const cleared = harness.memories.clear()
    expect(cleared.ok).toBe(true)
    expect(harness.memories.list()).toHaveLength(0)
  })
})