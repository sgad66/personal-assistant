import React, { useEffect, useState } from 'react'
import type { InputPart } from '@shared/ipc-contracts'
import { UI_TEXT } from '@shared/message-catalog'
import { useNavigationStore } from '../stores/navigation-store'
import { useAgentStore } from '../stores/agent-store'
import InputBar from '../components/InputBar'
import MessageList from '../components/MessageList'
import ActionPanel from '../components/ActionPanel'
import AiSettings from '../components/AiSettings'
import PageHeader from '../components/PageHeader'

export default function AgentPage(): React.ReactElement {
  const back = useNavigationStore((state) => state.back)
  const init = useAgentStore((state) => state.init)
  const sendParts = useAgentStore((state) => state.sendParts)
  const resolve = useAgentStore((state) => state.resolve)
  const retryLast = useAgentStore((state) => state.retryLast)
  const clearError = useAgentStore((state) => state.clearError)
  const messages = useAgentStore((state) => state.messages)
  const busy = useAgentStore((state) => state.busy)
  const error = useAgentStore((state) => state.error)
  const conversationState = useAgentStore((state) => state.conversationState)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  const handleSend = async (parts: InputPart[]): Promise<void> => {
    const text = parts.length === 1 && parts[0]?.kind === 'text' ? parts[0].text : undefined
    if (conversationState === 'clarifying' && text) {
      await resolve({ kind: 'supplement', text })
      return
    }
    await sendParts(parts)
  }

  return (
    <main className="page agent-page">
      <PageHeader
        title={UI_TEXT.agentTitle}
        onBack={back}
        actions={
          <button type="button" className="ghost-button" onClick={() => setSettingsOpen(true)}>
            {UI_TEXT.settings}
          </button>
        }
      />

      <div className="chat-area">
        <MessageList messages={messages} busy={busy} onRetry={() => void retryLast()} />
        <ActionPanel
          conversationState={conversationState}
          onResolve={(command) => void resolve(command)}
          onReparse={() => void resolve({ kind: 'reparse' })}
        />
      </div>

      {error && (
        <div className="error-banner chat-error" role="alert">
          <span>{error}</span>
          <div className="error-actions">
            <button type="button" onClick={() => void retryLast()}>
              重试
            </button>
            <button type="button" className="ghost-button" onClick={clearError}>
              关闭
            </button>
          </div>
        </div>
      )}

      <InputBar disabled={busy} onSend={handleSend} />

      {settingsOpen && <AiSettings onClose={() => setSettingsOpen(false)} />}
    </main>
  )
}