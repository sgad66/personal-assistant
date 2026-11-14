import React, { useEffect, useState } from 'react'
import type { AccessStatus } from '@shared/ipc-contracts'
import type { DayColumn, WeekView } from '@shared/domain/types'
import {
  ALL_WIDGET_IDS,
  DEFAULT_WIDGET_LAYOUT,
  LAYOUT_PRESETS,
  WIDGET_META,
  addWidget,
  layoutIds,
  moveWidget,
  parseWidgetLayout,
  removeWidget,
  serializeWidgetLayout,

  setWidgetSpan,
  type WidgetId,
  type WidgetLayoutItem
} from '../../home-layout'
import { renderHomeWidget, type WidgetContext } from './widgets'
import Icon from '../Icon'

interface HomeDashboardProps {
  readonly days: readonly DayColumn[]
  readonly week?: WeekView
  readonly today?: DayColumn
  readonly now: number
  readonly aiStatus: AccessStatus
  readonly openDetail: (eventId: string) => void
  readonly prompt: (text: string) => void
  readonly openWeek: () => void
  readonly openSettings: () => void
}

const LAYOUT_KEY = 'pa-home-widgets-v2'

export default function HomeDashboard({
  days,
  week,
  today,
  now,
  aiStatus,
  openDetail,
  prompt,
  openWeek,
  openSettings
}: HomeDashboardProps): React.ReactElement {
  const [layout, setLayout] = useState<WidgetLayoutItem[]>(() =>
    parseWidgetLayout(localStorage.getItem(LAYOUT_KEY))
  )
  const [editing, setEditing] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [dragging, setDragging] = useState<WidgetId | null>(null)
  const [dropTarget, setDropTarget] = useState<WidgetId | null>(null)

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, serializeWidgetLayout(layout))
  }, [layout])

  const activeIds = layoutIds(layout)
  const hidden = ALL_WIDGET_IDS.filter((id) => !activeIds.includes(id))
  const context: WidgetContext = {
    days,
    week,
    today,
    now,
    aiStatus,
    openDetail,
    prompt,
    openWeek,
    openSettings
  }

  const move = (id: WidgetId, delta: number): void => {
    setLayout((current) => moveWidget(current, id, delta))
  }

  const changeSpan = (id: WidgetId, span: 1 | 2): void => {
    setLayout((current) => setWidgetSpan(current, id, span))
  }


  const hide = (id: WidgetId): void => {
    setLayout((current) => removeWidget(current, id))
  }

  const add = (id: WidgetId): void => {
    setLayout((current) => addWidget(current, id))
  }

  const toggleEditing = (): void => {
    setEditing((value) => !value)
    setShowLibrary(false)
  }

  const onDragStart = (event: React.DragEvent, id: WidgetId): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    setDragging(id)
  }

  const dropOn = (target: WidgetId): void => {
    if (!dragging || dragging === target) {
      setDragging(null)
      setDropTarget(null)
      return
    }
    setLayout((current) => {
      const from = current.findIndex((item) => item.id === dragging)
      const to = current.findIndex((item) => item.id === target)
      if (from === -1 || to === -1) return current
      const next = [...current]
      const [item] = next.splice(from, 1)
      if (item) next.splice(to, 0, item)
      return next
    })
    setDragging(null)
    setDropTarget(null)
  }

  return (
    <section className="board">
      <header className="board-toolbar">
        <div className="board-title">
          <span className="eyebrow">BOARD</span>
          <h2>我的看板</h2>
          <p>
            {layout.length} 个组件 · 可选预设，也可自由拖拽、调整宽度，布局保存在本机
          </p>
        </div>
        <div className="board-actions">
          {editing && (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => setLayout(DEFAULT_WIDGET_LAYOUT.map((item) => ({ ...item })))}
            >
              恢复默认
            </button>
          )}
          {editing && (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => setShowLibrary((value) => !value)}
            >
              <Icon name="plus" size={14} />
              添加组件{hidden.length > 0 ? ` · 还有 ${hidden.length} 个` : ''}
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${editing ? 'btn-primary' : 'btn-ghost'}`}
            onClick={toggleEditing}
          >
            <Icon name={editing ? 'check' : 'settings'} size={15} />
            {editing ? '完成' : '自定义'}
          </button>
        </div>
      </header>

      {editing && (
        <div className="layout-presets">
          <span className="preset-label">预设布局</span>
          {LAYOUT_PRESETS.map((preset) => {
            const active = serializeWidgetLayout(layout) === serializeWidgetLayout(preset.items)
            return (
              <button
                key={preset.id}
                type="button"
                className={`preset-chip ${active ? 'is-active' : ''}`}
                title={preset.description}
                onClick={() => setLayout(preset.items.map((item) => ({ ...item })))}
              >
                {preset.name}
              </button>
            )
          })}
        </div>
      )}

      {editing && showLibrary && (
        <section className="widget-library">
          <header className="library-head">
            <div>
              <span className="eyebrow">WIDGET LIBRARY</span>
              <h3>添加组件</h3>
            </div>
            <div className="library-head-actions">
              <span className="panel-count">{hidden.length} 个可用</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowLibrary(false)}
                aria-label="关闭组件库"
                title="关闭"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          </header>
          {hidden.length === 0 ? (
            <p className="library-empty">所有组件都已添加。拖动卡片左侧手柄调整顺序，或隐藏不需要的组件。</p>
          ) : (
            <div className="library-grid">
              {hidden.map((id) => {
                const meta = WIDGET_META[id]
                return (
                  <article key={id} className="library-card">
                    <div className="library-card-head">
                      <strong>{meta.title}</strong>
                      <span className="library-tag">{meta.group}</span>
                    </div>
                    <p>{meta.description}</p>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => add(id)}>
                      <Icon name="plus" size={14} />
                      添加
                    </button>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}

      {layout.length === 0 ? (
        <div className="board-empty panel">
          <span className="empty-orbit" aria-hidden="true" />
          <h3>看板是空的</h3>
          <p>添加几个常用组件，把工作安排、生活节奏和空档都放到首页。</p>
          <div className="board-empty-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>
              添加组件
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => setLayout(DEFAULT_WIDGET_LAYOUT.map((item) => ({ ...item })))}
            >
              恢复默认看板
            </button>
          </div>
        </div>
      ) : (
        <div className={`widget-grid ${editing ? 'is-editing' : ''}`}>
          {layout.map((item, index) => {
            const meta = WIDGET_META[item.id]
            return (
              <section
                key={item.id}
                className={`widget panel ${item.span === 2 ? 'is-wide' : ''} ${
                  editing ? 'is-editing' : ''
                } ${dragging === item.id ? 'is-dragging' : ''} ${
                  dropTarget === item.id && dragging !== item.id ? 'is-drop-target' : ''
                }`}
                onDragOver={(event) => {
                  if (!editing || !dragging || dragging === item.id) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropTarget(item.id)
                }}
                onDragLeave={() => {
                  if (dropTarget === item.id) setDropTarget(null)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  dropOn(item.id)
                }}
              >
                {editing && (
                  <div className="widget-edit-bar">
                    <span
                      className="drag-handle"
                      draggable
                      onDragStart={(event) => onDragStart(event, item.id)}
                      onDragEnd={() => {
                        setDragging(null)
                        setDropTarget(null)
                      }}
                      title="拖动调整顺序"
                      aria-label="拖动调整顺序"
                      role="button"
                      tabIndex={0}
                    >
                      ⋮⋮
                    </span>
                    <span className="widget-edit-label">{meta.title}</span>
                    <div className="widget-edit-actions">
                      <button
                        type="button"
                        className={`span-toggle ${item.span === 2 ? 'is-active' : ''}`}
                        onClick={() => changeSpan(item.id, item.span === 2 ? 1 : 2)}
                        title={item.span === 2 ? '切换为窄卡片' : '切换为宽卡片'}
                      >
                        {item.span === 2 ? '宽' : '窄'}
                      </button>
                      <button
                        type="button"

                        className="icon-button"
                        onClick={() => move(item.id, -1)}
                        disabled={index === 0}
                        aria-label="上移组件"
                        title="上移"
                      >
                        <Icon name="arrowUp" size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => move(item.id, 1)}
                        disabled={index === layout.length - 1}
                        aria-label="下移组件"
                        title="下移"
                      >
                        <Icon name="arrowDown" size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => hide(item.id)}
                        aria-label="隐藏组件"
                        title="隐藏"
                      >
                        <Icon name="close" size={15} />
                      </button>
                    </div>
                  </div>
                )}
                <div className="widget-content">{renderHomeWidget(item.id, context)}</div>
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}