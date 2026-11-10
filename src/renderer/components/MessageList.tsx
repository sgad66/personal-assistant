import React from 'react'
import type { ConversationMessageDto } from '@shared/ipc-contracts'
import { formatTime } from '@shared/time-kit'

interface MessageListProps {
  readonly messages: readonly ConversationMessageDto[]
  readonly busy: boolean
  readonly onRetry: () => void
}

export default function MessageList({ messages, busy, onRetry }: MessageListProps): React.ReactElement {
  if (messages.length === 0 && !busy) {
    return (
      <div className="chat-empty">
        <h2>你好，我是你的日程助手</h2>
        <p>告诉我时间和要做的事，例如：</p>
        <ul>
          <li>明天下午三点开项目周会</li>
          <li>下周三上午碰一下方案</li>
          <li>周五 22:00 到周六 02:00 机房值班</li>
        </ul>
        <p className="chat-empty-hint">可以发一句话、一段语音，或直接发一张带时间的通知截图。</p>
      </div>
    )
  }

  return (
    <div className="message-list">
      {messages.map((message) => (
        <div key={message.messageId} className={`message-row ${message.role}`}>
          <div className={`avatar ${message.role}`} aria-hidden="true">
            {message.role === 'user' ? '我' : 'AI'}
          </div>
          <div className={`bubble ${message.status === 'failed' ? 'is-failed' : ''}`}>
            <div className="bubble-content">{message.content}</div>
            <div className="bubble-meta">
              <span>{formatTime(message.createdAt)}</span>
              {message.modality !== 'text' && <span className="modality-tag">{modalityLabel(message.modality)}</span>}
            </div>
            {message.role === 'assistant' && message.status === 'failed' && (
              <button type="button" className="inline-retry" onClick={onRetry}>
                重试
              </button>
            )}
          </div>
        </div>
      ))}
      {busy && (
        <div className="message-row assistant">
          <div className="avatar assistant" aria-hidden="true">
            AI
          </div>
          <div className="bubble typing">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
    </div>
  )
}

function modalityLabel(modality: ConversationMessageDto['modality']): string {
  if (modality === 'voice') return '语音'
  if (modality === 'image') return '图片'
  if (modality === 'composite') return '组合'
  return '文字'
}