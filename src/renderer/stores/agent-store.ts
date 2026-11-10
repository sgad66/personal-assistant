import { create } from 'zustand'
import type {
  ConversationMessageDto,
  ConversationTurn,
  InputPart,
  ResolutionCommand,
  SubmitEnvelope
} from '@shared/ipc-contracts'
import type { ConflictItem, ConversationState, ParsePreview } from '@shared/domain/types'
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
  submittedIds: string[]
  initialized: boolean
  init: () => Promise<void>
  sendText: (text: string) => Promise<void>
  sendParts: (parts: readonly InputPart[]) => Promise<void>
  resolve: (command: ResolutionCommand) => Promise<void>
  retryLast: () => Promise<void>
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
  submittedIds: [],
  initialized: false,

  init: async () => {
    if (get().initialized) return
    try {
      const history = await window.pa.agent.history({ limit: 100 })
      set({ messages: history, initialized: true })
    } catch (error) {
      set({ error: errorMessage(error), initialized: true })
    }
  },

  sendText: async (text) => {
    await get().sendParts([{ kind: 'text', text }])
  },

  sendParts: async (parts) => {
    const envelope = buildEnvelope(parts)
    set({ busy: true, error: undefined, lastEnvelope: envelope })
    try {
      const turn = await window.pa.agent.submit(envelope)
      applyTurn(set, turn)
      set((state) => ({ submittedIds: [...state.submittedIds, envelope.clientMessageId] }))
    } catch (error) {
      set({ busy: false, error: errorMessage(error) })
    }
  },

  resolve: async (command) => {
    set({ busy: true, error: undefined })
    try {
      const turn = await window.pa.agent.resolve(command)
      applyTurn(set, turn)
    } catch (error) {
      set({ busy: false, error: errorMessage(error) })
    }
  },

  retryLast: async () => {
    const last = get().lastEnvelope
    if (!last) {
      set({ error: '没有可重试的内容，请重新输入' })
      return
    }
    const hasMedia = last.parts.some((part) => part.kind !== 'text')
    if (hasMedia) {
      set({ error: '语音或图片已清理，请重新录制或选择' })
      return
    }
    await get().sendParts(last.parts)
  },

  clearError: () => set({ error: undefined })
}))

function applyTurn(
  set: (partial: Partial<AgentState> | ((state: AgentState) => Partial<AgentState>)) => void,
  turn: ConversationTurn
): void {
  set((state) => ({
    messages: [...state.messages, turn.userMessage, turn.assistantMessage],
    conversationState: turn.state,
    parsePreview: turn.parsePreview,
    candidates: turn.candidates,
    conflicts: turn.conflicts,
    busy: false,
    error: undefined
  }))
}