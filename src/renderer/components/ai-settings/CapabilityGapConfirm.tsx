import React, { useEffect, useRef } from 'react'
import type { ChannelCapabilityGap } from '@shared/ipc-contracts'
import { translate } from '@shared/message-catalog'
import Icon from '../Icon'

export type GapStage = 'switch' | 'strict'

interface CapabilityGapConfirmProps {
  readonly gap: ChannelCapabilityGap
  readonly stage: GapStage
  readonly onChoose: (action: 'strict' | 'keep_fallback' | 'cancel') => void
  readonly onConfirmStrict: () => void
  readonly onCancel: () => void
}

export default function CapabilityGapConfirm({
  gap,
  stage,
  onChoose,
  onConfirmStrict,
  onCancel
}: CapabilityGapConfirmProps): React.ReactElement {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [stage])

  if (stage === 'strict') {
    return (
      <div className="confirm-layer" role="alertdialog" aria-label="严格 DeepSeek 模式确认">
        <div className="confirm-card gap-confirm">
          <span className="eyebrow">STRICT DEEPSEEK</span>
          <h3>进入严格 DeepSeek 模式？</h3>
          <ul className="gap-consequences">
            <li>图片与语音不可用：DeepSeek 官方 API 不提供这两项能力。</li>
            <li>文字解析仍然可用，文字输入不受影响。</li>
            <li>可随时退出严格模式，恢复图片与语音通道。</li>
          </ul>
          <div className="confirm-actions">
            <button ref={cancelRef} type="button" className="btn btn-quiet" onClick={onCancel}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={onConfirmStrict}>
              确认进入严格模式
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="confirm-layer" role="alertdialog" aria-label="能力缺口确认">
      <div className="confirm-card gap-confirm">
        <span className="eyebrow">CAPABILITY GAP</span>
        <h3>{translate(gap.reasonKey)}</h3>
        <p>
          {gap.presetName} 无法承接该通道；请选择如何处理，不会静默降级，也不会把图片或音频伪装成文字。
        </p>
        <div className="gap-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onChoose('strict')}>
            改为严格模式
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => onChoose('keep_fallback')}>
            保留替代通道
          </button>
          <button ref={cancelRef} type="button" className="btn btn-ghost btn-sm" onClick={() => onChoose('cancel')}>
            <Icon name="close" size={14} />
            取消
          </button>
        </div>
      </div>
    </div>
  )
}