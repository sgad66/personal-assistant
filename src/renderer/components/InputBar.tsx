import React, { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AccessStatus,
  AiChannelKind,
  ChannelAvailability,
  InputPart,
  ImagePart,
  PresetId,
  VoicePart
} from '@shared/ipc-contracts'
import { translate, UI_TEXT } from '@shared/message-catalog'
import { LIMITS } from '@shared/schemas'
import { DEFAULT_CHANNEL_STATES, preflightInput } from '@shared/ai/capability-gate'
import { detectEndpointRisk } from '@shared/ai/endpoint-guard'
import { formatDuration, validateImage, validateText, validateVoice } from '../input-collector'
import Icon from './Icon'

interface InputBarProps {
  readonly disabled: boolean
  readonly onSend: (parts: InputPart[]) => Promise<boolean>
  readonly seedText?: string
  readonly onSeedConsumed?: () => void
  readonly suggestions?: readonly string[]
  readonly channelStates?: Readonly<Record<AiChannelKind, ChannelAvailability>>
  readonly onBlockedByCapability?: (channel: AiChannelKind) => void
  readonly onOpenSettings?: () => void
  readonly aiStatus?: AccessStatus
  readonly bindings?: Readonly<Record<AiChannelKind, { readonly presetId: PresetId; readonly endpoint: string }>>
  readonly requestMediaPicker?: 'image' | 'voice'
  readonly onPickerConsumed?: () => void
}

const MAX_RECORD_MS = 60_000

