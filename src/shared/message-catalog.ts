import { ERROR_META, type AppErrorCode } from './error-catalog'

// 简体中文文案表：与错误码集合一一对等
export const MESSAGES: Readonly<Record<string, string>> = {
  'error.entryLoadFail': '页面加载异常，请重试',
  'error.inputTooLarge': '输入超出限制（文字 ≤500 字，语音 ≤60 秒，图片 ≤10 MB）',
  'error.asrFail': '没听清，请再说一次或改用文字输入',
  'error.ocrNoText': '未从图片中识别到日程信息，可换一张或直接描述',
  'error.missingStartTime': '请告诉我这件事安排在什么时间',
  'error.timeInPast': '这个时间已经过去了，是要补记还是改到其他时间？',
  'error.aiUnavailable': '智能识别暂时不可用，请重试',
  'error.timeInconsistent': '结束时间需晚于开始时间',
  'error.conflictExists': '与已有事项《{title}》时间冲突',
  'error.duplicateEvent': '该事项已存在',
  'error.storeWriteFail': '保存失败，请检查存储空间后重试',
  'error.storeReadFail': '日程读取异常，请稍后重试',
  'error.eventNotFound': '该事项已不存在',
  'error.sessionStateMismatch': '当前操作已失效，请重新描述',
  'error.pendingExpired': '待确认的安排已失效，请重新提交',
  'error.reminderNotPending': '该提醒已处理',
  'error.notificationDenied': '通知权限未开启',
  'error.validationFailed': '请求参数有误',
  'error.presetCatalogUnavailable': '预设列表加载异常，可继续使用自定义配置',
  'error.aiEndpointInvalid': '服务地址需以 https:// 开头，请修改后保存',
  'error.configWriteFail': '配置保存失败，请检查存储空间后重试',
  'error.configReadFail': '读取配置失败，可重新填写后保存',
  'error.asrUnsupported': '当前预设不支持语音转写，可切换到 Groq 或改用文字输入',
  'error.ocrUnsupported': '当前预设不支持图片识别，可切换预设或改用文字描述',
  'error.aiChannelDisabled': '该能力已停用，可在 AI 设置中开启',
  'error.aiProviderNotConfigured': '请填写 API Key，或将该通道改为本地解析',
  'error.aiAuthFailed': 'API Key 可能已失效、被删除或权限不足，请到 AI 设置检查',
  'error.aiRateLimited': '免费额度可能已用尽或请求过于频繁，请稍后重试；也可切换到其他免费预设',
  'error.aiModelUnsupported': '当前模型不可用，请在设置中更换模型或切换预设',
  'error.aiNetworkFailed': '网络连接异常，请检查网络后重试',
  'error.aiTimeout': '智能识别响应超时，请重试',
  'ai.freeTier.groq':
    '文本、视觉、语音均含免费额度，按速率与用量限制；超额后需等待额度恢复或升级。额度与模型可用性以服务商政策为准。',
  'ai.freeTier.gemini':
    '文本与视觉含免费额度，按速率与用量限制；不支持语音转写。额度与模型可用性以服务商政策为准。',
  'ai.freeTier.glm':
    '文本与视觉提供免费模型，按速率与用量限制；不支持语音转写。额度与模型可用性以服务商政策为准。',
  'ai.freeTier.openrouter':
    '仅带 :free 后缀的模型免费，按速率与用量限制；不支持语音转写。额度与模型可用性以服务商政策为准。',
  'ai.freeTier.custom': '自定义服务是否免费取决于你使用的服务商。额度与模型可用性以服务商政策为准。',
  'ai.disclaimer': '额度与模型可用性以服务商政策为准，本应用不提供实时额度查询。'
}

export function translate(messageKey: string, params?: Readonly<Record<string, string | number>>): string {
  const template = MESSAGES[messageKey] ?? '发生未知错误'
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (raw, name: string) => {
    const value = params[name]
    return value === undefined ? raw : String(value)
  })
}

export function errorText(
  code: AppErrorCode,
  params?: Readonly<Record<string, string | number>>
): string {
  return translate(ERROR_META[code].messageKey, params)
}

export const UI_TEXT = {
  appName: 'AI 日程助手',
  homeAgent: '智能体',
  homeWeek: '周日程表',
  homeAgentHint: '用一句话、一段语音或一张图片安排事情',
  homeWeekHint: '查看周一至周日的全部安排',
  agentTitle: '智能体',
  weekTitle: '周日程表',
  weekEmpty: '本周暂无安排，去智能体安排一下吧',
  inputPlaceholder: '说说要安排什么事，例如“明天下午三点开项目周会”',
  inputHint: '支持文字、语音、图片；文字 ≤500 字，语音 ≤60 秒，图片 ≤10 MB',
  send: '发送',
  recording: '录音中',
  back: '返回',
  retry: '重试',
  settings: 'AI 设置',
  reminderTitle: '日程提醒',
  reminderRemaining: '还有 {minutes} 分钟',
  acknowledge: '知道了',
  snooze: '稍后提醒（5 分钟后）',
  ignore: '忽略',
  detailTitle: '事项详情',
  close: '关闭',
  noData: '—',
  weekdays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  aiSettingsTitle: 'AI 设置',
  aiSave: '保存',
  aiCancel: '取消',
  aiClose: '关闭',
  aiRestoreRecommended: '恢复推荐组合',
  aiClearConfig: '清除配置',
  aiTestConnection: '检查配置',
  aiAdvancedEdit: '高级编辑',
  aiKeyClear: '清除 Key',
  aiLocalParsing: '本地解析',
  aiStatusLocal: '本地解析模式',
  aiStatusFreeRecommended: 'AI 已接入（免费推荐方案）',
  aiStatusCustom: 'AI 已接入（自定义）',
  aiTextChannel: '文本理解',
  aiVisionChannel: '视觉识别',
  aiAsrChannel: '语音转写',
  aiFreeBadge: '免费',
  aiFreeRecommendedBadge: '免费推荐',
  aiKeyPlaceholder: '留空表示沿用已保存的 Key',
  aiKeySavedPrefix: '已保存：',
  aiUnsupported: '当前预设不支持该能力',
  aiNotConfigured: '未配置 Key',
  aiDisabled: '已停用',
  aiAvailable: '可用',
  aiDirtyConfirm: '有未保存的更改，确定放弃？',
  aiConfigLoadError: '读取配置失败，可重新填写后保存',
  aiLocalHint: '文本通道使用本地规则解析，不调用外部服务',
  aiAdvancedHint: '修改端点或模型后，可能不再享受该预设的免费额度'
} as const