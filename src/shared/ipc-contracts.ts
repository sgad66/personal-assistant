import type {
  CareKind,
  CareSettings,
  ConversationState,
  DayColumn,
  GoalCadence,
  GoalCheckpoint,
  GoalCreatedBy,
  GoalStatus,
  InputModality,
  MemoryItem,
  MemoryKind,
  MessageQuote,
  ParsePreview,
  ScheduleEventDetail,
  WeekView
} from './domain/types'
import type {
  AiAccessConfigInput,
  AiAccessConfigView,
  AiDiagnosticsView,
  AiFailureClass,
  AiFailureDiagnosticDto,
  AccessStatus,
  CapabilityGapConfirmation,
  ChannelAvailability,
  ChannelBindingInput,
  ChannelBindingView,
  KeyOp,
  ValidationIssue
} from './ai/access-config'
import type { ChannelCapabilityGap } from './ai/capability-gate'
import type { SolutionId } from './ai/solution'
import type { TimeoutPreferences } from './ai/timeout-policy'
import type { AiErrorDto, UiAction } from './ai/failure'
import type { AiChannelKind, PresetId, PresetSummary } from './ai/preset-catalog'

export type {
  AiAccessConfigInput,
  AiAccessConfigView,
  AiDiagnosticsView,
  AiFailureClass,
  AiFailureDiagnosticDto,
  AccessStatus,
  CapabilityGapConfirmation,
  ChannelAvailability,
  ChannelBindingInput,
  ChannelBindingView,
  KeyOp,
  ValidationIssue,
  AiChannelKind,
  PresetId,
  PresetSummary,
  ChannelCapabilityGap,
  SolutionId,
  TimeoutPreferences,
  AiErrorDto,
  UiAction,
  MessageQuote
}

export interface ChannelSourceTrace {
  readonly channel: AiChannelKind
  readonly boundPresetId: PresetId
  readonly actualPresetId: PresetId | 'local'
  readonly actualName: string
  readonly result: 'success' | 'failed' | 'capability_gap' | 'not_configured'
}

export interface FailurePresentationDto {
  readonly messageKey: string
  readonly text: string
  readonly sourceLabel: string
  readonly actions: readonly UiAction[]
  readonly retryableByClick: boolean
}

export interface RetryAffordance {
  readonly available: boolean
  readonly kind: 'text' | 'media'
  readonly mediaKind?: 'image' | 'voice'
  readonly expiresAt?: number
  readonly reason?: 'media_expired' | 'no_input'
}

export const CONTRACT_VERSION = 2

