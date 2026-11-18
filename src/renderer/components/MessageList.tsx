import React, { useEffect, useRef, useState } from 'react'
import type {
  ConversationMessageDto,
  FailurePresentationDto,
  MessageQuote,
  RetryAffordance,
  UiAction
} from '@shared/ipc-contracts'
import { formatTime } from '@shared/time-kit'
import { UI_TEXT } from '@shared/message-catalog'
import type { PendingAsk } from '../stores/agent-store'
import Icon from './Icon'

export type RetryState = 'idle' | 'auto_retrying' | 'auto_retry_failed' | 'manual_retrying'

interface MessageListProps {
  readonly messages: readonly ConversationMessageDto[]
  readonly pending: readonly PendingAsk[]
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
  readonly onQuote?: (message: ConversationMessageDto, excerpt?: string) => void
}

const EXAMPLE_PROMPTS = ['明天下午三点开项目周会', '周五 22:00 到周六 02:00 机房值班', '下周三上午碰一下方案'] as const

export default function MessageList({
  messages,
  pending,
  busy,
  onRetry,
  onSuggestion,
  failure,
  retry,
  retryState,
  onReselect,
  onOpenSettings,
  onUseText,
  onQuote
}: MessageListProps): React.ReactElement {
  if (messages.length === 0 && pending.length === 0 && !busy) {
    return (
      <div className="agent-empty">
        <span className="agent-orb" aria-hidden="true">
          <span />
        </span>
        <span className="eyebrow">START HERE</span>
        <h2>今天想安排什么？</h2>
        <p>说一句话、录一段语音，或者发一张带时间的通知截图，可以连续追问。</p>
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
  const selectionRef = useSelectionRef()

  return (
    <div className="message-list">
      {messages.map((message) => {
        const isLatestFailure =
          message.role === 'assistant' &&
          message.status === 'failed' &&
          message.messageId === lastAssistantId &&
          failure !== undefined
        const retrying = isLatestFailure && (retryState === 'auto_retrying' || retryState === 'manual_retrying')
        const animate =
          message.role === 'assistant' &&
          message.messageId === lastAssistantId &&
          message.status !== 'failed'
        return (
          <div key={message.messageId} className={`message-row ${message.role}`}>
            {message.role === 'assistant' && (
              <span className="message-avatar" aria-hidden="true">
                日
              </span>
            )}
            <div className={`message-stack ${message.role}`}>
              <div
                className={`bubble ${message.role} ${message.status === 'failed' ? 'is-failed' : ''}`}
                data-message-id={message.messageId}
              >
                {message.quotes && message.quotes.length > 0 && (
                  <QuoteBlock quotes={message.quotes} tone={message.role} />
                )}
                {animate ? <RevealText text={message.content} /> : <p>{message.content}</p>}
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
                {onQuote && (
                  <button
                    type="button"
                    className="quote-trigger"
                    onClick={() => {
                      const picked =
                        selectionRef.current?.messageId === message.messageId
                          ? selectionRef.current.text
                          : undefined
                      selectionRef.current = undefined
                      window.getSelection()?.removeAllRanges()
                      onQuote(message, picked)
                    }}
                  >
                    引用
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
      {pending.map((item) => (
        <div key={item.clientMessageId} className="message-row assistant">
          <span className="message-avatar" aria-hidden="true">
            日
          </span>
          <div className="bubble assistant is-pending">
            <span className="pending-stage">{item.stage}</span>
            <span className="typing" aria-label={item.stage}>
              <span />
              <span />
              <span />
            </span>
          </div>
        </div>
      ))}
      {busy && pending.length === 0 && (
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

function RevealText({ text }: { readonly text: string }): React.ReactElement {
  const [shown, setShown] = useState(0)

  useEffect(() => {
    setShown(0)
    if (text.length === 0) return undefined
    const chunk = Math.max(2, Math.ceil(text.length / 70))
    let index = 0
    const timer = window.setInterval(() => {
      index = Math.min(text.length, index + chunk)
      setShown(index)
      if (index >= text.length) window.clearInterval(timer)
    }, 28)
    return () => window.clearInterval(timer)
  }, [text])

  return (
    <p>
      {text.slice(0, shown)}
      {shown < text.length && <span className="stream-caret" aria-hidden="true" />}
    </p>
  )
}

function QuoteBlock({
  quotes,
  tone
}: {
  readonly quotes: readonly MessageQuote[]
  readonly tone: 'user' | 'assistant'
}): React.ReactElement {
  return (
    <div className="bubble-quotes">
      {quotes.map((quote) => (
        <blockquote key={quote.messageId} className={`quote-chip ${tone}`}>
          <span className="quote-role">{quote.role === 'user' ? '引用你的话' : '引用回答'}</span>
          <span className="quote-text">{quote.excerpt}</span>
        </blockquote>
      ))}
    </div>
  )
}

function useSelectionRef(): React.MutableRefObject<{ messageId: string; text: string } | undefined> {
  const ref = useRef<{ messageId: string; text: string } | undefined>(undefined)

  useEffect(() => {
    const onSelectionChange = (): void => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return
      const text = selection.toString().trim()
      if (text.length === 0) return
      const node = selection.anchorNode
      const element = node instanceof Element ? node : node?.parentElement
      const bubble = element?.closest('[data-message-id]')
      const messageId = bubble?.getAttribute('data-message-id')
      if (messageId) ref.current = { messageId, text: text.slice(0, 500) }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  return ref
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