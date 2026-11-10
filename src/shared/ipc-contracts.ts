import type {
  ConversationState,
  DayColumn,
  InputModality,
  ParsePreview,
  ScheduleEventDetail,
  WeekView
} from './domain/types'
import type {
  AiAccessConfigInput,
  AiAccessConfigView,
  AiFailureClass,
  AccessStatus,
  ChannelBindingInput,
  ChannelBindingView,
  KeyOp,
  ValidationIssue
} from './ai/access-config'
import type { AiErrorDto, UiAction } from './ai/failure'
import type { AiChannelKind, PresetId, PresetSummary } from './ai/preset-catalog'

export type {
  AiAccessConfigInput,
  AiAccessConfigView,
  AiFailureClass,
  AccessStatus,
  ChannelBindingInput,
  ChannelBindingView,
  KeyOp,
  ValidationIssue,
  AiChannelKind,
  PresetId,
  PresetSummary,
  AiErrorDto,
  UiAction
}

export const CONTRACT_VERSION = 2

export const IPC_CHANNELS = {
  bootstrap: 'app:bootstrap',
  agentSubmit: 'agent:submit',
  agentResolve: 'agent:resolve',
  agentHistory: 'agent:history',
  scheduleWeek: 'schedule:week',
  scheduleDetail: 'schedule:detail',
  reminderRespond: 'reminder:respond',
  desktopPresence: 'desktop:presence',
  reminderPresented: 'event:reminder-presented',
  expiredSummary: 'event:expired-summary',
  scheduleChanged: 'event:schedule-changed',
  stageTempFile: 'input:stage-temp-file',
  aiConfigGet: 'ai:config-get',
  aiConfigSet: 'ai:config-set',
  aiTestConnection: 'ai:test-connection',
  aiConfigChanged: 'event:ai-config-changed'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export interface BootstrapRequest {
  readonly contractVersion: number
}

export interface HomeState {
  readonly contractVersion: number
  readonly currentWeekStart: number
  readonly timeZone: string
  readonly activeEventCount: number
  readonly notificationPermission: 'granted' | 'denied' | 'default'
  readonly aiConfigured: boolean
  readonly aiStatus?: AccessStatus
}

export interface TextPart {
  readonly kind: 'text'
  readonly text: string
}
export interface VoicePart {
  readonly kind: 'voice'
  readonly tempFilePath: string
  readonly durationMs: number
}
export interface ImagePart {
  readonly kind: 'image'
  readonly tempFilePath: string
  readonly byteSize: number
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
}

export type InputPart = TextPart | VoicePart | ImagePart

export interface SubmitEnvelope {
  readonly clientMessageId: string
  readonly modality: InputModality
  readonly parts: readonly InputPart[]
}

export interface ConversationMessageDto {
  readonly messageId: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly modality: InputModality
  readonly createdAt: number
  readonly status: 'parsed' | 'clarifying' | 'failed'
  readonly relatedEventId?: string
}

export interface ConflictItemDto {
  readonly eventId: string
  readonly title: string
  readonly startAt: number
  readonly endAt: number
}

export interface ConversationTurn {
  readonly userMessage: ConversationMessageDto
  readonly assistantMessage: ConversationMessageDto
  readonly state: ConversationState
  readonly parsePreview?: ParsePreview
  readonly candidates?: readonly ParsePreview[]
  readonly conflicts?: readonly ConflictItemDto[]
  readonly createdEventId?: string
  readonly errorCode?: string
  readonly errorText?: string
}

export type ResolutionCommand =
  | { readonly kind: 'supplement'; readonly text: string }
  | { readonly kind: 'confirm_candidates'; readonly selectedIndexes: readonly number[] }
  | { readonly kind: 'reject_candidates' }
  | { readonly kind: 'confirm_understanding' }
  | { readonly kind: 'reparse' }
  | {
      readonly kind: 'conflict_decision'
      readonly choice: 'reschedule' | 'create_anyway' | 'abandon'
    }

export interface HistoryQuery {
  readonly limit?: number
}

export interface WeekQuery {
  readonly weekStart: number
}

export interface EventDetailQuery {
  readonly eventId: string
}

export type ReminderAction = 'acknowledge' | 'snooze' | 'ignore'

export interface ReminderResponse {
  readonly eventId: string
  readonly plannedAt: number
  readonly action: ReminderAction
}

export interface ReminderOutcome {
  readonly eventId: string
  readonly reminderStatus: 'not_reminded' | 'reminded' | 'ignored'
  readonly snoozeCount: number
  readonly nextPlannedAt?: number
}

export type PresenceState = 'foreground' | 'background'

export interface ReminderPayload {
  readonly eventId: string
  readonly plannedAt: number
  readonly title: string
  readonly startAt: number
  readonly remainingMinutes: number
}

export interface ExpiredSummary {
  readonly startedEventCount: number
}

export interface ScheduleChangeNotice {
  readonly revision: number
  readonly affectedWeekStarts: readonly number[]
}

export interface StageTempFileRequest {
  readonly fileName: string
  readonly mimeType: string
  readonly bytes: ArrayBuffer
}

export interface StageTempFileResponse {
  readonly tempFilePath: string
}

export interface AiConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly visionModel: string
  readonly asrModel: string
}

export interface AiConfigInput {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly visionModel: string
  readonly asrModel: string
}

export interface AiConfigLoadOutcome {
  readonly ok: boolean
  readonly view?: AiAccessConfigView
  readonly error?: AiErrorDto
}

export interface AiConfigSaveOutcome {
  readonly ok: boolean
  readonly view?: AiAccessConfigView
  readonly error?: AiErrorDto
  readonly issues?: readonly ValidationIssue[]
}

export interface AiConnectionTestRequest {
  readonly channel: AiChannelKind
  readonly binding: ChannelBindingInput
  readonly secret?: string
}

export interface AiConnectionTestResult {
  readonly channel: AiChannelKind
  readonly resultStatus: 'success' | 'failure'
  readonly error?: AiErrorDto
  readonly durationMs: number
}

export interface AiConfigChangedNotice {
  readonly revision: number
  readonly status: AccessStatus
}

export interface PaBridge {
  app: {
    bootstrap(request: BootstrapRequest): Promise<HomeState>
    onExpiredSummary(callback: (payload: ExpiredSummary) => void): () => void
    getAiConfig(): Promise<AiConfigLoadOutcome>
    setAiConfig(input: AiAccessConfigInput | AiConfigInput): Promise<AiConfigSaveOutcome>
    testConnection(request: AiConnectionTestRequest): Promise<AiConnectionTestResult>
    onAiConfigChanged(callback: (notice: AiConfigChangedNotice) => void): () => void
  }
  agent: {
    submit(envelope: SubmitEnvelope): Promise<ConversationTurn>
    resolve(command: ResolutionCommand): Promise<ConversationTurn>
    history(query: HistoryQuery): Promise<ConversationMessageDto[]>
    stageTempFile(request: StageTempFileRequest): Promise<StageTempFileResponse>
  }
  schedule: {
    week(query: WeekQuery): Promise<WeekView>
    detail(query: EventDetailQuery): Promise<ScheduleEventDetail>
    onChanged(callback: (notice: ScheduleChangeNotice) => void): () => void
  }
  reminder: {
    respond(response: ReminderResponse): Promise<ReminderOutcome>
    onPresented(callback: (payload: ReminderPayload) => void): () => void
  }
  desktop: {
    setPresence(state: PresenceState): Promise<void>
  }
}

export type DayColumnDto = DayColumn