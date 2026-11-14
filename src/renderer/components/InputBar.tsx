import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { InputPart, ImagePart, VoicePart } from '@shared/ipc-contracts'
import { UI_TEXT } from '@shared/message-catalog'
import { LIMITS } from '@shared/schemas'
import { formatDuration, validateImage, validateText, validateVoice } from '../input-collector'
import Icon from './Icon'

interface InputBarProps {
  readonly disabled: boolean
  readonly onSend: (parts: InputPart[]) => Promise<boolean>
  readonly seedText?: string
  readonly onSeedConsumed?: () => void
  readonly suggestions?: readonly string[]
}

const MAX_RECORD_MS = 60_000

export default function InputBar({
  disabled,
  onSend,
  seedText,
  onSeedConsumed,
  suggestions
}: InputBarProps): React.ReactElement {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<InputPart[]>([])
  const [recording, setRecording] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [localError, setLocalError] = useState<string | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startAtRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const cleanupRecording = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    recorderRef.current = null
    setRecording(false)
    setStopping(false)
    setElapsed(0)
  }, [])

  useEffect(() => cleanupRecording, [cleanupRecording])

  useEffect(() => {
    if (!seedText) return
    setText(seedText)
    onSeedConsumed?.()
    textareaRef.current?.focus()
  }, [seedText, onSeedConsumed])

  const stageVoice = useCallback(async (chunks: Blob[], mimeType: string, durationMs: number): Promise<void> => {
    const validation = validateVoice(durationMs)
    if (!validation.ok) {
      setLocalError(validation.message ?? '语音超出限制')
      return
    }
    if (chunks.length === 0) {
      setLocalError('没有录到声音，请再试一次')
      return
    }
    try {
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
      const bytes = await blob.arrayBuffer()
      const staged = await window.pa.agent.stageTempFile({
        fileName: 'voice.webm',
        mimeType: 'audio/webm',
        bytes
      })
      const part: VoicePart = {
        kind: 'voice',
        tempFilePath: staged.tempFilePath,
        durationMs: Math.max(1_000, durationMs)
      }
      setAttachments((current) => [...current, part])
      setLocalError(undefined)
    } catch {
      setLocalError('语音保存失败，请重试')
    }
  }, [])

  const startRecording = async (): Promise<void> => {
    if (disabled || sending) return
    setLocalError(undefined)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []
      startAtRef.current = Date.now()
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const duration = Math.min(Date.now() - startAtRef.current, MAX_RECORD_MS)
        const chunks = chunksRef.current
        chunksRef.current = []
        const mimeType = recorder.mimeType
        cleanupRecording()
        void stageVoice(chunks, mimeType, duration)
      }
      recorder.start(200)
      setRecording(true)
      setElapsed(0)
      timerRef.current = window.setInterval(() => {
        const passed = Date.now() - startAtRef.current
        setElapsed(passed)
        if (passed >= MAX_RECORD_MS && recorder.state !== 'inactive') {
          setStopping(true)
          recorder.stop()
        }
      }, 200)
    } catch {
      cleanupRecording()
      setLocalError('无法访问麦克风，请在系统设置中允许麦克风权限')
    }
  }

  const stopRecording = (): void => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    setStopping(true)
    recorder.stop()
  }

  const pickImage = async (file: File): Promise<void> => {
    const validation = validateImage(file.size, file.type)
    if (!validation.ok) {
      setLocalError(validation.message ?? '图片不符合要求')
      return
    }
    try {
      const bytes = await file.arrayBuffer()
      const staged = await window.pa.agent.stageTempFile({
        fileName: file.name || 'image.png',
        mimeType: file.type,
        bytes
      })
      const part: ImagePart = {
        kind: 'image',
        tempFilePath: staged.tempFilePath,
        byteSize: file.size,
        mimeType: file.type as ImagePart['mimeType']
      }
      setAttachments((current) => [...current, part])
      setLocalError(undefined)
    } catch {
      setLocalError('图片保存失败，请重试')
    }
  }

  const send = async (): Promise<void> => {
    if (disabled || sending || recording) return
    const trimmed = text.trim()
    const validation = validateText(trimmed)
    if (!validation.ok) {
      setLocalError(validation.message ?? '输入超出限制')
      return
    }
    const parts: InputPart[] = [
      ...(trimmed.length > 0 ? [{ kind: 'text' as const, text: trimmed }] : []),
      ...attachments
    ]
    if (parts.length === 0) return
    setSending(true)
    try {
      const ok = await onSend(parts)
      if (ok) {
        setText('')
        setAttachments([])
        setLocalError(undefined)
      }
    } finally {
      setSending(false)
    }
  }

  const overLimit = text.length > LIMITS.textChars
  const busy = disabled || sending
  const canSend = !busy && !overLimit && !recording && (text.trim().length > 0 || attachments.length > 0)

  return (
    <footer className="composer-wrap">
      {suggestions && suggestions.length > 0 && text.length === 0 && attachments.length === 0 && (
        <div className="composer-suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="prompt-chip is-small"
              disabled={busy}
              onClick={() => {
                setText(suggestion)
                textareaRef.current?.focus()
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <div
        className={`composer ${dragging ? 'is-dragging' : ''} ${recording ? 'is-recording' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (file && file.type.startsWith('image/')) void pickImage(file)
        }}
      >
        {localError && (
          <div className="composer-error" role="alert">
            <span>{localError}</span>
            <button type="button" onClick={() => setLocalError(undefined)} aria-label="关闭">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map((part, index) => (
              <span key={`${part.kind}-${index}`} className="attachment-chip">
                <Icon name={part.kind === 'voice' ? 'mic' : 'image'} size={14} />
                {part.kind === 'voice' ? `语音 ${formatDuration(part.durationMs)}` : '图片'}
                <button
                  type="button"
                  aria-label="移除附件"
                  onClick={() => setAttachments((current) => current.filter((_item, i) => i !== index))}
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {recording ? (
          <div className="recording-strip">
            <span className="recording-dot" aria-hidden="true" />
            <span className="recording-label">录音中 {formatDuration(elapsed)}</span>
            <span className="recording-wave" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <button type="button" className="btn btn-quiet btn-sm" onClick={stopRecording} disabled={stopping}>
              {stopping ? '处理中…' : '停止并添加'}
            </button>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            onPaste={(event) => {
              const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith('image/'))
              if (file) {
                event.preventDefault()
                void pickImage(file)
              }
            }}
            placeholder={UI_TEXT.inputPlaceholder}
            rows={2}
            maxLength={LIMITS.textChars}
            disabled={busy}
          />
        )}

        <div className="composer-toolbar">
          <div className="composer-tools">
            <button
              type="button"
              className="tool-button"
              onClick={() => void startRecording()}
              disabled={busy || recording}
              title="录一段语音"
            >
              <Icon name="mic" size={18} />
              <span>语音</span>
            </button>
            <button
              type="button"
              className="tool-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || recording}
              title="选择图片"
            >
              <Icon name="image" size={18} />
              <span>图片</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void pickImage(file)
                event.target.value = ''
              }}
            />
          </div>

          <div className="composer-submit">
            {text.length > 0 && (
              <span className={`char-count ${overLimit ? 'is-over' : ''}`}>
                {text.length}/{LIMITS.textChars}
              </span>
            )}
            <button
              type="button"
              className="send-button"
              onClick={() => void send()}
              disabled={!canSend}
              aria-label="发送"
            >
              <Icon name="send" size={18} />
            </button>
          </div>
        </div>
      </div>

      <p className="composer-hint">
        {UI_TEXT.inputHint} · Enter 发送，Shift + Enter 换行
      </p>
    </footer>
  )
}