export const IPC_CHANNELS = {
  bootstrap: 'app:bootstrap',
  agentSubmit: 'agent:submit',
  agentResolve: 'agent:resolve',
  agentHistory: 'agent:history',
  agentDeleteMessage: 'agent:delete-message',
  agentStream: 'event:agent-stream',
  scheduleWeek: 'schedule:week',
  scheduleDetail: 'schedule:detail',
  scheduleRecommendations: 'schedule:recommendations',
  scheduleAddRecommendation: 'schedule:add-recommendation',
  reminderRespond: 'reminder:respond',
  desktopPresence: 'desktop:presence',
  desktopHideToTray: 'desktop:hide-to-tray',
  desktopSetCloseToTray: 'desktop:set-close-to-tray',
  desktopShowMini: 'desktop:show-mini',
  desktopShowMain: 'desktop:show-main',
  reminderPresented: 'event:reminder-presented',
  expiredSummary: 'event:expired-summary',
  scheduleChanged: 'event:schedule-changed',
  extractDocument: 'input:extract-document',
  stageTempFile: 'input:stage-temp-file',
  aiConfigGet: 'ai:config-get',
  aiConfigSet: 'ai:config-set',
  aiTestConnection: 'ai:test-connection',
  aiConfigChanged: 'event:ai-config-changed',
  goalList: 'goal:list',
  goalCreate: 'goal:create',
  goalSetStatus: 'goal:set-status',
  goalDelete: 'goal:delete',
  goalRun: 'goal:run',
  goalChanged: 'event:goal-changed',
  memoryList: 'memory:list',
  memoryCreate: 'memory:create',
  memoryUpdate: 'memory:update',
  memoryDelete: 'memory:delete',
  memoryClear: 'memory:clear',
  memoryImportLegacy: 'memory:import-legacy',
  memoryChanged: 'event:memory-changed',
  careGetSettings: 'care:get-settings',
  careSetSettings: 'care:set-settings',
  careRunNow: 'care:run-now',
  careRan: 'event:care-ran'
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
  readonly aiChannelStates?: Readonly<Record<AiChannelKind, ChannelAvailability>>
  readonly aiBindings?: Readonly<Record<AiChannelKind, { readonly presetId: PresetId; readonly endpoint: string }>>
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

export interface ChatAttachment {
  readonly name: string
  readonly question?: string
}

export interface SubmitEnvelope {
  readonly attachment?: ChatAttachment
  readonly clientMessageId: string
  readonly modality: InputModality
  readonly parts: readonly InputPart[]
  readonly quotes?: readonly MessageQuote[]
  readonly memories?: readonly string[]
  readonly retryOf?: string
}

export interface ConversationMessageDto {
  readonly messageId: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly modality: InputModality
  readonly createdAt: number
  readonly status: 'parsed' | 'clarifying' | 'failed'
  readonly relatedEventId?: string
  readonly relatedGoalId?: string
  readonly sourceLabel?: string
  readonly quotes?: readonly MessageQuote[]
}

export interface GoalCheckpointDto {
  readonly at: number
  readonly progress: number
  readonly status: GoalCheckpoint['status']
  readonly summary: string
  readonly nextStep?: string
}

export interface GoalView {
  readonly goalId: string
  readonly title: string
  readonly instruction: string
  readonly cadence: GoalCadence
  readonly hour: number
  readonly minute: number
  readonly weekday: number
  readonly intervalMinutes: number
  readonly onceAt?: number
  readonly progress: number
  readonly progressNote?: string
  readonly status: GoalStatus
  readonly createdBy: GoalCreatedBy
  readonly createdAt: number
  readonly updatedAt: number
  readonly nextRunAt: number
  readonly lastRunAt?: number
  readonly lastSummary?: string
  readonly nextStep?: string
  readonly runCount: number
  readonly running: boolean
  readonly checkpoints: readonly GoalCheckpointDto[]
}

export interface GoalCreateInput {
  readonly title: string
  readonly instruction: string
  readonly cadence: GoalCadence
  readonly hour?: number
  readonly minute?: number
  readonly weekday?: number
  readonly intervalMinutes?: number
  readonly onceAt?: number
}

export interface GoalStatusRequest {
  readonly goalId: string
  readonly action: 'pause' | 'resume' | 'complete'
}

export type GoalChangeReason = 'created' | 'updated' | 'run'

export interface GoalChangeNotice {
  readonly revision: number
  readonly reason: GoalChangeReason
  readonly goal?: GoalView
  readonly message?: ConversationMessageDto
}

export interface GoalRunResult {
  readonly goal: GoalView
  readonly status: 'success' | 'failed'
  readonly source: 'ai' | 'local' | 'failed'
  readonly summary: string
}

export interface MemoryView {
  readonly memoryId: string
  readonly content: string
  readonly kind: MemoryKind
  readonly source: MemoryItem['source']
  readonly confidence: number
  readonly pinned: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export interface MemoryCreateInput {
  readonly content: string
  readonly kind?: MemoryKind
  readonly pinned?: boolean
}

export interface MemoryUpdateInput {
  readonly memoryId: string
  readonly content?: string
  readonly kind?: MemoryKind
  readonly pinned?: boolean
}

export interface MemoryChangeNotice {
  readonly revision: number
  readonly memories?: readonly MemoryView[]
}

export interface CareNotice {
  readonly kind: CareKind
  readonly at: number
  readonly message: ConversationMessageDto
}

export type CareSettingsView = CareSettings

export interface AgentAcceptedEvent {
  readonly kind: 'accepted'
  readonly clientMessageId: string
  readonly userMessage: ConversationMessageDto
}

export interface AgentProgressEvent {
  readonly kind: 'progress'
  readonly clientMessageId: string
  readonly stage: string
}

export interface AgentTurnEvent {
  readonly kind: 'turn'
  readonly clientMessageId: string
  readonly turn: ConversationTurn
}

export interface AgentFailedEvent {
  readonly kind: 'failed'
  readonly clientMessageId: string
  readonly errorText: string
}

export type AgentStreamEvent = AgentAcceptedEvent | AgentProgressEvent | AgentTurnEvent | AgentFailedEvent

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
  readonly sourceTrace?: readonly ChannelSourceTrace[]
  readonly failure?: FailurePresentationDto
  readonly retry?: RetryAffordance
  readonly retryState?: 'idle' | 'auto_retrying' | 'auto_retry_failed' | 'manual_retrying'
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

export interface DeleteMessageRequest {
  readonly messageId: string
}

export interface DeleteMessageOutcome {
  readonly messageId: string
}

export interface WeekQuery {
  readonly weekStart: number
}

export interface EventDetailQuery {
  readonly eventId: string
}

export interface ScheduleRecommendation {
  readonly id: string
  readonly title: string
  readonly reason: string
  readonly startAt: number
  readonly endAt: number
}

export interface ScheduleRecommendations {
  readonly source: 'local' | 'deepseek'
  readonly items: readonly ScheduleRecommendation[]
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
  readonly channelStates?: Readonly<Record<AiChannelKind, ChannelAvailability>>
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
    deleteMessage(request: DeleteMessageRequest): Promise<DeleteMessageOutcome>
    onStream(callback: (event: AgentStreamEvent) => void): () => void
    extractDocument(format: 'pdf' | 'docx', bytes: ArrayBuffer): Promise<string>
    stageTempFile(request: StageTempFileRequest): Promise<StageTempFileResponse>
  }
  schedule: {
    week(query: WeekQuery): Promise<WeekView>
    detail(query: EventDetailQuery): Promise<ScheduleEventDetail>
    recommendations(): Promise<ScheduleRecommendations>
    addRecommendation(query: { readonly id: string }): Promise<{ eventId: string }>
    onChanged(callback: (notice: ScheduleChangeNotice) => void): () => void
  }
  reminder: {
    respond(response: ReminderResponse): Promise<ReminderOutcome>
    onPresented(callback: (payload: ReminderPayload) => void): () => void
  }
  goal: {
    list(): Promise<GoalView[]>
    create(input: GoalCreateInput): Promise<GoalView>
    setStatus(request: GoalStatusRequest): Promise<GoalView>
    remove(query: { readonly goalId: string }): Promise<{ readonly goalId: string }>
    run(query: { readonly goalId: string }): Promise<GoalRunResult>
    onChanged(callback: (notice: GoalChangeNotice) => void): () => void
  }
  memory: {
    list(): Promise<MemoryView[]>
    create(input: MemoryCreateInput): Promise<MemoryView>
    update(input: MemoryUpdateInput): Promise<MemoryView>
    remove(query: { readonly memoryId: string }): Promise<{ readonly memoryId: string }>
    clear(): Promise<{ readonly cleared: number }>
    importLegacy(input: { readonly memories: readonly string[] }): Promise<{ readonly imported: number }>
    onChanged(callback: (notice: MemoryChangeNotice) => void): () => void
  }
  care: {
    getSettings(): Promise<CareSettingsView>
    setSettings(patch: Partial<CareSettingsView>): Promise<CareSettingsView>
    runNow(kind: CareKind): Promise<{ readonly ran: boolean }>
    onRan(callback: (notice: CareNotice) => void): () => void
  }
  desktop: {
    setPresence(state: PresenceState): Promise<void>
    hideToTray(): Promise<void>
    setCloseToTray(enabled: boolean): Promise<void>
    showMini(): Promise<void>
    showMain(): Promise<void>
  }
}

export type DayColumnDto = DayColumn
