import React, { useEffect, useRef, useState } from 'react'
import type { AiChannelKind, InputPart } from '@shared/ipc-contracts'
import { DEFAULT_CHANNEL_STATES, inputHintOf } from '@shared/ai/capability-gate'
import { useNavigationStore } from '../stores/navigation-store'
import { useAgentStore, type RetryState } from '../stores/agent-store'
import { useAppStore } from '../stores/app-store'
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

  const [localSeed, setLocalSeed] = useState<string | undefined>(undefined)
  const [derivedRetryState, setDerivedRetryState] = useState<RetryState>('idle')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const resolvedStates = channelStates ?? DEFAULT_CHANNEL_STATES

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [messages.length, busy, conversationState])

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
          <span className="eyebrow">AGENT</span>
          <h1>智能体</h1>
          <p>
            <span className={`status-dot ${aiStatus === 'local' ? 'is-local' : 'is-online'}`} aria-hidden="true" />
            {aiStatusShortLabel(aiStatus)} · {inputHintOf(aiStatus, resolvedStates)}
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
        />
        <ActionPanel
          conversationState={conversationState}
          onResolve={(command) => void resolve(command)}
          onReparse={() => void resolve({ kind: 'reparse' })}
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
        disabled={busy}
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
      />
    </main>
  )
}