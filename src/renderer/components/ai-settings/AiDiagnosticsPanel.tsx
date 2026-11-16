import React from 'react'
import type { AiDiagnosticsView } from '@shared/ipc-contracts'
import { translate } from '@shared/message-catalog'
import Icon from '../Icon'

interface AiDiagnosticsPanelProps {
  readonly diagnostics?: AiDiagnosticsView
  readonly onBackToAgent?: () => void
}

const STAGE_LABEL: Readonly<Record<string, string>> = {
  connect_first_byte: '等待首包',
  body_transfer: '接收响应',
  result_parse: '解析结果',
  local_check: '本地校验'
}

const FAILURE_LABEL: Readonly<Record<string, string>> = {
  timeout: '超时',
  network: '无法连接',
  unauthorized: '鉴权失败',
  rate_limited: '额度或频率受限',
  model_unavailable: '模型不可用',
  unparsable: '响应无法解析',
  service_error: '服务异常',
  not_configured: '未配置'
}

export default function AiDiagnosticsPanel({
  diagnostics,
  onBackToAgent
}: AiDiagnosticsPanelProps): React.ReactElement {
  const records = diagnostics?.records ?? []
  return (
    <details className="diagnostics-panel">
      <summary>
        <Icon name="alert" size={14} />
        {translate('ai.diagnostics.title')}
        <span className="diagnostics-count">{records.length}</span>
      </summary>

      {diagnostics?.readError && (
        <p className="diagnostics-read-failed">{translate('ai.diagnostics.readFailed')}</p>
      )}

      {records.length === 0 ? (
        <p className="diagnostics-empty">{translate('ai.diagnostics.empty')}</p>
      ) : (
        <ul className="diagnostics-list">
          {records
            .slice()
            .reverse()
            .map((record, index) => (
              <li key={`${record.at}-${record.channel}-${index}`} className="diagnostics-row">
                <span className="diagnostics-time">{formatAt(record.at)}</span>
                <span>{channelName(record.channel)}</span>
                <span className="diagnostics-source">
                  绑定 {record.boundPresetName} · 实际 {record.sourceName}
                </span>
                <span>{STAGE_LABEL[record.stage] ?? record.stage}</span>
                <span>{FAILURE_LABEL[record.failureClass] ?? record.failureClass}</span>
                <span>{Math.max(0, Math.round(record.durationMs / 1000))} 秒</span>
                <span>{record.autoRetried ? `自动重试 ${record.retryCount} 次` : '未重试'}</span>
              </li>
            ))}
        </ul>
      )}

      <p className="diagnostics-hint">{translate('ai.diagnostics.hint')}</p>
      {onBackToAgent && (
        <button type="button" className="btn btn-quiet btn-sm" onClick={onBackToAgent}>
          回到智能体
        </button>
      )}
    </details>
  )
}

function channelName(channel: string): string {
  if (channel === 'vision') return '图片识别'
  if (channel === 'asr') return '语音转写'
  return '文字理解'
}

function formatAt(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}