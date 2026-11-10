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
  type BootstrapRequest,
  type ConversationMessageDto,
  type ConversationTurn,
  type EventDetailQuery,
  type ExpiredSummary,
  type HistoryQuery,
  type HomeState,
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
    stageTempFile: (request: StageTempFileRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.stageTempFile, request) as Promise<StageTempFileResponse>
  },
  schedule: {
    week: (query: WeekQuery) => ipcRenderer.invoke(IPC_CHANNELS.scheduleWeek, query) as Promise<WeekView>,
    detail: (query: EventDetailQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.scheduleDetail, query) as Promise<ScheduleEventDetail>,
    onChanged: (callback: (notice: ScheduleChangeNotice) => void) =>
      subscribe<ScheduleChangeNotice>(IPC_CHANNELS.scheduleChanged, callback)
  },
  reminder: {
    respond: (response: ReminderResponse) =>
      ipcRenderer.invoke(IPC_CHANNELS.reminderRespond, response) as Promise<ReminderOutcome>,
    onPresented: (callback: (payload: ReminderPayload) => void) =>
      subscribe<ReminderPayload>(IPC_CHANNELS.reminderPresented, callback)
  },
  desktop: {
    setPresence: (state: PresenceState) =>
      ipcRenderer.invoke(IPC_CHANNELS.desktopPresence, state) as Promise<void>
  }
}

contextBridge.exposeInMainWorld('pa', api)
contextBridge.exposeInMainWorld('paContractVersion', CONTRACT_VERSION)