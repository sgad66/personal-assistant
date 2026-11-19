import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FocusSourceKind, FocusWord } from '@shared/focus-words'
import { layoutFocusCloud } from './focus-cloud-layout'
import '../../styles/focus-cloud.css'

interface FocusCloudProps {
  readonly words: readonly FocusWord[]
  readonly recordCount: number
  readonly onPick: (word: string) => void
}

interface WordSize {
  readonly width: number
  readonly height: number
}

const MIN_VISIBLE_WORDS = 3

const KIND_LABEL: Readonly<Record<FocusSourceKind, string>> = {
  schedule: '日程',
  goal: '目标',
  memory: '记忆',
  conversation: '对话'
}

function limitForWidth(width: number): number {
  if (width >= 760) return 19
  if (width >= 620) return 16
  if (width >= 500) return 13
  if (width >= 410) return 11
  return 10
}

function toneOf(index: number): string {
  if (index === 0) return 'is-lead'
  if (index < 4) return 'is-warm'
  if (index < 7) return 'is-sage'
  if (index < 11) return 'is-ink'
  return 'is-muted'
}

function fontSizeOf(words: readonly FocusWord[], weight: number, index: number): number {
  const first = words[0]?.weight ?? 1
  const last = words[words.length - 1]?.weight ?? 1
  const span = first - last
  const ratio = span <= 0 ? 1 : Math.min(1, Math.max(0, (weight - last) / span))
  const base = 14 + Math.pow(ratio, 0.85) * 16
  const rankLift = index < 10 ? (10 - index) * 0.16 : 0
  return Math.round(Math.min(30, base + rankLift) * 10) / 10
}

function hintOf(word: FocusWord): string {
  const kinds = word.kinds.map((kind) => KIND_LABEL[kind]).join(' / ')
  const base = kinds.length > 0 ? `来自${kinds} · 出现 ${word.count} 次` : `出现 ${word.count} 次`
  return `${base}，点击和助理聊聊`
}

function estimateWidth(word: string, fontSize: number): number {
  const length = Array.from(word).length
  return Math.round(fontSize * Math.max(2, length) * 0.96)
}

export default function FocusCloud({ words, recordCount, onPick }: FocusCloudProps): React.ReactElement {
  const visible = words.length >= MIN_VISIBLE_WORDS
  const hostRef = useRef<HTMLElement | null>(null)
  const measureRefs = useRef<Array<HTMLSpanElement | null>>([])
  const [width, setWidth] = useState(0)
  const [sizes, setSizes] = useState<readonly WordSize[]>([])
  const [measureTick, setMeasureTick] = useState(0)

  const limit = useMemo(() => limitForWidth(width || 720), [width])
  const shown = useMemo(
    () => (visible ? words.slice(0, limit) : []),
    [visible, words, limit]
  )

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = (): void => {
      const next = Math.floor(host.clientWidth)
      setWidth((current) => (Math.abs(current - next) > 1 ? next : current))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [visible])

  useLayoutEffect(() => {
    if (shown.length === 0) {
      setSizes((current) => (current.length === 0 ? current : []))
      return
    }
    const next = shown.map((_, index) => {
      const element = measureRefs.current[index]
      return {
        width: element?.offsetWidth ?? 0,
        height: element?.offsetHeight ?? 0
      }
    })
    setSizes((current) => {
      const same =
        current.length === next.length &&
        current.every((item, index) => item.width === next[index].width && item.height === next[index].height)
      return same ? current : next
    })
  }, [shown, width, measureTick])

  useEffect(() => {
    let active = true
    void document.fonts?.ready.then(() => {
      if (active) setMeasureTick((value) => value + 1)
    })
    return () => {
      active = false
    }
  }, [])

  const layout = useMemo(() => {
    if (shown.length === 0) return { placements: [], height: 0 }
    const boxes = shown.map((word, index) => {
      const size = sizes[index]
      const fontSize = fontSizeOf(shown, word.weight, index)
      return {
        width: size && size.width > 0 ? size.width : estimateWidth(word.word, fontSize),
        height: size && size.height > 0 ? size.height : Math.round(fontSize * 1.45)
      }
    })
    return layoutFocusCloud(boxes, {
      width: width || 720,
      gap: 14,
      minHeight: 240,
      aspect: 0.48,
      maxWords: limit
    })
  }, [shown, sizes, width, limit])

  return (
    <section className="focus-cloud" ref={hostRef} aria-labelledby="focus-cloud-title">
      <header className="focus-cloud-head">
        <div className="focus-cloud-label">
          <span className="eyebrow">FOCUS CLOUD</span>
          <h2 id="focus-cloud-title">近期焦点</h2>
        </div>
        <span className="focus-cloud-meta">
          {visible ? `近 14 天 · ${recordCount} 条记录` : '来自日程、目标与对话'}
        </span>
      </header>

      {visible ? (
        <div className="focus-cloud-canvas" style={{ height: `${layout.height}px` }}>
          <div className="focus-cloud-measure" aria-hidden="true">
            {shown.map((word, index) => (
              <span
                key={word.word}
                ref={(element) => {
                  measureRefs.current[index] = element
                }}
                className="focus-cloud-measure-word"
                style={{ fontSize: `${fontSizeOf(shown, word.weight, index)}px` }}
              >
                {word.word}
              </span>
            ))}
          </div>
          {shown.map((word, index) => {
            const placement = layout.placements[index]
            if (!placement) return null
            return (
              <button
                key={word.word}
                type="button"
                className={`focus-word ${toneOf(index)}`}
                style={
                  {
                    fontSize: `${fontSizeOf(shown, word.weight, index)}px`,
                    animationDelay: `${Math.min(index * 24, 260)}ms`,
                    '--cloud-x': `${placement.x}px`,
                    '--cloud-y': `${placement.y}px`,
                    '--cloud-rotate': `${placement.rotate}deg`
                  } as React.CSSProperties
                }
                title={hintOf(word)}
                onClick={() => onPick(word.word)}
              >
                {word.word}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="focus-cloud-empty">
          <span className="focus-cloud-orbit" aria-hidden="true" />
          <div>
            <strong>还没有足够的近期记录</strong>
            <p>记一件事、写下一个目标，或聊上几句，这里会自动聚拢你最近在意的事。</p>
          </div>
        </div>
      )}
    </section>
  )
}