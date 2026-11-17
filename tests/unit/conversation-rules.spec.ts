import { describe, expect, it } from 'vitest'
import { JUDGE_ORDER, judgeNextStep } from '@shared/conversation/rules'

const NOW = 1_700_000_000_000

describe('会话判定顺序', () => {
  it('七步枚举完整且顺序固定', () => {
    expect(JUDGE_ORDER).toHaveLength(7)
    expect(JUDGE_ORDER[0]).toBe('ask_missing')
    expect(JUDGE_ORDER[6]).toBe('write')
  })

  it('缺要素优先于其他问题', () => {
    expect(
      judgeNextStep({
        missingFields: ['startAt'],
        now: NOW,
        conflicts: [],
        confidence: 0.9,
        threshold: 0.6
      })
    ).toBe('ask_missing')
  })

  it('区间不自洽', () => {
    expect(
      judgeNextStep({
        missingFields: [],
        startAt: NOW + 1000,
        endAt: NOW,
        now: NOW - 1000,
        conflicts: [],
        confidence: 0.9,
        threshold: 0.6
      })
    ).toBe('ask_inconsistent')
  })

  it('已过去', () => {
    expect(
      judgeNextStep({
        missingFields: [],
        startAt: NOW,
        endAt: NOW + 1000,
        now: NOW + 1,
        conflicts: [],
        confidence: 0.9,
        threshold: 0.6
      })
    ).toBe('ask_past')
  })

  it('重复先于冲突', () => {
    expect(
      judgeNextStep({
        missingFields: [],
        startAt: NOW + 1000,
        endAt: NOW + 2000,
        now: NOW,
        duplicateEventId: 'e1',
        conflicts: [{ eventId: 'e2' }],
        confidence: 0.9,
        threshold: 0.6
      })
    ).toBe('ask_duplicate')
  })

  it('冲突', () => {
    expect(
      judgeNextStep({
        missingFields: [],
        startAt: NOW + 1000,
        endAt: NOW + 2000,
        now: NOW,
        conflicts: [{ eventId: 'e2' }],
        confidence: 0.9,
        threshold: 0.6
      })
    ).toBe('ask_conflict')
  })

  it('低置信确认', () => {
    expect(
      judgeNextStep({
        missingFields: [],
        startAt: NOW + 1000,
        endAt: NOW + 2000,
        now: NOW,
        conflicts: [],
        confidence: 0.4,
        threshold: 0.6
      })
    ).toBe('confirm_recap')
  })

  it('全部通过后写入', () => {
    expect(
      judgeNextStep({
        missingFields: [],
        startAt: NOW + 1000,
        endAt: NOW + 2000,
        now: NOW,
        conflicts: [],
        confidence: 0.9,
        threshold: 0.6
      })
    ).toBe('write')
  })
})