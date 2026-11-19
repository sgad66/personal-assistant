import { describe, expect, it } from 'vitest'
import { ConversationRepository } from '@main/storage/conversation-repository'
import { DataStore, createEmptyDb, type DbShape } from '@main/storage/data-store'
import type { ConversationMessage } from '@shared/domain/types'

function message(id: string, role: 'user' | 'assistant', content: string): ConversationMessage {
  return {
    messageId: id,
    role,
    content,
    modality: 'text',
    createdAt: 1000,
    status: 'parsed'
  }
}

function createFixture(): { store: DataStore; repo: ConversationRepository } {
  const initial: DbShape = {
    ...createEmptyDb(1000),
    revision: 0,
    messages: [message('m1', 'user', '明天下午三点开会'), message('m2', 'assistant', '已安排好'), message('m3', 'user', '好的')],
    summary: {
      text: '用户之前安排过会议',
      coversUntil: 'm2',
      messageCount: 2,
      updatedAt: 1000
    },
    session: {
      state: 'clarifying',
      pendingInput: '明天下午三点开会',
      updatedAt: 1000
    }
  }
  const store = new DataStore({ initial, clock: () => 2000 })
  return { store, repo: new ConversationRepository(store) }
}

describe('删除单条对话消息', () => {
  it('只删除目标消息，并让旧摘要与会话状态失效', () => {
    const { store, repo } = createFixture()
    const result = repo.deleteMessage('m2', 3000)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ messageId: 'm2' })

    const snapshot = store.snapshot()
    expect(snapshot.messages.map((item) => item.messageId)).toEqual(['m1', 'm3'])
    expect(snapshot.summary).toBeUndefined()
    expect(snapshot.session.state).toBe('idle')
    expect(snapshot.session.pendingInput).toBeUndefined()
    expect(snapshot.session.updatedAt).toBe(3000)
    expect(snapshot.revision).toBe(1)
  })

  it('消息不存在时不改动任何数据', () => {
    const { store, repo } = createFixture()
    const result = repo.deleteMessage('missing', 3000)
    expect(result.ok).toBe(false)

    const snapshot = store.snapshot()
    expect(snapshot.messages).toHaveLength(3)
    expect(snapshot.summary).toBeDefined()
    expect(snapshot.session.state).toBe('clarifying')
    expect(snapshot.revision).toBe(0)
  })

  it('可以删除最后一条消息', () => {
    const { store, repo } = createFixture()
    repo.deleteMessage('m1', 3000)
    repo.deleteMessage('m2', 3001)
    const result = repo.deleteMessage('m3', 3002)
    expect(result.ok).toBe(true)
    expect(store.snapshot().messages).toEqual([])
  })
})