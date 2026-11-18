import React from 'react'
import { translate } from '@shared/message-catalog'
import { middleEllipsis } from '@shared/import/text'

export interface ImportPanelContext {
  readonly fileName: string
  readonly readableChars: number
  readonly originalChars: number
  readonly clipped: boolean
  readonly submittedPreview: string
  readonly fileIndex: number
  readonly fileTotal: number
}

export default function ImportContextBlock(context: ImportPanelContext): React.ReactElement {
  return (
    <div className="import-context">
      <span className="import-source" title={context.fileName}>
        {translate('import.sourceLabel', { name: middleEllipsis(context.fileName, 32) })}
      </span>
      <span className="import-chars">读取 {context.readableChars} 字</span>
      {context.fileTotal > 1 && (
        <span className="import-index">
          第 {context.fileIndex}/{context.fileTotal} 个
        </span>
      )}
      {context.clipped && (
        <>
          <span className="import-clipped">
            {translate('import.truncated', { chars: context.originalChars })}
          </span>
          <details className="import-preview">
            <summary>查看已选取片段</summary>
            <pre>{context.submittedPreview}</pre>
          </details>
        </>
      )}
    </div>
  )
}