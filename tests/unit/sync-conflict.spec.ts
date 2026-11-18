import { describe, expect, it } from 'vitest'
import { CONFLICT_COPY_PREFIX, buildConflictCopy, conflictTypeOf, decideSync } from '@shared/sync/conflict-rules'
import type { OutboundChangeDto, SyncedEvent } from '@shared/sync/protocol'

const NOW = 1_700_000_000_000

function synced(overrides: Partial<SyncedEvent> = {}): SyncedEvent {
  return {
    title: '项目周会',
    startAt: NOW,
    endAt: NOW + 3_600_000,
    sourceModality: 'text',
    status: 'active',
    createdAt: NOW - 10_000,
    updatedAt: NOW - 5_000,
    contentRevision: 1,
    originDevice: 'desktop',
    variant: 'authoritative',
    ...overrides
  }
}

function upsert(overrides: Partial<OutboundChangeDto> = {}): OutboundChangeDto {
  return {
    opId: 'op-1',
    eventId: 'e1',
    kind: 'upsert',
    baseRevision: 1,
    revision: 2,
    event: synced({ contentRevision: 2 }),
    ...overrides
  }
}

function tombstone(overrides: Partial<OutboundChangeDto> = {}): OutboundChangeDto {
  return { opId: 'op-1', eventId: 'e1', kind: 'tombstone', baseRevision: 1, revision: 2, ...overrides }
}

function withRevision(eventId: string, title: string, startAt: number, revision: number): SyncedEvent & { eventId: string } {
  return { ...synced({ title, startAt, contentRevision: revision }), eventId }
}

describe('同步冲突矩阵九行', () => {
  it('未变 + 修改：应用手机内容', () => {
    const decision = decideSync(synced({ contentRevision: 1 }), upsert({ baseRevision: 1, revision: 2 }))
    expect(decision.outcome).toBe('apply_mobile')
    expect(decision.nextRevision).toBe(3)
    expect(decision.kind).toBeUndefined()
  })

  it('未变 + 取消：应用墓碑', () => {
    const decision = decideSync(synced({ contentRevision: 1 }), tombstone({ baseRevision: 1 }))
    expect(decision.outcome).toBe('apply_tombstone')
    expect(decision.kind).toBeUndefined()
  })

  it('已变 + 手机未变：保留电脑端', () => {
    const decision = decideSync(synced({ contentRevision: 3 }), upsert({ baseRevision: 1, revision: 1 }))
    expect(decision.outcome).toBe('keep_desktop')
    expect(decision.nextRevision).toBe(3)
  })

  it('已变 + 修改：双端修改冲突，电脑端为正式', () => {
    const decision = decideSync(synced({ contentRevision: 3 }), upsert({ baseRevision: 1, revision: 2 }))
    expect(decision.outcome).toBe('conflict')
    expect(decision.kind).toBe('both_modified')
    expect(decision.copyOf).toBe('mobile')
    expect(decision.nextRevision).toBe(4)
  })

  it('已变 + 取消：修改对取消，取消优先', () => {
    const decision = decideSync(synced({ contentRevision: 3 }), tombstone({ baseRevision: 1 }))
    expect(decision.outcome).toBe('apply_tombstone')
    expect(decision.kind).toBe('cancel_vs_modify')
    expect(decision.copyOf).toBe('desktop')
    expect(decision.nextRevision).toBe(4)
  })

  it('已取消 + 修改：取消对修改，取消优先', () => {
    const decision = decideSync(synced({ status: 'cancelled', contentRevision: 2 }), upsert({ baseRevision: 1, revision: 2 }))
    expect(decision.outcome).toBe('conflict')
    expect(decision.kind).toBe('modify_vs_cancel')
    expect(decision.copyOf).toBe('mobile')
  })

  it('已取消 + 取消：收敛为已取消且不产生冲突', () => {
    const decision = decideSync(synced({ status: 'cancelled', contentRevision: 2 }), tombstone({ baseRevision: 1 }))
    expect(decision.outcome).toBe('keep_cancelled')
    expect(decision.kind).toBeUndefined()
  })

  it('电脑端不存在 + 新增：直接新增', () => {
    const decision = decideSync(undefined, upsert({ baseRevision: 0, revision: 1 }))
    expect(decision.outcome).toBe('insert')
    expect(decision.nextRevision).toBe(1)
  })

  it('电脑端已存在 + 新增撞号：保留两侧', () => {
    const decision = decideSync(synced({ contentRevision: 1 }), upsert({ baseRevision: 0, revision: 1 }))
    expect(decision.outcome).toBe('conflict')
    expect(decision.copyOf).toBe('mobile')
  })
})

describe('冲突判定不依赖墙钟', () => {
  it('updatedAt 颠倒不影响结果', () => {
    const earlier = synced({ contentRevision: 2, updatedAt: NOW - 9_000 })
    const later = synced({ contentRevision: 2, updatedAt: NOW + 9_000 })
    const first = decideSync(earlier, upsert({ baseRevision: 1, revision: 2 }))
    const second = decideSync(later, upsert({ baseRevision: 1, revision: 2 }))
    expect(second).toEqual(first)
  })

  it('nextRevision 恒为 max(D, M) + 1', () => {
    const cases: ReadonlyArray<readonly [number, number, number]> = [
      [1, 2, 3],
      [3, 1, 4],
      [5, 5, 6]
    ]
    for (const [desktop, mobile, expected] of cases) {
      const decision = decideSync(
        synced({ contentRevision: desktop }),
        upsert({ baseRevision: 0, revision: mobile, event: synced({ contentRevision: mobile }) })
      )
      expect(decision.nextRevision).toBe(expected)
    }
  })
})

describe('冲突副本', () => {
  it('副本使用新 eventId、conflict 变体与统一前缀', () => {
    const copy = buildConflictCopy(withRevision('e1', '董事会', NOW, 2), 'mobile', 'c1', NOW)
    expect(copy.eventId).not.toBe('e1')
    expect(copy.variant).toBe('conflict')
    expect(copy.title.startsWith(CONFLICT_COPY_PREFIX)).toBe(true)
    expect(copy.contentRevision).toBe(1)
    expect(copy.conflictId).toBe('c1')
    expect(copy.variantOrigin).toBe('mobile')
  })

  it('冲突分类与场景对应', () => {
    expect(conflictTypeOf(true, 'upsert')).toBe('modify_vs_cancel')
    expect(conflictTypeOf(false, 'tombstone')).toBe('cancel_vs_modify')
    expect(conflictTypeOf(false, 'upsert')).toBe('both_modified')
  })
})