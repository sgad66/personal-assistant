import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { InputPart, ImagePart, VoicePart } from '@shared/ipc-contracts'
import { UI_TEXT } from '@shared/message-catalog'
import { LIMITS } from '@shared/schemas'
import { formatDuration, validateImage, validateText, validateVoice } from '../input-collector'

interface InputBarProps {
  readonly disabled: boolean
  readonly onSend: (parts: InputPart[]) => Promise<void>
}

const MAX_RECORD_MS = 60_000

export default function InputBar({ disabled, onSend }: InputBarProps): React.ReactElement {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<InputPart[]>([])
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [localError, setLocalError] = useState<string | undefined>(undefined)
  const [sending, setSending] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startAtRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
    setElapsed(0)
  }, [])

  useEffect(() => cleanupRecording, [cleanupRecording])

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current
    const duration = Math.min(Date.now() - startAtRef.current, MAX_RECORD_MS)
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
    const chunks = chunksRef.current
    chunksRef.current = []
    cleanupRecording()
    if (chunks.length === 0) return
    const validation = validateVoice(duration)
    if (!validation.ok) {
      setLocalError(validation.message ?? '语音超出限制')
      return
    }
    const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' })
    try {
      const bytes = await blob.arrayBuffer()
      const staged = await window.pa.agent.stageTempFile({
        fileName: 'voice.webm',
        mimeType: 'audio/webm',
        bytes
      })
      const part: VoicePart = {
        kind: 'voice',
        tempFilePath: staged.tempFilePath,
        durationMs: Math.max(1_000, duration)
      }
      setAttachments((current) => [...current, part])
      setLocalError(undefined)
    } catch {
      setLocalError('语音保存失败，请重试')
    }
  }, [cleanupRecording])

  const toggleRecording = async (): Promise<void> => {
    if (disabled || sending) return
    if (recording) {
      await finishRecording()
      return
    }
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
        void finishRecording()
      }
      recorder.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = window.setInterval(() => {
        const passed = Date.now() - startAtRef.current
        setElapsed(passed)
        if (passed >= MAX_RECORD_MS && recorder.state !== 'inactive') {
          recorder.stop()
        }
      }, 200)
    } catch {
      cleanupRecording()
      setLocalError('无法访问麦克风，请在系统设置中允许麦克风权限')
    }
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
    if (disabled || sending) return
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
      await onSend(parts)
      setText('')
      setAttachments([])
      setLocalError(undefined)
    } finally {
      setSending(false)
    }
  }

  const overLimit = text.length > LIMITS.textChars

  return (
    <footer className="input-bar">
      {localError && (
        <div className="input-error" role="alert">
          {localError}
          <button type="button" onClick={() => setLocalError(undefined)}>
            ×
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="attachment-row">
          {attachments.map((part, index) => (
            <span key={`${part.kind}-${index}`} className="attachment-chip">
              {part.kind === 'voice'
                ? `语音 ${formatDuration(part.durationMs)}`
                : part.kind === 'image'
                  ? '图片'
                  : '文字'}
              <button
                type="button"
                aria-label="移除"
                onClick={() => setAttachments((current) => current.filter((_item, i) => i !== index))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="input-box">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          placeholder={UI_TEXT.inputPlaceholder}
          rows={2}
          maxLength={1200}
          disabled={disabled}
        />

        <div className="input-toolbar">
          <div className="toolbar-left">
            <button
              type="button"
              className={`icon-button ${recording ? 'is-recording' : ''}`}
              onClick={() => void toggleRecording()}
              disabled={disabled}
              title={recording ? '停止录音' : '按住说话'}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span>{recording ? formatDuration(elapsed) : '语音'}</span>
            </button>

            <button
              type="button"
              className="icon-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              title="选择图片"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="9" cy="10" r="1.6" fill="currentColor" />
                <path d="M5 17l4.5-4.5L13 16l2.5-2.5L19 17" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
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

          <div className="toolbar-right">
            <span className={`char-count ${overLimit ? 'is-over' : ''}`}>
              {text.length}/{LIMITS.textChars}
            </span>
            <button
              type="button"
              className="send-button"
              onClick={() => void send()}
              disabled={disabled || sending || overLimit}
            >
              发送
            </button>
          </div>
        </div>
      </div>
      <p className="input-hint">{UI_TEXT.inputHint}</p>
    </footer>
  )
}