import React, { useRef } from 'react'

const PICKER_IDLE_MS = 1_200

export interface ImportPickerOptions {
  readonly onPick: (files: File[]) => void
  readonly onPickerFailed: () => void
}

export interface ImportPicker {
  readonly input: React.ReactNode
  readonly open: () => void
}

export function useImportPicker({ onPick, onPickerFailed }: ImportPickerOptions): ImportPicker {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const sawChangeRef = useRef(false)

  const open = (): void => {
    sawChangeRef.current = false
    inputRef.current?.click()
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      if (!sawChangeRef.current && document.hasFocus()) onPickerFailed()
    }, PICKER_IDLE_MS)
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept=".txt,.md,.csv,.ics,.json"
      style={{ display: 'none' }}
      onChange={(event) => {
        sawChangeRef.current = true
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
        const files = Array.from(event.target.files ?? [])
        onPick(files)
        event.target.value = ''
      }}
    />
  )

  return { input, open }
}