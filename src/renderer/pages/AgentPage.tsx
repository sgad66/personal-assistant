import React, { useEffect, useRef, useState } from 'react'
import type { InputPart } from '@shared/ipc-contracts'
import { useNavigationStore } from '../stores/navigation-store'
import { useAgentStore } from '../stores/agent-store'
import { useAppStore } from '../stores/app-store'
import InputBar from '../components/InputBar'
import MessageList from '../components/MessageList'
import ActionPanel from '../components/ActionPanel'
import Icon from '../components/Icon'
import { aiStatusShortLabel } from '../ui-text'

interface AgentPageProps {
  readonly onOpenSettings: () => void
}


export default function AgentPage({ onOpenSettings }: AgentPageProps): React.ReactElement {
  const navigate = useNavigationStore((state) => state.navigate)
  const init = useAgentStore((state) => state.init)
  const sendParts = useAgentStore((state) => state.sendParts)
  const resolve = useAgentStore((state) => state.resolve)
  const retryLast = useAgentStore((state) => state.retryLast)
  const clearError = useAgentStore((state) => state.clearError)
  const messages = useAgentStore((state) => state.messages)
  const busy = useAgentStore((state) => state.busy)
  const error = useAgentStore((state) => state.error)
  const conversationState = useAgentStore((state) => state.conversationState)
  const seedPrompt = useAgentStore((state) => state.seedPrompt)
  const consumeSeedPrompt = useAgentStore((state) => state.consumeSeedPrompt)
  const aiStatus = useAppStore((state) => state.home?.aiStatus ?? 'local')

  const [localSeed, setLocalSeed] = useState<string | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [messages.length, busy, conversationState])

  const handleSend = async (parts: InputPart[]): Promise<boolean> => {
    const text = parts.length === 1 && parts[0]?.kind === 'text' ? parts[0].text : undefined
    if (conversationState === 'clarifying' && text) {
      return resolve({ kind: 'supplement', text })
    }
    return sendParts(parts)
  }

  const seedText = seedPrompt ?? localSeed
  const handleSeedConsumed = (): void => {
    if (seedPrompt) consumeSeedPrompt()
    setLocalSeed(undefined)
  }

  return (
    <main className="page agent-page">
      <header className="page-top">
        <div className="page-top-copy">
          <span className="eyebrow">AGENT</span>
          <h1>智能体</h1>
          <p>
            <span className={`status-dot ${aiStatus === 'local' ? 'is-local' : 'is-online'}`} aria-hidden="true" />
            {aiStatusShortLabel(aiStatus)} · 支持文字、语音与图片
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

      />
    </main>
  )
}