export default function InputBar({
  disabled,
  onSend,
  seedText,
  onSeedConsumed,
  suggestions,
  channelStates,
  onBlockedByCapability,
  onOpenSettings,
  aiStatus,
  bindings,
  requestMediaPicker,
  onPickerConsumed
}: InputBarProps): React.ReactElement {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<InputPart[]>([])
  const [recording, setRecording] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [localError, setLocalError] = useState<string | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [blockedChannel, setBlockedChannel] = useState<AiChannelKind | undefined>(undefined)
  const [dropConfirm, setDropConfirm] = useState(false)
  const [endpointConfirm, setEndpointConfirm] = useState(false)
  const [pendingParts, setPendingParts] = useState<readonly InputPart[] | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startAtRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const states: Readonly<Record<AiChannelKind, ChannelAvailability>> = channelStates ?? DEFAULT_CHANNEL_STATES
  const voiceReady = states.asr === 'available'
  const visionReady = states.vision === 'available'

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

  const blockedMessageOf = useCallback(
    (channel: AiChannelKind): string => {
      if (aiStatus === 'deepseek_text_only' && channel !== 'text' && states[channel] !== 'available') {
        return translate(channel === 'vision' ? 'ai.strict.visionBlocked' : 'ai.strict.asrBlocked')
      }
      if (states[channel] === 'unsupported') {
        return translate(channel === 'vision' ? 'ai.gap.deepseekVision' : 'ai.gap.deepseekAsr')
      }
      if (channel === 'vision') return translate('ai.gap.confirmDropImage')
      return translate('ai.gap.keepFallback')
    },
    [states, aiStatus]
  )

  const blockChannel = useCallback(
    (channel: AiChannelKind): void => {
      setLocalError(blockedMessageOf(channel))
      setBlockedChannel(channel)
      onBlockedByCapability?.(channel)
    },
    [blockedMessageOf, onBlockedByCapability]
  )

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

  const guardImage = (file: File): void => {
    if (!visionReady) {
      blockChannel('vision')
      return
    }
    void pickImage(file)
  }

  const deliver = async (parts: readonly InputPart[]): Promise<void> => {
    setSending(true)
    try {
      const ok = await onSend([...parts])
      if (ok) {
        setText('')
        setAttachments([])
        setLocalError(undefined)
        setBlockedChannel(undefined)
        setDropConfirm(false)
        setPendingParts(null)
      }
    } finally {
      setSending(false)
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
    const decision = preflightInput(
      parts.map((part) => ({ kind: part.kind })),
      states
    )
    if (decision.kind === 'reject') {
      setLocalError(translate(decision.messageKey))
      setBlockedChannel(decision.code === 'E_OCR_UNSUPPORTED' ? 'vision' : 'asr')
      return
    }
    if (decision.kind === 'confirm_drop_image') {
      setPendingParts(parts)
      setDropConfirm(true)
      return
    }
    if (hasEndpointRisk(parts)) {
      setPendingParts(parts)
      setEndpointConfirm(true)
      return
    }
    setBlockedChannel(undefined)
    await deliver(parts)
  }

  const hasEndpointRisk = (parts: readonly InputPart[]): boolean => {
    if (!bindings) return false
    for (const part of parts) {
      if (part.kind === 'text') continue
      const channel: AiChannelKind = part.kind === 'voice' ? 'asr' : 'vision'
      const binding = bindings[channel]
      if (!binding) continue
      const risk = detectEndpointRisk({
        channel,
        presetId: binding.presetId,
        endpoint: binding.endpoint
      })
      if (risk) return true
    }
    return false
  }

  const confirmEndpointAndSend = async (): Promise<void> => {
    const parts = pendingParts ?? []
    setEndpointConfirm(false)
    setPendingParts(null)
    if (parts.length === 0) return
    await deliver(parts)
  }

  useEffect(() => {
    if (!requestMediaPicker) return
    if (requestMediaPicker === 'image') {
      fileInputRef.current?.click()
    } else if (!recording) {
      void startRecording()
    }
    onPickerConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestMediaPicker, onPickerConsumed])

  const confirmDropImage = async (): Promise<void> => {
    const kept = (pendingParts ?? []).filter((part) => part.kind !== 'image')
    setDropConfirm(false)
    setPendingParts(null)
    if (kept.length === 0) return
    await deliver(kept)
  }

  const overLimit = text.length > LIMITS.textChars
  const busy = disabled || sending
  const canSend = !busy && !overLimit && !recording && (text.trim().length > 0 || attachments.length > 0)
  const voiceTitle = voiceReady ? '录一段语音' : `语音不可用：${blockedMessageOf('asr')}`
  const imageTitle = visionReady ? '选择图片' : `图片不可用：${blockedMessageOf('vision')}`

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
          if (file && file.type.startsWith('image/')) guardImage(file)
        }}
      >
        {localError && (
          <div className="composer-error" role="alert">
            <span>{localError}</span>
            {blockedChannel !== undefined && onOpenSettings && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => {
                  onOpenSettings()
                  setLocalError(undefined)
                  setBlockedChannel(undefined)
                }}
              >
                打开 AI 设置
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setLocalError(undefined)
                setBlockedChannel(undefined)
              }}
              aria-label="关闭"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        {dropConfirm && (
          <div className="inline-confirm" role="alertdialog">
            <div>
              <strong>{translate('ai.gap.confirmDropImage')}</strong>
              <p>图片不会被发送，文字与语音保持原样；取消后附件仍会保留。</p>
            </div>
            <div className="inline-confirm-actions">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDropConfirm(false)}>
                取消
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void confirmDropImage()}>
                仅按文字继续
              </button>
            </div>
          </div>
        )}

        {endpointConfirm && (
          <div className="inline-confirm" role="alertdialog">
            <div>
              <strong>{translate('ai.fail.endpointConfirm')}</strong>
              <p>不会修改你的端点、预设或 Key；取消后附件仍会保留。</p>
            </div>
            <div className="inline-confirm-actions">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEndpointConfirm(false)}>
                取消
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void confirmEndpointAndSend()}>
                仍然发送
              </button>
            </div>
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
                guardImage(file)
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
              className={`tool-button ${voiceReady ? '' : 'is-blocked'}`}
              aria-disabled={voiceReady ? undefined : 'true'}
              onClick={() => {
                if (!voiceReady) {
                  blockChannel('asr')
                  return
                }
                void startRecording()
              }}
              disabled={busy || recording}
              title={voiceTitle}
            >
              <Icon name="mic" size={18} />
              <span>语音</span>
            </button>
            <button
              type="button"
              className={`tool-button ${visionReady ? '' : 'is-blocked'}`}
              aria-disabled={visionReady ? undefined : 'true'}
              onClick={() => {
                if (!visionReady) {
                  blockChannel('vision')
                  return
                }
                fileInputRef.current?.click()
              }}
              disabled={busy || recording}
              title={imageTitle}
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
                if (file) guardImage(file)
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