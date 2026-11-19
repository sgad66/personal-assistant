import React, { useEffect, useRef, useState } from 'react'
import type { AiChannelKind, InputPart } from '@shared/ipc-contracts'
import { DEFAULT_CHANNEL_STATES, inputHintOf } from '@shared/ai/capability-gate'
import { useNavigationStore } from '../stores/navigation-store'
import { useAgentStore, type RetryState } from '../stores/agent-store'
import { useAppStore } from '../stores/app-store'
import { useImportStore } from '../stores/import-store'
import { detectFormat } from '@shared/import/detect'
import { decodeTextBytes } from '@shared/import/decode'
import { extractText } from '@shared/import/extract'
import { encodeImportHeader, importTextBudget } from '@shared/import/header'
import { nextImportAction, type ImportDecisionFacts } from '@shared/import/runner'
import { sanitizeFileName } from '@shared/import/text'
import { selectTimeClueWindow } from '@shared/import/time-clues'
import type { ImportTextFormat } from '@shared/import/limits'
import type { ImportPanelContext } from '../components/ImportContextBlock'
import InputBar from '../components/InputBar'
import MessageList from '../components/MessageList'
import ActionPanel from '../components/ActionPanel'
import Icon from '../components/Icon'
import { aiStatusShortLabel } from '../ui-text'

interface AgentPageProps {
  readonly onOpenSettings: () => void
}

const FIRST_BYTE_HINT_MS = 8_000

