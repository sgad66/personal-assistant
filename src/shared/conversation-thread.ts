import type { ConversationMessageDto, ResolutionCommand } from './ipc-contracts'
import type { InputModality } from './domain/types'

export function describeResolution(command: ResolutionCommand): string {
  switch (command.kind) {
    case 'supplement':
      return command.text
    case 'confirm_candidates':
      return `确认写入第 ${command.selectedIndexes.map((index) => index + 1).join('、')} 项`
    case 'reject_candidates':
      return '放弃本次识别的全部候选'
    case 'confirm_understanding':
      return '确认理解正确'
    case 'reparse':
      return '重新描述'
    case 'conflict_decision':
      return command.choice === 'create_anyway'
        ? '仍然创建'
        : command.choice === 'abandon'
          ? '放弃'
          : '改时间'
    default:
      return '继续'
  }
}

export function previewInput(parts: readonly { kind: string; text?: string; durationMs?: number }[]): {
  content: string
  modality: InputModality
} {
  const content = parts
    .map((part) => {
      if (part.kind === 'text') return part.text ?? ''
      if (part.kind === 'voice') return `【语音 ${Math.round((part.durationMs ?? 0) / 1000)} 秒】`
      return '【图片】'
    })
    .join(' ')
    .slice(0, 1000)
  const kinds = new Set(parts.map((part) => part.kind))
  const only = parts[0]?.kind
  const modality: InputModality =
    kinds.size >= 2 ? 'composite' : only === 'voice' ? 'voice' : only === 'image' ? 'image' : 'text'
  return { content, modality }
}

export function unionMessages(
  base: readonly ConversationMessageDto[],
  extra: readonly ConversationMessageDto[]
): ConversationMessageDto[] {
  const seen = new Set(base.map((message) => message.messageId))
  const merged = [...base]
  for (const message of extra) {
    if (seen.has(message.messageId)) continue
    seen.add(message.messageId)
    merged.push(message)
  }
  return merged
}

/** Drop the optimistic user bubble, then append the server user and assistant messages in that order. */
export function settleTurn(
  messages: readonly ConversationMessageDto[],
  pendingId: string,
  userMessage: ConversationMessageDto,
  assistantMessage: ConversationMessageDto
): ConversationMessageDto[] {
  const withoutPending = messages.filter((message) => message.messageId !== pendingId)
  return unionMessages(withoutPending, [userMessage, assistantMessage])
}
