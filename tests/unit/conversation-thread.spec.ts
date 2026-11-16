import { describe, expect, it } from 'vitest'
import type { ConversationMessageDto } from '@shared/ipc-contracts'
import { describeResolution, settleTurn, unionMessages } from '@shared/conversation-thread'

function message(id: string, role: 'user' | 'assistant', content: string): ConversationMessageDto {
  return {
    messageId: id,
    role,
    content,
    modality: 'text',
    createdAt: 1,
    status: 'parsed'
  }
}

describe('对话线程', () => {
  it('先保留用户消息，再接上助手回复', () => {
    const pending = message('pending_1', 'user', '明天下午三点开会')
    const history = [message('u0', 'user', '你好'), message('a0', 'assistant', '你好')]
    const settled = settleTurn(
      [...history, pending],
      pending.messageId,
      message('u1', 'user', '明天下午三点开会'),
      message('a1', 'assistant', '已安排：开会')
    )
    expect(settled.map((item) => item.messageId)).toEqual(['u0', 'a0', 'u1', 'a1'])
  })

  it('历史里已经有同一轮时不再重复追加', () => {
    const user = message('u1', 'user', '开会')
    const assistant = message('a1', 'assistant', '已安排')
    const merged = unionMessages([user, assistant], [user, assistant])
    expect(merged).toHaveLength(2)
  })

  it('补充信息的预览就是用户刚输入的文字', () => {
    expect(describeResolution({ kind: 'supplement', text: '下午三点' })).toBe('下午三点')
  })
})
