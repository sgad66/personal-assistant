import type { AccessStatus } from '@shared/ipc-contracts'
import { UI_TEXT } from '@shared/message-catalog'

const WEEKDAY_LONG = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const
const WEEKDAY_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function aiStatusLabel(status: AccessStatus): string {
  if (status === 'free_recommended') return UI_TEXT.aiStatusFreeRecommended
  if (status === 'custom') return UI_TEXT.aiStatusCustom
  if (status === 'deepseek_solution') return UI_TEXT.aiStatusDeepseekSolution
  if (status === 'deepseek_text_only') return UI_TEXT.aiStatusDeepseekTextOnly
  if (status !== 'local') return UI_TEXT.aiStatusOnlineUnknown
  return UI_TEXT.aiStatusLocal
}

export function aiStatusShortLabel(status: AccessStatus): string {
  if (status === 'free_recommended') return '免费 AI'
  if (status === 'custom') return '自定义 AI'
  if (status === 'deepseek_solution') return 'DeepSeek'
  if (status === 'deepseek_text_only') return '仅文字'
  if (status !== 'local') return 'AI 已接入'
  return '本地解析'
}

export function greetingOf(now: number): string {
  const hour = new Date(now).getHours()
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function weekdayLong(ts: number): string {
  return WEEKDAY_LONG[new Date(ts).getDay()]
}

export function weekdayShort(ts: number): string {
  return WEEKDAY_SHORT[new Date(ts).getDay()]
}

export function monthLabel(ts: number): string {
  return `${new Date(ts).getMonth() + 1}月`
}

export function dayNumber(ts: number): string {
  return String(new Date(ts).getDate()).padStart(2, '0')
}

export function yearLabel(ts: number): string {
  return `${new Date(ts).getFullYear()}`
}