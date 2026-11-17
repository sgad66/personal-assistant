import React, { useEffect, useRef, useState } from 'react'
import { useNavigationStore } from '../../stores/navigation-store'
import { useAgentStore } from '../../stores/agent-store'
import { DOCUMENT_ACCEPT, IMAGE_ACCEPT, readChatAttachment } from '../../chat-attachment'
import { LIMITS } from '@shared/schemas'
import './quick-attachment.css'
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

  const [text, setText] = useState('')

  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const [attachment, setAttachment] = useState<{ file: File; kind: 'file' | 'image' }>()
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        addRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [menuOpen])

  const choose = (event: React.ChangeEvent<HTMLInputElement>, kind: 'file' | 'image') => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      setAttachment({ file, kind })
      setFeedback(undefined)
    }
  }

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
    if (!trimmed && !attachment) return
    setMenuOpen(false)
    setFeedback(undefined)
    void useAgentStore.getState().init()
    let parts
    try {
      parts = attachment
        ? [await readChatAttachment(attachment.file, attachment.kind)]
        : [{ kind: 'text' as const, text: trimmed }]
    } catch {
      showFeedback({ tone: 'error', text: '附件读取失败，请重试。' })
      return
    }
    const attachmentMeta = attachment ? { name: attachment.file.name, question: trimmed } : undefined
    setText('')
    setAttachment(undefined)
    navigate('agent')
    void sendParts(parts, attachmentMeta ? { attachment: attachmentMeta } : undefined)
  }

  return (
    <div className="quick-capture-block">
      {attachment && (
        <div className="capture-attachment">
          <Icon name={attachment.kind === 'image' ? 'image' : 'note'} size={16} />
          <span title={attachment.file.name}>{attachment.file.name}</span>
          <button type="button" onClick={() => setAttachment(undefined)} aria-label="移除附件"><Icon name="close" size={14} /></button>
        </div>
      )}
      <form className="quick-capture-field" onSubmit={submit}>
        <div className="capture-add" ref={menuRef}>
          <button type="button" className="quick-mark" ref={addRef} aria-label="添加附件" title="添加文件或图片"
            aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <Icon name="plus" size={18} />
          </button>
          {menuOpen && (
            <div className="capture-menu" role="group" aria-label="附件类型">
              <button type="button" onClick={() => { setMenuOpen(false); fileRef.current?.click() }}><Icon name="note" size={16} />选择文件</button>
              <button type="button" onClick={() => { setMenuOpen(false); imageRef.current?.click() }}><Icon name="image" size={16} />选择图片</button>
            </div>
          )}
          <input type="file" hidden accept={DOCUMENT_ACCEPT} ref={fileRef} onChange={event => choose(event, 'file')} />
          <input type="file" hidden accept={IMAGE_ACCEPT} ref={imageRef} onChange={event => choose(event, 'image')} />
        </div>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
          maxLength={LIMITS.textChars}
          placeholder={attachment ? '可附上问题，或直接发送附件' : '记一件事，或向助理提问…'}
          aria-label="快速记录一件事"

          spellCheck={false}
        />
        <div className="quick-field-actions">
          <button
            type="button"
            className="tool-button"
            onClick={() => {
              if (text.trim()) useAgentStore.getState().setSeedPrompt(text)
              onMore()
            }}
            title="语音、图片或更多方式"
            disabled={!!attachment}
          >
            <Icon name="mic" size={17} />
            <span>更多</span>
          </button>
          <button
            type="submit"
            className="send-button"
            disabled={!attachment && !text.trim()}
            aria-label="发送"
          >
            <Icon name="send" size={17} />
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