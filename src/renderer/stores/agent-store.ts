import { create } from 'zustand'
import type {
  ConversationMessageDto,
  ConversationTurn,
  InputPart,
  ResolutionCommand,
  SubmitEnvelope
} from '@shared/ipc-contracts'
import type { ConflictItem, ConversationState, ParsePreview } from '@shared/domain/types'
import { describeResolution, previewInput, settleTurn, unionMessages } from '@shared/conversation-thread'
import { buildEnvelope } from '../input-collector'

interface AgentState {
  messages: ConversationMessageDto[]
  conversationState: ConversationState
  parsePreview?: ParsePreview
  candidates?: readonly ParsePreview[]
  conflicts?: readonly ConflictItem[]
  busy: boolean
  error?: string
  lastEnvelope?: SubmitEnvelope
  lastTurn?: ConversationTurn
  initialized: boolean
  seedPrompt?: string
  init: () => Promise<void>
  sendText: (text: string) => Promise<boolean>
  sendParts: (parts: readonly InputPart[]) => Promise<boolean>
  resolve: (command: ResolutionCommand) => Promise<boolean>
  retryLast: () => Promise<boolean>
  setSeedPrompt: (text: string) => void
  consumeSeedPrompt: () => void
  clearError: () => void
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cleaned = error.message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
    return cleaned.length > 0 ? cleaned : '操作失败，请重试'
  }
  return '操作失败，请重试'
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  conversationState: 'idle',
  busy: false,
  initialized: false,
  seedPrompt: undefined,

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })
    try {
      const history = await window.pa.agent.history({ limit: 100 })
      set((state) => ({ messages: unionMessages(history, state.messages) }))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  sendText: (text) => get().sendParts([{ kind: 'text', text }]),

  sendParts: async (parts) => {
    const envelope = buildEnvelope(parts)
    const pending = pendingUser(previewInput(parts))
    set((state) => ({
      busy: true,
      error: undefined,
      lastEnvelope: envelope,
      messages: [...state.messages, pending]
    }))
    try {
      const turn = await window.pa.agent.submit(envelope)
      applyTurn(set, turn, pending.messageId)
      return true
    } catch (error) {
      failTurn(set, pending.messageId, error)
      return false
    }
  },

  resolve: async (command) => {
    const pending = pendingUser(previewInput([{ kind: 'text', text: describeResolution(command) }]))
    set((state) => ({
      busy: true,
      error: undefined,
      messages: [...state.messages, pending]
    }))
    try {
      const turn = await window.pa.agent.resolve(command)
      applyTurn(set, turn, pending.messageId)
      return true
    } catch (error) {
      failTurn(set, pending.messageId, error)
      return false
    }
  },

  retryLast: async () => {
    const last = get().lastEnvelope
    if (!last) {
      set({ error: '没有可重试的内容，请重新输入' })
      return false
    }
    const hasMedia = last.parts.some((part) => part.kind !== 'text')
    if (hasMedia) {
      set({ error: '语音或图片已清理，请重新录制或选择' })
      return false
    }
    return get().sendParts(last.parts)
  },

  setSeedPrompt: (text) => set({ seedPrompt: text }),
  consumeSeedPrompt: () => set({ seedPrompt: undefined }),
  clearError: () => set({ error: undefined })
}))

function pendingUser(preview: { content: string; modality: ConversationMessageDto['modality'] }): ConversationMessageDto {
  return {
    messageId: `pending_${crypto.randomUUID()}`,
    role: 'user',
    content: preview.content.length > 0 ? preview.content : '（空消息）',
    modality: preview.modality,
    createdAt: Date.now(),
    status: 'parsed'
  }
}

function localAssistant(content: string): ConversationMessageDto {
  return {
    messageId: `local_${crypto.randomUUID()}`,
    role: 'assistant',
    content,
    modality: 'text',
    createdAt: Date.now(),
    status: 'failed'
  }
}

function failTurn(
  set: (partial: Partial<AgentState> | ((state: AgentState) => Partial<AgentState>)) => void,
  pendingId: string,
  error: unknown
): void {
  const text = errorMessage(error)
  set((state) => ({
    busy: false,
    error: undefined,
    messages: settleTurn(state.messages, pendingId, state.messages.find((message) => message.messageId === pendingId) ?? {
      messageId: pendingId,
      role: 'user',
      content: '（未能显示的输入）',
      modality: 'text',
      createdAt: Date.now(),
      status: 'failed'
    }, localAssistant(text))
  }))
}

function applyTurn(
  set: (partial: Partial<AgentState> | ((state: AgentState) => Partial<AgentState>)) => void,
  turn: ConversationTurn,
  pendingId: string
): void {
  set((state) => ({
    messages: settleTurn(state.messages, pendingId, turn.userMessage, turn.assistantMessage),
    conversationState: turn.state,
    parsePreview: turn.parsePreview,
    candidates: turn.candidates,
    conflicts: turn.conflicts,
    busy: false,
    error: undefined,
    lastTurn: turn
  }))
}