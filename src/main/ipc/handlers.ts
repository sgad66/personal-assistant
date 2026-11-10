import { ipcMain, Notification } from 'electron'
import type {

  AiConnectionTestRequest,
  BootstrapRequest,
  ConversationTurn,
  EventDetailQuery,
  HistoryQuery,
  PresenceState,
  ReminderResponse,
  StageTempFileRequest,
  SubmitEnvelope,
  WeekQuery
} from '@shared/ipc-contracts'
import { CONTRACT_VERSION, IPC_CHANNELS } from '@shared/ipc-contracts'
import {
  eventDetailQuerySchema,
  reminderResponseSchema,
  resolutionCommandSchema,
  stageTempFileSchema,
  submitEnvelopeSchema,
  weekQuerySchema
} from '@shared/schemas'
import { getWeekStart } from '@shared/time-kit'
import type { AppContext } from '../app-context'

function throwWith(message: string): never {
  throw new Error(message)
}

export function registerIpcHandlers(ctx: AppContext): void {
  const presence: { value: PresenceState } = { value: 'foreground' }

  ipcMain.handle(IPC_CHANNELS.bootstrap, async (_event, request: BootstrapRequest) => {
    if (ctx.store.loadFailed) {
      throwWith('日程读取异常，请稍后重试')
    }
    const requested =
      typeof request === 'object' && request !== null ? Number(request.contractVersion) : CONTRACT_VERSION
    const active = ctx.scheduleService.getWeek(getWeekStart(ctx.clock()))
    const count = active.ok ? active.data.totalCount : 0
    return {
      contractVersion: Math.min(requested || CONTRACT_VERSION, CONTRACT_VERSION),
      currentWeekStart: getWeekStart(ctx.clock()),
      timeZone: ctx.timeZone,
      activeEventCount: count,
      notificationPermission: Notification.isSupported() ? 'granted' : 'denied',
      aiConfigured: ctx.aiStatus() !== 'local',
      aiStatus: ctx.aiStatus()
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentSubmit, async (_event, envelope: SubmitEnvelope): Promise<ConversationTurn> => {
    const parsed = submitEnvelopeSchema.safeParse(envelope)
    if (!parsed.success) throwWith('请求参数有误')
    const result = await ctx.conversation.submit(parsed.data)
    if (!result.ok) throwWith('请求参数有误')
    return result.data
  })

  ipcMain.handle(IPC_CHANNELS.agentResolve, async (_event, command: unknown): Promise<ConversationTurn> => {
    const parsed = resolutionCommandSchema.safeParse(command)
    if (!parsed.success) throwWith('请求参数有误')
    const result = await ctx.conversation.resolve(parsed.data)
    if (!result.ok) throwWith('请求参数有误')
    return result.data
  })

  ipcMain.handle(IPC_CHANNELS.agentHistory, async (_event, query: HistoryQuery) => {
    const limit = typeof query?.limit === 'number' ? Math.max(1, Math.min(500, query.limit)) : 200
    return ctx.conversation.history(limit)
  })

  ipcMain.handle(IPC_CHANNELS.scheduleWeek, async (_event, query: WeekQuery) => {
    const parsed = weekQuerySchema.safeParse(query)
    if (!parsed.success) throwWith('请求参数有误')
    const result = ctx.scheduleService.getWeek(parsed.data.weekStart)
    if (!result.ok) throwWith('日程读取异常，请稍后重试')
    return result.data
  })

  ipcMain.handle(IPC_CHANNELS.scheduleDetail, async (_event, query: EventDetailQuery) => {
    const parsed = eventDetailQuerySchema.safeParse(query)
    if (!parsed.success) throwWith('请求参数有误')
    const result = ctx.scheduleService.getDetail(parsed.data.eventId)
    if (!result.ok) throwWith('该事项已不存在')
    return result.data
  })

  ipcMain.handle(IPC_CHANNELS.reminderRespond, async (_event, response: ReminderResponse) => {
    const parsed = reminderResponseSchema.safeParse(response)
    if (!parsed.success) throwWith('请求参数有误')
    const result = ctx.scheduler.handleResponse(parsed.data)
    if (!result.ok) throwWith('该提醒已处理')
    return result.data
  })

  ipcMain.handle(IPC_CHANNELS.desktopPresence, async (_event, state: PresenceState) => {
    presence.value = state === 'background' ? 'background' : 'foreground'
    return undefined
  })

  ipcMain.handle(IPC_CHANNELS.aiConfigGet, async () => ctx.loadAiConfig())

  ipcMain.handle(IPC_CHANNELS.aiConfigSet, async (_event, input: unknown) => ctx.saveAiConfig(input))

  ipcMain.handle(IPC_CHANNELS.aiTestConnection, async (_event, request: AiConnectionTestRequest) =>
    ctx.testAiConnection(request)
  )

  ipcMain.handle(IPC_CHANNELS.stageTempFile, async (_event, request: StageTempFileRequest) => {
    const parsed = stageTempFileSchema.safeParse(request)
    if (!parsed.success) throwWith('请求参数有误')
    const isImage = parsed.data.mimeType.startsWith('image/')
    const isAudio = parsed.data.mimeType.startsWith('audio/')
    if (!isImage && !isAudio) throwWith('请求参数有误')
    const kind = isImage ? 'image' : 'voice'
    const bytes = new Uint8Array(parsed.data.bytes)
    if (isImage && bytes.byteLength > 10 * 1024 * 1024) throwWith('输入超出限制')
    try {
      const tempFilePath = ctx.tempFiles.stageBytes(parsed.data.fileName, bytes, kind)
      return { tempFilePath }
    } catch {
      throwWith('保存失败，请检查存储空间后重试')
    }
  })

  void presence
}