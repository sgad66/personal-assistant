import React from 'react'
import type { ConversationMessageDto } from '@shared/ipc-contracts'
import { formatTime } from '@shared/time-kit'
import Icon from './Icon'

interface MessageListProps {
  readonly messages: readonly ConversationMessageDto[]
  readonly busy: boolean
  readonly onRetry: () => void
  readonly onSuggestion?: (text: string) => void
}

const EXAMPLE_PROMPTS = ['明天下午三点开项目周会', '周五 22:00 到周六 02:00 机房值班', '下周三上午碰一下方案'] as const

export default function MessageList({ messages, busy, onRetry, onSuggestion }: MessageListProps): React.ReactElement {
  if (messages.length === 0 && !busy) {
    return (
      <div className="agent-empty">
        <span className="agent-orb" aria-hidden="true">
          <span />
        </span>
        <span className="eyebrow">START HERE</span>
        <h2>今天想安排什么？</h2>
        <p>说一句话、录一段语音，或者发一张带时间的通知截图。</p>
        <div className="prompt-chips">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" className="prompt-chip" onClick={() => onSuggestion?.(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="message-list">
      {messages.map((message) => (
        <div key={message.messageId} className={`message-row ${message.role}`}>
          {message.role === 'assistant' && (
            <span className="message-avatar" aria-hidden="true">
              日
            </span>
          )}
          <div className={`message-stack ${message.role}`}>
            <div className={`bubble ${message.role} ${message.status === 'failed' ? 'is-failed' : ''}`}>
              <p>{message.content}</p>
              {message.role === 'assistant' && message.status === 'failed' && (
                <button type="button" className="inline-retry" onClick={onRetry}>
                  <Icon name="refresh" size={14} />
                  重试上一条
                </button>
              )}
            </div>
            <div className="bubble-meta">
              <span>{formatTime(message.createdAt)}</span>
              {message.modality !== 'text' && <span>{modalityLabel(message.modality)}</span>}
            </div>
          </div>
        </div>
      ))}
      {busy && (
        <div className="message-row assistant">
          <span className="message-avatar" aria-hidden="true">
            日
          </span>
          <div className="typing" aria-label="正在思考">
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
  if (modality === 'composite') return '组合输入'
  return '文字'
}