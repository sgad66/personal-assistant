import React, { useState } from 'react'
import { useAppStore } from '../stores/app-store'
import { usePreferencesStore } from '../stores/preferences-store'
import { aiStatusLabel } from '../ui-text'
import Icon from '../components/Icon'

interface SettingsPageProps {
  readonly onOpenAiSettings: () => void
}

export default function SettingsPage({ onOpenAiSettings }: SettingsPageProps): React.ReactElement {
  const theme = usePreferencesStore((state) => state.theme)
  const toggleTheme = usePreferencesStore((state) => state.toggleTheme)
  const closeToTray = usePreferencesStore((state) => state.closeToTray)
  const setCloseToTray = usePreferencesStore((state) => state.setCloseToTray)
  const memories = usePreferencesStore((state) => state.memories)
  const addMemory = usePreferencesStore((state) => state.addMemory)
  const removeMemory = usePreferencesStore((state) => state.removeMemory)
  const clearMemories = usePreferencesStore((state) => state.clearMemories)
  const aiStatus = useAppStore((state) => state.home?.aiStatus ?? 'local')
  const [draft, setDraft] = useState('')

  const submitMemory = (event: React.FormEvent): void => {
    event.preventDefault()
    if (addMemory(draft)) setDraft('')
  }

  return (
    <main className="page settings-page">
      <header className="page-top">
        <div className="page-top-copy">
          <span className="eyebrow">SETTINGS</span>
          <h1>设置</h1>
          <p>偏好、记忆和连接，都在这里慢慢调成适合你的样子。</p>
        </div>
        <div className="page-top-actions">
          <button type="button" className="btn btn-quiet" onClick={onOpenAiSettings}>
            <Icon name="settings" size={17} />
            连接设置
          </button>
        </div>
      </header>

      <div className="settings-scroll">
        <section className="settings-card">
          <header className="settings-head">
            <h2>偏好</h2>
            <p>影响每天打开应用时的默认状态。</p>
          </header>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>深色模式</strong>
              <p>夜间使用更柔和，配色与浅色模式一一对应。</p>
            </div>
            <button
              type="button"
              className={`switch ${theme === 'dark' ? 'is-on' : ''}`}
              aria-pressed={theme === 'dark'}
              aria-label="切换深色模式"
              onClick={toggleTheme}
            >
              <span />
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>关闭窗口时最小化到托盘</strong>
              <p>关闭后仍可按时收到提醒，从托盘随时唤回。</p>
            </div>
            <button
              type="button"
              className={`switch ${closeToTray ? 'is-on' : ''}`}
              aria-pressed={closeToTray}
              aria-label="切换关闭到托盘"
              onClick={() => setCloseToTray(!closeToTray)}
            >
              <span />
            </button>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-head">
            <h2>记忆</h2>
            <p>写下的内容会作为对话上下文，帮助我理解你的习惯。</p>
          </header>
          <form className="memory-form" onSubmit={submitMemory}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={200}
              placeholder="例如：会议尽量安排在工作日上午"
              aria-label="新增记忆"
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={draft.trim().length === 0}>
              添加
            </button>
          </form>
          {memories.length === 0 ? (
            <p className="settings-empty">还没有记忆。添加一两条，之后提问会自动带上。</p>
          ) : (
            <>
              <ul className="memory-list">
                {memories.map((memory) => (
                  <li key={memory}>
                    <span>{memory}</span>
                    <button type="button" aria-label="删除记忆" onClick={() => removeMemory(memory)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-quiet btn-sm memory-clear" onClick={clearMemories}>
                全部清空
              </button>
            </>
          )}
        </section>

        <section className="settings-card">
          <header className="settings-head">
            <h2>连接与密钥</h2>
            <p>文字、图片、语音可以分别接入不同的服务商。</p>
          </header>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{aiStatusLabel(aiStatus)}</strong>
              <p>没有配置时，日程解析使用本机规则，不会联网。</p>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={onOpenAiSettings}>
              管理连接
            </button>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-head">
            <h2>数据与隐私</h2>
            <p>日程、记忆与布局都保存在本机用户数据目录。</p>
          </header>
          <p className="settings-note">
            语音与图片只在解析时临时使用；没有配置 AI 服务时，除本地规则解析外不会联网。
          </p>
        </section>
      </div>
    </main>
  )
}