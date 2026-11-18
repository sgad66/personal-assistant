import { describe, expect, it } from 'vitest'
import {
  advanceAfterTurn,
  nextImportAction,
  type ImportBatchState,
  type ImportFileResult
} from '@shared/import/runner'

function file(name: string, phase: ImportFileResult['phase']): ImportFileResult {
  return { fileName: name, phase }
}

function state(files: ImportFileResult[]): ImportBatchState {
  return { phase: 'running', cursor: 0, files }
}

describe('导入队列推进', () => {
  it('读取第一个 queued 并跳过 skipped', () => {
    const initial = state([file('a.txt', 'queued'), file('b.txt', 'queued'), file('c.pdf', 'skipped')])
    expect(nextImportAction(initial)).toEqual({ kind: 'read', index: 0 })

    const first = advanceAfterTurn(initial, { state: 'idle', candidateCount: 1, createdEventId: 'e1' })
    expect(first.action).toBe('continue')
    expect(first.state.cursor).toBe(1)

    const second = advanceAfterTurn(first.state, { state: 'idle', candidateCount: 0 })
    expect(second.action).toBe('done')
    expect(second.state.files[1]?.phase).toBe('no_schedule')
  })

  it('候选等待时不推进且幂等', () => {
    const initial = state([file('a.txt', 'queued')])
    const first = advanceAfterTurn(initial, { state: 'candidate_select', candidateCount: 3 })
    expect(first.action).toBe('hold')
    expect(first.state.phase).toBe('awaiting_decision')
    expect(first.state.files[0]?.phase).toBe('awaiting_decision')

    const second = advanceAfterTurn(first.state, { state: 'candidate_select', candidateCount: 3 })
    expect(second.state).toEqual(first.state)
  })

  it('重复事项标记 duplicate 原因', () => {
    const initial = state([file('a.txt', 'queued')])
    const result = advanceAfterTurn(initial, { state: 'duplicate', candidateCount: 1 })
    expect(result.state.files[0]?.phase).toBe('failed')
    expect(result.state.files[0]?.reasonKey).toBe('error.duplicateEvent')
  })

  it('全部 skipped 直接 done', () => {
    const all = state([file('a.pdf', 'skipped'), file('b.mp4', 'skipped')])
    expect(nextImportAction(all).kind).toBe('done')
  })

  it('有 reading/submitting 时不并发读取', () => {
    const busy = state([file('a.txt', 'submitting'), file('b.txt', 'queued')])
    expect(nextImportAction(busy).kind).toBe('none')
  })

  it('失败项推进到下一项', () => {
    const initial = state([file('a.txt', 'queued'), file('b.txt', 'queued')])
    const result = advanceAfterTurn(initial, { state: 'failed', candidateCount: 0 })
    expect(result.state.files[0]?.phase).toBe('failed')
    expect(result.state.cursor).toBe(1)
    expect(result.action).toBe('continue')
  })
})