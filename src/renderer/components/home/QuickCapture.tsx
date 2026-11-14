import React, { useEffect, useRef, useState } from 'react'
import { useNavigationStore } from '../../stores/navigation-store'
import { useAgentStore } from '../../stores/agent-store'
import Icon from '../Icon'

interface QuickCaptureProps {
  readonly onMore: () => void
}

interface Feedback {
  readonly tone: 'ok' | 'warn' | 'error'
  readonly text: string
  readonly needsAgent?: boolean
}

export default function QuickCapture({ onMore }: QuickCaptureProps): React.ReactElement {
  const navigate = useNavigationStore((state) => state.navigate)
  const sendParts = useAgentStore((state) => state.sendParts)
  const busy = useAgentStore((state) => state.busy)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const showFeedback = (next: Feedback): void => {
    setFeedback(next)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setFeedback(undefined), 6_000)
  }

  const submit = async (event?: React.FormEvent): Promise<void> => {
    event?.preventDefault()
    const trimmed = text.trim()
    if (trimmed.length === 0 || sending || busy) return
    setSending(true)
    setFeedback(undefined)
    try {
      const ok = await sendParts([{ kind: 'text', text: trimmed }])
      if (!ok) {
        showFeedback({
          tone: 'error',
          text: useAgentStore.getState().error ?? '发送失败，请重试'
        })
        return
      }
      setText('')
      const turn = useAgentStore.getState().lastTurn
      if (turn?.state === 'idle' && turn.createdEventId) {
        showFeedback({ tone: 'ok', text: turn.assistantMessage.content || '已经安排好了' })
      } else if (turn?.state === 'idle') {
        showFeedback({ tone: 'ok', text: turn.assistantMessage.content || '已收到' })
      } else {
        const message = turn?.assistantMessage.content?.trim()
        showFeedback({
          tone: 'warn',
          text: message && message.length > 0 ? message : '需要确认，去智能体继续。',
          needsAgent: true
        })
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="quick-capture-block">
      <form className={`quick-capture-field ${sending ? 'is-sending' : ''}`} onSubmit={submit}>
        <span className="quick-mark" aria-hidden="true">
          <Icon name="plus" size={18} />
        </span>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder="记一件事，例如「明天下午三点开项目周会」"
          aria-label="快速记录一件事"
          disabled={sending || busy}
          spellCheck={false}
        />
        <div className="quick-field-actions">
          <button
            type="button"
            className="tool-button"
            onClick={onMore}
            title="语音、图片或更多方式"
            disabled={sending}
          >
            <Icon name="mic" size={17} />
            <span>更多</span>
          </button>
          <button
            type="submit"
            className="send-button"
            disabled={text.trim().length === 0 || sending || busy}
            aria-label="发送"
          >
            <Icon name={sending ? 'refresh' : 'send'} size={17} />
          </button>
        </div>
      </form>

      {feedback && (
        <div className={`quick-feedback is-${feedback.tone}`} role="status">
          <span>{feedback.text}</span>
          {feedback.needsAgent && (
            <button type="button" onClick={() => navigate('agent')}>
              去确认
            </button>
          )}
        </div>
      )}
    </div>
  )
}