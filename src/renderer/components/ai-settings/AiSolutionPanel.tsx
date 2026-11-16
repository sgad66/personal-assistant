import React from 'react'
import { translate } from '@shared/message-catalog'
import { useAiSettingsStore } from '../../stores/ai-settings-store'
import Icon from '../Icon'

export default function AiSolutionPanel(): React.ReactElement {
  const saving = useAiSettingsStore((state) => state.saving)
  const status = useAiSettingsStore((state) => state.view?.status)
  const applyDeepSeekSolution = useAiSettingsStore((state) => state.applyDeepSeekSolution)
  const applyGroqFree = useAiSettingsStore((state) => state.applyGroqFree)
  const requestStrict = useAiSettingsStore((state) => state.requestStrict)
  const restoreDefault = useAiSettingsStore((state) => state.restoreDefault)

  return (
    <section className="solution-panel" aria-label="接入方案">
      <header className="solution-head">
        <div>
          <span className="eyebrow">AI 方案</span>
          <h3>选择接入方案</h3>
        </div>
        <span className="solution-badge">基于 DeepSeek 官方 API</span>
      </header>

      <ul className="solution-notes">
        <li>DeepSeek 官方 API 只提供文字能力。</li>
        <li>图片与语音需要具备相应能力的服务。</li>
        <li>当前由 Groq 承接；可更换服务，或改为严格模式。</li>
      </ul>

      <div className="solution-grid">
        <div className="solution-option">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={applyDeepSeekSolution}
            disabled={saving}
          >
            <Icon name="spark" size={14} />
            {translate('ai.solution.deepseekDefault')}
          </button>
          <p>{translate('ai.solution.deepseekKeys')}</p>
        </div>

        <div className="solution-option">
          <button type="button" className="btn btn-quiet btn-sm" onClick={applyGroqFree} disabled={saving}>
            {translate('ai.solution.groqFree')}
          </button>
          <p>{translate('ai.solution.groqKeys')}</p>
        </div>

        <div className="solution-option">
          <button type="button" className="btn btn-quiet btn-sm" onClick={requestStrict} disabled={saving}>
            {translate('ai.solution.strict')}
          </button>
          <p>只需 DeepSeek Key；图片与语音将停用，确认后生效</p>
        </div>

        <div className="solution-option">
          <button type="button" className="btn btn-ghost btn-sm" onClick={restoreDefault} disabled={saving}>
            {translate('ai.solution.restoreDefault')}
          </button>
          <p>恢复为 DeepSeek 默认方案，已保存的 Key 不会被清除</p>
        </div>
      </div>

<p className="solution-disclaimer">
        <Icon name="alert" size={13} />
        {translate('ai.solution.notice')}
      </p>

      {status === 'deepseek_text_only' && (
        <div className="solution-exit">
          <p>当前处于严格模式：图片与语音不可用，文字解析正常。</p>
          <button type="button" className="btn btn-quiet btn-sm" onClick={applyDeepSeekSolution} disabled={saving}>
            {translate('ai.strict.exit')}
          </button>
        </div>
      )}
    </section>
  )
}