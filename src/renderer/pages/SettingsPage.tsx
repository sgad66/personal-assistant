import React, { useEffect, useState } from 'react'
import type { MemoryKind } from '@shared/domain/types'
import { useAppStore } from '../stores/app-store'
import { usePreferencesStore } from '../stores/preferences-store'
import { useNavigationStore } from '../stores/navigation-store'
import { useMemoryStore } from '../stores/memory-store'
import { aiStatusLabel } from '../ui-text'
import Icon from '../components/Icon'

const KIND_LABELS: Readonly<Record<MemoryKind, string>> = {
  profile: '个人信息',
  preference: '偏好',
  habit: '习惯',
  fact: '事实',
  relation: '关系',
  commitment: '承诺'
}

const KIND_OPTIONS: readonly MemoryKind[] = [
  'preference',
  'profile',
  'habit',
  'fact',
  'relation',
  'commitment'
]


interface SettingsPageProps {
  readonly onOpenAiSettings: () => void
}

export default function SettingsPage({ onOpenAiSettings }: SettingsPageProps): React.ReactElement {
  const theme = usePreferencesStore((state) => state.theme)
  const toggleTheme = usePreferencesStore((state) => state.toggleTheme)
  const closeToTray = usePreferencesStore((state) => state.closeToTray)
  const setCloseToTray = usePreferencesStore((state) => state.setCloseToTray)
  const memories = useMemoryStore((state) => state.items)
  const memoryLoading = useMemoryStore((state) => state.loading)
  const memoryError = useMemoryStore((state) => state.error)
  const initMemory = useMemoryStore((state) => state.init)
  const addMemory = useMemoryStore((state) => state.add)
  const updateMemory = useMemoryStore((state) => state.update)
  const removeMemory = useMemoryStore((state) => state.remove)
  const clearMemory = useMemoryStore((state) => state.clear)
  const aiStatus = useAppStore((state) => state.home?.aiStatus ?? 'local')
  const navigate = useNavigationStore((state) => state.navigate)
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<MemoryKind>('preference')
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    void initMemory()
  }, [initMemory])

  useEffect(() => {
    if (!confirmClear) return undefined
    const timer = window.setTimeout(() => setConfirmClear(false), 3_500)
    return () => window.clearTimeout(timer)
  }, [confirmClear])

  const submitMemory = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (draft.trim().length === 0) return
    const ok = await addMemory({ content: draft.trim(), kind })
    if (ok) setDraft('')
  }

  const handleClear = async (): Promise<void> => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setConfirmClear(false)
    await clearMemory()
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
            <Toggle on={theme === 'dark'} label="切换深色模式" onClick={toggleTheme} />
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>关闭窗口时最小化到托盘</strong>
              <p>关闭后仍可按时收到提醒，从托盘随时唤回。</p>
            </div>
            <Toggle on={closeToTray} label="切换关闭到托盘" onClick={() => setCloseToTray(!closeToTray)} />
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-head">
            <h2>长期记忆</h2>
            <p>
              助理会从对话中自动学习你的偏好、习惯和承诺，也会在每次提问时按需带上相关记忆。
              记忆只作参考，不会被执行成指令。
            </p>
          </header>
          <form className="memory-form memory-form-rich" onSubmit={(event) => void submitMemory(event)}>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as MemoryKind)}
              aria-label="记忆类型"
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {KIND_LABELS[option]}
                </option>
              ))}
            </select>
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
          {memoryError && <p className="settings-note is-danger">{memoryError}</p>}
          {memories.length === 0 && !memoryLoading ? (
            <p className="settings-empty">还没有记忆。对话中出现明确偏好时，助理会自动记下。</p>
          ) : (
            <>
              <ul className="memory-list">
                {memories.map((memory) => (
                  <li key={memory.memoryId}>
                    <div className="memory-entry">
                      <span className={`memory-kind kind-${memory.kind}`}>{KIND_LABELS[memory.kind]}</span>
                      <span className="memory-content">{memory.content}</span>
                      <span className="memory-source">
                        {memory.source === 'auto'
                          ? '自动学习'
                          : memory.source === 'ai'
                            ? '模型学习'
                            : memory.source === 'legacy'
                              ? '已迁移'
                              : '手动添加'}
                      </span>
                    </div>
                    <div className="memory-actions">
                      <button
                        type="button"
                        className={memory.pinned ? 'is-active' : ''}
                        aria-label={memory.pinned ? '取消置顶' : '置顶记忆'}
                        onClick={() => void updateMemory({ memoryId: memory.memoryId, pinned: !memory.pinned })}
                      >
                        <Icon name="pin" size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="删除记忆"
                        onClick={() => void removeMemory(memory.memoryId)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-quiet btn-sm memory-clear" onClick={() => void handleClear()}>
                {confirmClear ? '确认清空全部记忆' : '全部清空'}
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
            <h2>目标与定时跟进</h2>
            <p>你可以让助理按每天、每周或固定间隔回来检查进度；它也会在对话里根据需要建立跟进目标。</p>
          </header>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>定时跟进</strong>
              <p>目标到点后，助理会自动写一条进度汇报到对话里，也可以手动立即跟进。</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('goals')}>
              打开目标
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
            对话摘要、记忆与回顾记录同样只保存在本机。
          </p>
        </section>
      </div>
    </main>
  )
}

function Toggle({
  on,
  label,
  onClick
}: {
  readonly on: boolean
  readonly label: string
  readonly onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`switch ${on ? 'is-on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
    >
      <span />
    </button>
  )
}
