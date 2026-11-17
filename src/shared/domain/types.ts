// 共享领域模型：与设计文档 2.3.2 一一对应
// 所有时间字段均为 epoch 毫秒（number），存储绝对时刻

export type InputModality = 'text' | 'voice' | 'image' | 'composite'

export type ConversationState =
  | 'idle'
  | 'parsing'
  | 'clarifying'
  | 'candidate_select'
  | 'confirming'
  | 'conflict'
  | 'duplicate'
  | 'writing'
  | 'failed'
  | 'revising'

export type MessageStatus = 'parsed' | 'clarifying' | 'failed'
export type MessageRole = 'user' | 'assistant'

export interface MessageQuote {
  messageId: string
  role: MessageRole
  excerpt: string
}
export type EventStatus = 'active' | 'cancelled'
export type ReminderStatus = 'not_reminded' | 'reminded' | 'ignored'
export type ReminderChannel = 'in_app' | 'system_notification'
export type ReminderResponseKind = 'acknowledge' | 'snooze' | 'ignore' | 'none'
export type IntentKind = 'schedule' | 'modify' | 'cancel' | 'chitchat' | 'unknown'

export type OriginDevice = 'desktop' | 'mobile'
export type SyncStatus = 'synced' | 'pending_upload' | 'conflict'
export type EventVariant = 'authoritative' | 'conflict'

export interface ScheduleEvent {
  eventId: string
  title: string
  startAt: number
  endAt: number
  location?: string
  note?: string
  sourceModality: InputModality
  hasConflict: boolean
  status: EventStatus
  reminderStatus: ReminderStatus
  snoozeCount: number
  createdAt: number
  updatedAt: number
  importSourceLabel?: string
  contentRevision?: number
  originDevice?: OriginDevice
  syncStatus?: SyncStatus
  baseRevision?: number
  variant?: EventVariant
  variantOrigin?: OriginDevice
  cancelledAt?: number
  conflictId?: string
}

export interface ConversationMessage {
  messageId: string
  role: MessageRole
  content: string
  modality: InputModality
  createdAt: number
  status: MessageStatus
  relatedEventId?: string
  sourceLabel?: string
  quotes?: MessageQuote[]
}

export interface ReminderRecord {
  reminderId: string
  eventId: string
  plannedAt: number
  firedAt?: number
  response?: ReminderResponseKind
  respondedAt?: number
  channel: ReminderChannel
  handled: boolean
}

export interface PendingIntent {
  title: string
  startAt?: number
  endAt?: number
  location?: string
  note?: string
  sourceModality: InputModality
  originalText: string
  missingFields: string[]
  confidence: number
}

export interface ConversationSession {
  state: ConversationState
  lastEventId?: string
  pendingInput?: string
  pendingIntent?: PendingIntent
  pendingCandidates?: PendingIntent[]
  pendingConflictIds?: string[]
  lastClientMessageId?: string
  importContext?: { readonly label: string; readonly keepRemainder: boolean }
  updatedAt: number
}

export interface TimeInterval {
  startAt: number
  endAt: number
}

export interface ConflictItem {
  eventId: string
  title: string
  startAt: number
  endAt: number
}

export interface ParsePreview {
  title?: string
  startAt?: number
  endAt?: number
  location?: string
  note?: string
  missingFields: string[]
}

export interface WeekItem {
  eventId: string
  title: string
  startAt: number
  endAt: number
  location?: string
  timeLabel: 'timed' | 'all_day_pending'
  hasConflict: boolean
  continuation: 'none' | 'starts_here' | 'continues_from_prev'
}

export interface DayColumn {
  date: number
  isToday: boolean
  items: WeekItem[]
}

export interface WeekView {
  weekStart: number
  weekEndExclusive: number
  days: DayColumn[]
  totalCount: number
  revision: number
}

export interface ScheduleEventDetail extends WeekItem {
  note?: string
  sourceModality: InputModality
  reminderStatus: ReminderStatus
  createdAt: number
  updatedAt: number
  importSourceLabel?: string
}

export interface CreateOutcome {
  eventId: string
  event: ScheduleEvent
  conflicts: ConflictItem[]
}

export interface UpdateOutcome {
  eventId: string
  event: ScheduleEvent
  conflicts: ConflictItem[]
}

export function intervalOf(event: Pick<ScheduleEvent, 'startAt' | 'endAt'>): TimeInterval {
  return { startAt: event.startAt, endAt: event.endAt }
}

export function isActive(event: ScheduleEvent): boolean {
  return event.status === 'active'
}