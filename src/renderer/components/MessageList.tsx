import React from 'react'
import type {
  ConversationMessageDto,
  FailurePresentationDto,
  RetryAffordance,
  UiAction
} from '@shared/ipc-contracts'
import { formatTime } from '@shared/time-kit'
import { UI_TEXT } from '@shared/message-catalog'
import Icon from './Icon'

export type RetryState = 'idle' | 'auto_retrying' | 'auto_retry_failed' | 'manual_retrying'

interface MessageListProps {
  readonly messages: readonly ConversationMessageDto[]
  readonly busy: boolean
  readonly onRetry: () => void
  readonly onSuggestion?: (text: string) => void
  readonly failure?: FailurePresentationDto
  readonly retry?: RetryAffordance
  readonly retryState?: RetryState
  readonly retryStartedAt?: number
  readonly onReselect?: (kind: 'image' | 'voice') => void
  readonly onOpenSettings?: () => void
  readonly onUseText?: () => void
}

const EXAMPLE_PROMPTS = ['明天下午三点开项目周会', '周五 22:00 到周六 02:00 机房值班', '下周三上午碰一下方案'] as const

export default function MessageList({
  messages,
  busy,
  onRetry,
  onSuggestion,
  failure,
  retry,
  retryState,
  onReselect,
  onOpenSettings,
  onUseText
}: MessageListProps): React.ReactElement {
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

  const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.messageId
  const actions = failure?.actions ?? []

  return (
    <div className="message-list">
      {messages.map((message) => {
        const isLatestFailure =
          message.role === 'assistant' &&
          message.status === 'failed' &&
          message.messageId === lastAssistantId &&
          failure !== undefined
        const retrying = isLatestFailure && (retryState === 'auto_retrying' || retryState === 'manual_retrying')
        return (
          <div key={message.messageId} className={`message-row ${message.role}`}>
            {message.role === 'assistant' && (
              <span className="message-avatar" aria-hidden="true">
                日
              </span>
            )}
            <div className={`message-stack ${message.role}`}>
              <div className={`bubble ${message.role} ${message.status === 'failed' ? 'is-failed' : ''}`}>
                <p>{message.content}</p>
                {message.role === 'assistant' && message.sourceLabel && (
                  <span className="bubble-source">{message.sourceLabel}</span>
                )}
                {isLatestFailure && actions.length > 0 && (
                  <div className="failure-actions">
                    {actions.map((action) => (
                      <button
                        key={action}
                        type="button"
                        className="failure-action"
                        disabled={retrying}
                        onClick={() =>
                          handleAction(action, {
                            onRetry,
                            retry,
                            onReselect,
                            onOpenSettings,
                            onUseText
                          })
                        }
                      >
                        {action === 'retry' && <Icon name="refresh" size={13} />}
                        {actionLabel(action, retry)}
                      </button>
                    ))}
                  </div>
                )}
                {retrying && <span className="retry-progress">{UI_TEXT.retryingFirst}</span>}
              </div>
              <div className="bubble-meta">
                <span>{formatTime(message.createdAt)}</span>
                {message.modality !== 'text' && <span>{modalityLabel(message.modality)}</span>}
              </div>
            </div>
          </div>
        )
      })}
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

interface ActionHandlers {
  readonly onRetry: () => void
  readonly retry?: RetryAffordance
  readonly onReselect?: (kind: 'image' | 'voice') => void
  readonly onOpenSettings?: () => void
  readonly onUseText?: () => void
}

function handleAction(action: UiAction, handlers: ActionHandlers): void {
  if (action === 'retry') {
    handlers.onRetry()
    return
  }
  if (action === 'reselect_media') {
    const kind = handlers.retry?.mediaKind ?? 'image'
    handlers.onReselect?.(kind)
    return
  }
  if (action === 'use_text') {
    handlers.onUseText?.()
    return
  }
  handlers.onOpenSettings?.()
}

function actionLabel(action: UiAction, retry?: RetryAffordance): string {
  if (action === 'retry') {
    if (retry?.kind === 'media') {
      return retry.mediaKind === 'voice' ? UI_TEXT.retryVoice : UI_TEXT.retryImage
    }
    return UI_TEXT.retryText
  }
  if (action === 'reselect_media') {
    return retry?.mediaKind === 'voice' ? UI_TEXT.reselectVoice : UI_TEXT.reselectImage
  }
  if (action === 'use_text') return '仅按文字继续'
  if (action === 'open_settings' || action === 'update_key' || action === 'change_model') return '打开 AI 设置'
  if (action === 'switch_preset') return '切换预设'
  if (action === 'exit_strict') return '退出严格模式'
  return '继续'
}

function modalityLabel(modality: ConversationMessageDto['modality']): string {
  if (modality === 'voice') return '语音'
  if (modality === 'image') return '图片'
  if (modality === 'composite') return '组合输入'
  return '文字'
}