export default function AgentPage({ onOpenSettings }: AgentPageProps): React.ReactElement {
  const navigate = useNavigationStore((state) => state.navigate)
  const init = useAgentStore((state) => state.init)
  const sendParts = useAgentStore((state) => state.sendParts)
  const resolve = useAgentStore((state) => state.resolve)
  const retryLast = useAgentStore((state) => state.retryLast)
  const clearError = useAgentStore((state) => state.clearError)
  const reselectMedia = useAgentStore((state) => state.reselectMedia)
  const consumeMediaPicker = useAgentStore((state) => state.consumeMediaPicker)
  const messages = useAgentStore((state) => state.messages)
  const busy = useAgentStore((state) => state.busy)
  const pending = useAgentStore((state) => state.pending)
  const quoted = useAgentStore((state) => state.quoted)
  const quoteMessage = useAgentStore((state) => state.quoteMessage)
  const removeQuote = useAgentStore((state) => state.removeQuote)
  const error = useAgentStore((state) => state.error)
  const conversationState = useAgentStore((state) => state.conversationState)
  const seedPrompt = useAgentStore((state) => state.seedPrompt)
  const consumeSeedPrompt = useAgentStore((state) => state.consumeSeedPrompt)
  const failure = useAgentStore((state) => state.failure)
  const retry = useAgentStore((state) => state.retry)
  const retryState = useAgentStore((state) => state.retryState)
  const retryStartedAt = useAgentStore((state) => state.retryStartedAt)
  const mediaPickerRequest = useAgentStore((state) => state.mediaPickerRequest)
  const aiStatus = useAppStore((state) => state.home?.aiStatus ?? 'local')
  const channelStates = useAppStore((state) => state.home?.aiChannelStates)
  const bindings = useAppStore((state) => state.home?.aiBindings)
  const batch = useImportStore((state) => state.batch)
  const markReading = useImportStore((state) => state.markReading)
  const markFileResult = useImportStore((state) => state.markFileResult)
  const applyTurn = useImportStore((state) => state.applyTurn)
  const fileAt = useImportStore((state) => state.fileAt)
  const setHighlight = useImportStore((state) => state.setHighlight)

  const [localSeed, setLocalSeed] = useState<string | undefined>(undefined)
  const [importContext, setImportContext] = useState<ImportPanelContext | undefined>(undefined)
  const [derivedRetryState, setDerivedRetryState] = useState<RetryState>('idle')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const resolvedStates = channelStates ?? DEFAULT_CHANNEL_STATES

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const node = scrollRef.current
    if (!node || messages.length === 0) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'auto' })
  }, [messages.length, pending.length, pending[0]?.stage, conversationState])

  useEffect(() => {
    if (!busy || retryStartedAt === undefined) {
      setDerivedRetryState('idle')
      return
    }
    const timer = window.setTimeout(() => setDerivedRetryState('auto_retrying'), FIRST_BYTE_HINT_MS)
    return () => window.clearTimeout(timer)
  }, [busy, retryStartedAt])

  const handleBlockedByCapability = (_channel: AiChannelKind): void => {
    void _channel
  }

  const handleSend = async (parts: InputPart[]): Promise<boolean> => {
    const text = parts.length === 1 && parts[0]?.kind === 'text' ? parts[0].text : undefined
    if (conversationState === 'clarifying' && text) {
      return resolve({ kind: 'supplement', text })
    }
    return sendParts(parts)
  }

  const readOne = async (index: number): Promise<void> => {
    markReading(index)
    const file = fileAt(index)
    if (!file) {
      markFileResult(index, { phase: 'failed', failureKind: 'unreadable', reasonKey: 'import.readFailed' })
      return
    }
    const started = Date.now()
    let buffer: ArrayBuffer
    try {
      buffer = await file.arrayBuffer()
    } catch {
      markFileResult(index, {
        phase: 'failed',
        failureKind: 'unreadable',
        reasonKey: 'import.readFailed'
      })
      return
    }
    const decoded = decodeTextBytes(new Uint8Array(buffer))
    if (!decoded.ok) {
      const binary = decoded.reason === 'binary'
      markFileResult(index, {
        phase: 'failed',
        failureKind: binary ? 'no_text' : 'decode',
        reasonKey: binary ? 'import.noText' : 'import.decodeFailed'
      })
      return
    }
    const format = detectFormat(file.name)
    const textFormat: ImportTextFormat =
      format === 'md' || format === 'csv' || format === 'ics' || format === 'json' ? format : 'txt'
    const extracted = extractText(textFormat, decoded.text)
    if (extracted.text.trim().length < 1) {
      markFileResult(index, { phase: 'failed', failureKind: 'no_text', reasonKey: 'import.noText' })
      return
    }
    const fileName = sanitizeFileName(file.name)
    const probe = encodeImportHeader({
      ext: textFormat,
      bytes: file.size,
      chars: extracted.text.length,
      clipped: false,
      fileName
    })
    const win = selectTimeClueWindow(extracted.text, importTextBudget(probe.length))
    if (!win.hasClue) {
      markFileResult(index, {
        phase: 'no_schedule',
        reasonKey: 'import.noScheduleFound',
        durationMs: Date.now() - started
      })
      return
    }
    const header = encodeImportHeader({
      ext: textFormat,
      bytes: file.size,
      chars: win.originalChars,
      clipped: win.clipped,
      fileName
    })
    const body = win.text.slice(0, importTextBudget(header.length))
    markFileResult(index, {
      phase: 'submitting',
      readableChars: body.length,
      originalChars: win.originalChars,
      clipped: win.clipped,
      durationMs: Date.now() - started
    })
    setImportContext({
      fileName,
      readableChars: body.length,
      originalChars: win.originalChars,
      clipped: win.clipped,
      submittedPreview: body,
      fileIndex: index + 1,
      fileTotal: batch?.files.length ?? 1
    })
    const ok = await sendParts([{ kind: 'text', text: `${header}\n${body}` }], { awaitCompletion: true })
    if (!ok) {
      markFileResult(index, {
        phase: 'failed',
        failureKind: 'parse',
        reasonKey: 'import.decodeFailed',
        durationMs: Date.now() - started
      })
      return
    }
    const turn = useAgentStore.getState().lastTurn
    if (!turn) {
      markFileResult(index, { phase: 'failed', failureKind: 'parse' })
      return
    }
    const facts: ImportDecisionFacts = {
      state: turn.state,
      candidateCount: turn.candidates?.length ?? 0,
      ...(turn.createdEventId ? { createdEventId: turn.createdEventId } : {}),
      ...(turn.errorCode ? { errorCode: turn.errorCode } : {})
    }
    applyTurn(facts)
    if (turn.createdEventId) {
      setHighlight(turn.createdEventId, Date.now() + 3_000)
    }
  }

  useEffect(() => {
    if (!batch) return
    const action = nextImportAction(batch)
    if (action.kind !== 'read') return
    const file = batch.files[action.index]
    if (!file || file.phase !== 'queued') return
    void readOne(action.index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.cursor, batch?.phase])

  useEffect(() => {
    if (!batch || batch.phase !== 'awaiting_decision' || busy) return
    const turn = useAgentStore.getState().lastTurn
    if (!turn) return
    if (['candidate_select', 'confirming', 'conflict', 'clarifying'].includes(turn.state)) return
    applyTurn({
      state: turn.state,
      candidateCount: turn.candidates?.length ?? 0,
      ...(turn.createdEventId ? { createdEventId: turn.createdEventId } : {}),
      ...(turn.errorCode ? { errorCode: turn.errorCode } : {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.phase, busy, conversationState])

  const handleUseText = (): void => {
    clearError()
    document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus()
  }

  const seedText = seedPrompt ?? localSeed
  const handleSeedConsumed = (): void => {
    if (seedPrompt) consumeSeedPrompt()
    setLocalSeed(undefined)
  }
  const effectiveRetryState: RetryState = busy ? derivedRetryState : retryState ?? 'idle'

  return (
    <main className="page agent-page">
      <header className="page-top">
        <div className="page-top-copy">
          <span className="eyebrow">CHAT</span>
          <h1>对话</h1>
          <p>
            <span className={`status-dot ${aiStatus === 'local' ? 'is-local' : 'is-online'}`} aria-hidden="true" />
            {aiStatusShortLabel(aiStatus)} · {inputHintOf(aiStatus, resolvedStates, bindings)}
          </p>
        </div>
        <div className="page-top-actions">
          <button type="button" className="btn btn-quiet" onClick={() => navigate('week')}>
            <Icon name="week" size={17} />
            本周
          </button>
          <button type="button" className="btn btn-ghost" onClick={onOpenSettings}>
            <Icon name="settings" size={17} />
            连接设置
          </button>
        </div>
      </header>

      <div className="agent-scroll" ref={scrollRef}>
        <MessageList
          messages={messages}
          pending={pending}
          busy={busy}
          onRetry={() => void retryLast()}
          onSuggestion={(text) => setLocalSeed(text)}
          failure={failure}
          retry={retry}
          retryState={effectiveRetryState}
          retryStartedAt={retryStartedAt}
          onReselect={(kind) => reselectMedia(kind)}
          onOpenSettings={onOpenSettings}
          onUseText={handleUseText}
          onQuote={(message, excerpt) => {
            quoteMessage(message, excerpt)
            window.setTimeout(() => {
              document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus()
            }, 0)
          }}
          onOpenGoals={() => navigate('goals')}
        />
        <ActionPanel
          conversationState={conversationState}
          onResolve={(command) => void resolve(command)}
          onReparse={() => void resolve({ kind: 'reparse' })}
          importContext={importContext}
        />
      </div>

      {error && (
        <div className="banner banner-danger agent-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
          <div className="banner-actions">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void retryLast()}>
              重试
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={clearError}>
              关闭
            </button>
          </div>
        </div>
      )}

      <InputBar
        disabled={false}
        onSend={handleSend}
        seedText={seedText}
        onSeedConsumed={handleSeedConsumed}
        channelStates={resolvedStates}
        onBlockedByCapability={handleBlockedByCapability}
        onOpenSettings={onOpenSettings}
        aiStatus={aiStatus}
        bindings={bindings}
        requestMediaPicker={mediaPickerRequest}
        onPickerConsumed={consumeMediaPicker}
        quoted={quoted}
        onRemoveQuote={removeQuote}
      />
    </main>
  )
}
