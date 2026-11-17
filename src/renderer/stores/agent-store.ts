import { create } from 'zustand'
import type {
  ConversationMessageDto,
  ConversationTurn,
  FailurePresentationDto,
  InputPart,
  ResolutionCommand,
  RetryAffordance,
  SubmitEnvelope
} from '@shared/ipc-contracts'
import type { ConflictItem, ConversationState, ParsePreview } from '@shared/domain/types'
import { translate } from '@shared/message-catalog'
import { buildEnvelope } from '../input-collector'

export type RetryState = 'idle' | 'auto_retrying' | 'auto_retry_failed' | 'manual_retrying'

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
  failure?: FailurePresentationDto
  retry?: RetryAffordance
  retryState?: RetryState
  retryStartedAt?: number
  lastFailedModality?: ConversationMessageDto['modality']
  mediaPickerRequest?: 'image' | 'voice'
  initialized: boolean
  seedPrompt?: string
  init: () => Promise<void>
  sendText: (text: string) => Promise<boolean>
  sendParts: (parts: readonly InputPart[], options?: { readonly retryOf?: string; readonly attachment?: SubmitEnvelope['attachment'] }) => Promise<boolean>
  resolve: (command: ResolutionCommand) => Promise<boolean>
  retryLast: () => Promise<boolean>
  reselectMedia: (kind: 'image' | 'voice') => void
  consumeMediaPicker: () => void
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
  retryState: 'idle',

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })
    try {
      const history = await window.pa.agent.history({ limit: 100 })
      set((state) => (state.messages.length === 0 ? { messages: history } : {}))
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  sendText: (text) => get().sendParts([{ kind: 'text', text }]),

  sendParts: async (parts, options) => {
    const envelope: SubmitEnvelope = {
      ...buildEnvelope(parts),
      ...(options?.attachment ? { attachment: options.attachment } : {}),
      ...(options?.retryOf ? { retryOf: options.retryOf } : {})
    }
    set({
      busy: true,
      error: undefined,
      lastEnvelope: envelope,
      retryStartedAt: Date.now(),
      ...(options?.retryOf ? { retryState: 'manual_retrying' as const } : {})
    })
    try {
      const turn = await window.pa.agent.submit(envelope)
      applyTurn(set, turn)
      return true
    } catch (error) {
      set({ busy: false, error: errorMessage(error), retryStartedAt: undefined, retryState: 'idle' })
      return false
    }
  },

  resolve: async (command) => {
    set({ busy: true, error: undefined })
    try {
      const turn = await window.pa.agent.resolve(command)
      applyTurn(set, turn)
      return true
    } catch (error) {
      set({ busy: false, error: errorMessage(error) })
      return false
    }
  },

  retryLast: async () => {
    const { lastEnvelope, retry, lastTurn, busy } = get()
    if (busy) return false
    if (!lastEnvelope) {
      set({ error: '没有可重试的内容，请重新输入' })
      return false
    }
    const affordance: RetryAffordance =
      retry ?? { available: true, kind: lastEnvelope.parts.some((part) => part.kind !== 'text') ? 'media' : 'text' }
    if (affordance.kind === 'text') {
      return get().sendParts(lastEnvelope.parts, { attachment: lastEnvelope.attachment })
    }
    if (!affordance.available) {
      set({ error: translate('ai.fail.mediaExpired'), retryState: 'idle' })
      return false
    }
    const retryOf = lastTurn?.assistantMessage.messageId
    return get().sendParts(lastEnvelope.parts, { attachment: lastEnvelope.attachment, retryOf })
  },

  reselectMedia: (kind) => set({ mediaPickerRequest: kind, error: undefined }),
  consumeMediaPicker: () => set({ mediaPickerRequest: undefined }),

  setSeedPrompt: (text) => set({ seedPrompt: text }),
  consumeSeedPrompt: () => set({ seedPrompt: undefined }),
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
    error: undefined,
    lastTurn: turn,
    failure: turn.failure,
    retry: turn.retry,
    retryState: turn.retryState ?? 'idle',
    retryStartedAt: undefined,
    lastFailedModality:
      turn.assistantMessage.status === 'failed' ? turn.assistantMessage.modality : undefined
  }))
}