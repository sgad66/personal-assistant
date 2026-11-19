import { contextBridge, ipcRenderer } from 'electron'
import {
  CONTRACT_VERSION,
  IPC_CHANNELS,
  type AiAccessConfigInput,

  type AiConfigChangedNotice,
  type AiConfigInput,
  type AiConfigLoadOutcome,
  type AiConfigSaveOutcome,
  type AiConnectionTestRequest,
  type AiConnectionTestResult,
  type AgentStreamEvent,
  type BootstrapRequest,
  type CareNotice,
  type CareSettingsView,
  type ConversationMessageDto,
  type ConversationTurn,
  type EventDetailQuery,
  type ExpiredSummary,
  type GoalChangeNotice,
  type GoalCreateInput,
  type GoalRunResult,
  type GoalStatusRequest,
  type GoalView,
  type HistoryQuery,
  type HomeState,
  type MemoryChangeNotice,
  type MemoryCreateInput,
  type MemoryUpdateInput,
  type MemoryView,
  type PaBridge,
  type PresenceState,
  type ReminderOutcome,
  type ReminderPayload,
  type ReminderResponse,
  type ResolutionCommand,
  type ScheduleChangeNotice,
  type StageTempFileRequest,
  type StageTempFileResponse,
  type SubmitEnvelope,
  type WeekQuery
} from '@shared/ipc-contracts'
import type { ScheduleEventDetail, WeekView } from '@shared/domain/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: PaBridge = {
  app: {
    bootstrap: (request: BootstrapRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.bootstrap, request) as Promise<HomeState>,
    onExpiredSummary: (callback: (payload: ExpiredSummary) => void) =>
      subscribe<ExpiredSummary>(IPC_CHANNELS.expiredSummary, callback),
    getAiConfig: () =>
      ipcRenderer.invoke(IPC_CHANNELS.aiConfigGet) as Promise<AiConfigLoadOutcome>,
    setAiConfig: (input: AiAccessConfigInput | AiConfigInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.aiConfigSet, input) as Promise<AiConfigSaveOutcome>,
    testConnection: (request: AiConnectionTestRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.aiTestConnection, request) as Promise<AiConnectionTestResult>,
    onAiConfigChanged: (callback: (notice: AiConfigChangedNotice) => void) =>
      subscribe<AiConfigChangedNotice>(IPC_CHANNELS.aiConfigChanged, callback)
  },
  agent: {
    submit: (envelope: SubmitEnvelope) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentSubmit, envelope) as Promise<ConversationTurn>,
    resolve: (command: ResolutionCommand) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentResolve, command) as Promise<ConversationTurn>,
    history: (query: HistoryQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentHistory, query) as Promise<ConversationMessageDto[]>,
    onStream: (callback: (event: AgentStreamEvent) => void) =>
      subscribe<AgentStreamEvent>(IPC_CHANNELS.agentStream, callback),
    extractDocument: (format, bytes) => ipcRenderer.invoke(IPC_CHANNELS.extractDocument, format, bytes),
    stageTempFile: (request: StageTempFileRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.stageTempFile, request) as Promise<StageTempFileResponse>
  },
  schedule: {
    week: (query: WeekQuery) => ipcRenderer.invoke(IPC_CHANNELS.scheduleWeek, query) as Promise<WeekView>,
    detail: (query: EventDetailQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.scheduleDetail, query) as Promise<ScheduleEventDetail>,
    recommendations: () => ipcRenderer.invoke(IPC_CHANNELS.scheduleRecommendations),
    addRecommendation: (query) => ipcRenderer.invoke(IPC_CHANNELS.scheduleAddRecommendation, query),
    onChanged: (callback: (notice: ScheduleChangeNotice) => void) =>
      subscribe<ScheduleChangeNotice>(IPC_CHANNELS.scheduleChanged, callback)
  },
  reminder: {
    respond: (response: ReminderResponse) =>
      ipcRenderer.invoke(IPC_CHANNELS.reminderRespond, response) as Promise<ReminderOutcome>,
    onPresented: (callback: (payload: ReminderPayload) => void) =>
      subscribe<ReminderPayload>(IPC_CHANNELS.reminderPresented, callback)
  },
  goal: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.goalList) as Promise<GoalView[]>,
    create: (input: GoalCreateInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.goalCreate, input) as Promise<GoalView>,
    setStatus: (request: GoalStatusRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.goalSetStatus, request) as Promise<GoalView>,
    remove: (query: { readonly goalId: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.goalDelete, query) as Promise<{ readonly goalId: string }>,
    run: (query: { readonly goalId: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.goalRun, query) as Promise<GoalRunResult>,
    onChanged: (callback: (notice: GoalChangeNotice) => void) =>
      subscribe<GoalChangeNotice>(IPC_CHANNELS.goalChanged, callback)
  },
  memory: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.memoryList) as Promise<MemoryView[]>,
    create: (input: MemoryCreateInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryCreate, input) as Promise<MemoryView>,
    update: (input: MemoryUpdateInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryUpdate, input) as Promise<MemoryView>,
    remove: (query: { readonly memoryId: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryDelete, query) as Promise<{ readonly memoryId: string }>,
    clear: () =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryClear) as Promise<{ readonly cleared: number }>,
    importLegacy: (input: { readonly memories: readonly string[] }) =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryImportLegacy, input) as Promise<{ readonly imported: number }>,
    onChanged: (callback: (notice: MemoryChangeNotice) => void) =>
      subscribe<MemoryChangeNotice>(IPC_CHANNELS.memoryChanged, callback)
  },
  care: {
    getSettings: () =>
      ipcRenderer.invoke(IPC_CHANNELS.careGetSettings) as Promise<CareSettingsView>,
    setSettings: (patch: Partial<CareSettingsView>) =>
      ipcRenderer.invoke(IPC_CHANNELS.careSetSettings, patch) as Promise<CareSettingsView>,
    runNow: (kind: CareNotice['kind']) =>
      ipcRenderer.invoke(IPC_CHANNELS.careRunNow, kind) as Promise<{ readonly ran: boolean }>,
    onRan: (callback: (notice: CareNotice) => void) =>
      subscribe<CareNotice>(IPC_CHANNELS.careRan, callback)
  },
  desktop: {
    setPresence: (state: PresenceState) =>
      ipcRenderer.invoke(IPC_CHANNELS.desktopPresence, state) as Promise<void>,
    hideToTray: () => ipcRenderer.invoke(IPC_CHANNELS.desktopHideToTray) as Promise<void>,
    setCloseToTray: (enabled: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.desktopSetCloseToTray, enabled) as Promise<void>,
    showMini: () => ipcRenderer.invoke(IPC_CHANNELS.desktopShowMini) as Promise<void>,
    showMain: () => ipcRenderer.invoke(IPC_CHANNELS.desktopShowMain) as Promise<void>
  }
}

contextBridge.exposeInMainWorld('pa', api)
contextBridge.exposeInMainWorld('paContractVersion', CONTRACT_VERSION)
