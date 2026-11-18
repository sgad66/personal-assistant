import React, { useEffect, useState } from 'react'
import type { ScheduleRecommendation, ScheduleRecommendations } from '@shared/ipc-contracts'
import { formatRange, startOfDay } from '@shared/time-kit'
import { WIDGET_META } from '../../home-layout'
import Icon from '../Icon'
import '../../styles/free-suggestions.css'

interface FreeTimeSuggestionsProps {
  readonly now: number
  readonly openDetail: (eventId: string) => void
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '') || fallback
    : fallback
}

export default function FreeTimeSuggestions({ now, openDetail }: FreeTimeSuggestionsProps): React.ReactElement {
  const [generation, setGeneration] = useState(0)
  const [result, setResult] = useState<ScheduleRecommendations>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState<string>()
  const [added, setAdded] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true
    async function load(): Promise<void> {
      try {
        const next = await window.pa.schedule.recommendations()
        if (active) setResult(next)
      } catch (cause) {
        if (active) setError(errorText(cause, '暂时无法获取建议，请刷新重试。'))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [generation])

  function refresh(): void {
    setError('')
    setLoading(true)
    setGeneration(value => value + 1)
  }

  async function add(item: ScheduleRecommendation): Promise<void> {
    if (adding || added[item.id]) return
    setError('')
    setAdding(item.id)
    try {
      const { eventId } = await window.pa.schedule.addRecommendation({ id: item.id })
      setAdded(current => ({ ...current, [item.id]: eventId }))
    } catch (cause) {
      setError(errorText(cause, '加入日程失败，请重试。'))
    } finally {
      setAdding(undefined)
    }
  }

  const meta = WIDGET_META.free
  return (
    <>
      <header className="panel-head recommendation-head">
        <div>
          <span className="eyebrow">{meta.eyebrow}</span>
          <h2>{meta.title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="刷新安排建议" title="刷新安排建议"
          disabled={loading || Boolean(adding)} onClick={refresh}>
          <Icon name="refresh" size={16} />
        </button>
      </header>
      <div className="recommendation-list-wrap" aria-busy={loading}>
        <p className="recommendation-caption" role="status">
          {loading ? '正在根据近期日程查找合适的安排…' : result && (
            result.source === 'deepseek' ? 'DeepSeek 推荐 · 今明两天' : '本地推荐 · 今明两天'
          )}
        </p>
        {error && <p className="recommendation-error" role="alert">{error}</p>}
        {result && result.items.length === 0 && !loading && (
          <p className="recommendation-empty">今明两天暂无合适的可添加安排。</p>
        )}
        {result && result.items.length > 0 && (
          <ul className="recommendation-list" aria-label="可加入日程的建议">
            {result.items.map(item => {
              const eventId = added[item.id]
              const pending = adding === item.id
              const expired = !eventId && item.startAt < now
              const date = startOfDay(item.startAt) === startOfDay(now) ? '今天' : '明天'
              const action = eventId ? `查看已加入的「${item.title}」` : `将「${item.title}」加入日程`
              return (
                <li className="recommendation-row" key={item.id}>
                  <div className="recommendation-copy">
                    <span className="recommendation-time">{date} {formatRange(item.startAt, item.endAt)}</span>
                    <strong>{item.title}</strong>
                    <p>{item.reason}</p>
                  </div>
                  <div className="recommendation-action">
                    <button type="button" aria-label={action} title={action}
                      className={eventId ? 'recommendation-add is-added' : 'recommendation-add'}
                      disabled={!eventId && (Boolean(adding) || loading || expired)}
                      onClick={() => eventId ? openDetail(eventId) : void add(item)}>
                      <Icon name={eventId ? 'check' : pending ? 'clock' : 'plus'} size={17} />
                    </button>
                    <span role="status">{eventId ? '已加入' : pending ? '加入中' : expired ? '已过时' : ''}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
