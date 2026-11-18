import { strict as assert } from 'node:assert'
import { describe, expect, it } from 'vitest'
import { RecommendationService } from '@main/services/recommendation-service'
import { LlmProvider } from '@main/providers/llm-provider'
import { silentLogger } from '@main/observability/logger'
import type { ResolvedAccess } from '@main/ai/provider-resolver'
import type { RecommendationRequest } from '@main/providers/types'
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@shared/time-kit'
import { createHarness, at } from '../helpers/harness'

const NOW = at(2026, 11, 22, 20, 30)
function fixture() {
  const h = createHarness(NOW)
  const text = h.access.text
  assert(text.kind === 'ready')
  const local: ResolvedAccess = { ...h.access, status: 'local', text: { ...text, actualPresetId: 'local' as const } }
  const service = new RecommendationService(h.store, h.schedule, () => local)
  return { h, local, service }
}

describe('空档日程建议', () => {
  it('从应用内近期日程生成本地建议，跨周安排到明天，生成时不写入日程', async () => {
    const { h, service } = fixture()
    h.schedule.createEvent({ title: '英语课', startAt: NOW - DAY_MS, endAt: NOW - DAY_MS + HOUR_MS, sourceModality: 'text' }, { allowPast: true })
    const list = await service.list()
    expect(list.source).toBe('local')
    expect(list.items[0]?.title.includes('英语课')).toBe(true)
    expect(list.items.some(item => item.startAt === at(2026, 11, 23, 9))).toBe(true)
    expect(h.store.snapshot().events.length).toBe(1)
    const item = list.items[0]!
    const outcome = service.add(item.id)
    expect(h.schedule.getDetail(outcome.eventId).ok).toBe(true)
    assert.throws(() => service.add(item.id))
    expect(h.store.snapshot().events.length).toBe(2)
    const refreshed = await service.list()
    expect(refreshed.items.some(offer => offer.title === item.title)).toBe(false)
    expect(refreshed.items.length).toBeGreaterThan(0)
  })

  it('用户确认时重查空档，拒绝临时冲突、过期空档和伪造的 ID', async () => {
    const { h, service } = fixture()
    const { items } = await service.list()
    const item = items[0]!
    h.schedule.createEvent({ title: '另一个安排', startAt: item.startAt, endAt: item.endAt, sourceModality: 'text' })
    assert.throws(() => service.add(item.id))
    assert.throws(() => service.add('unknown-id'))
    h.setNow(items[1]!.startAt)
    assert.throws(() => service.add(items[1]!.id))
    expect(h.store.snapshot().events.length).toBe(1)
  })

  it('DeepSeek 收到真实候选空档和近期标题，按模型输出添加；无效时段不会写入', async () => {
    const { h, local } = fixture()
    h.schedule.createEvent({ title: '课程讨论', note: '只保存在本机的笔记', startAt: NOW - DAY_MS, sourceModality: 'text' }, { allowPast: true })
    const provider = new LlmProvider({ baseUrl: 'https://api.deepseek.com/v1', model: 'test-model', apiKey: 'test-only', asrModel: '', visionModel: '' }, silentLogger)
    const access: ResolvedAccess = { ...local, status: 'deepseek_solution', text: {
      kind: 'ready', presetId: 'deepseek', model: 'test-model', endpoint: 'https://api.deepseek.com/v1', provider
    } }
    const service = new RecommendationService(h.store, h.schedule, () => access)
    const original = globalThis.fetch
    let count = 0
    globalThis.fetch = async (url, init) => {
      count++
      expect(String(url)).toBe('https://api.deepseek.com/v1/chat/completions')
      const body = JSON.parse(String(init?.body))
      const data: RecommendationRequest = JSON.parse(body.messages[1].content)
      expect(data.recentActivities[0]?.title).toBe('课程讨论')
      expect(body.messages[1].content.includes('只保存在本机的笔记')).toBe(false)
      expect(data.availableSlots.length).toBeGreaterThan(0)
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [
        { slot: 1, title: '课题资料整理', reason: '近期有课程讨论。', minutes: 30 },
        { slot: 99, title: '不存在的时段', reason: '测试', minutes: 20 }
      ] }) } }] }), { status: 200 })
    }
    try {
      const [list, concurrent] = await Promise.all([service.list(), service.list()])
      expect(concurrent).toEqual(list)
      expect(count).toBe(1)
      expect(list.source).toBe('deepseek')
      expect(list.items.length).toBe(1)
      const item = list.items[0]!
      expect(item.endAt - item.startAt).toBe(30 * MINUTE_MS)
      service.add(item.id)
      expect(h.store.snapshot().events.some(event => event.title === '课题资料整理')).toBe(true)
      const refreshed = await service.list()
      expect(refreshed.items.length).toBe(0)
    } finally {
      globalThis.fetch = original
    }
  })
})

