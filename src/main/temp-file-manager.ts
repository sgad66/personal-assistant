import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, basename } from 'node:path'

export type TempKind = 'voice' | 'image'

export interface RetainedFileInfo {
  readonly path: string
  readonly kind: TempKind
  readonly expiresAt: number
}

export interface RetentionOptions {
  readonly ttlMs: number
  readonly now?: number
  readonly kind?: TempKind
}

interface RetainedEntry {
  readonly kind: TempKind
  readonly expiresAt: number
  readonly timer: ReturnType<typeof setTimeout>
}

/**
 * 临时文件管理器：先登记，再由明确的所有权路径释放。
 *
 * - 解析成功：调用方 `release` 全部暂存路径；
 * - 解析失败：调用方 `retain` 进入保留区（默认 120 秒），支持失败后重试；
 * - 保留区由"重试成功 / 新提交 / 超时 / 转后台 / 退出"五条路径回收。
 */
export class TempFileManager {
  private readonly dir: string
  private readonly registered = new Set<string>()
  private readonly retained = new Map<string, RetainedEntry>()
  private readonly clock: () => number

  constructor(rootDir?: string, clock: () => number = () => Date.now()) {
    this.dir = rootDir ?? mkdtempSync(join(tmpdir(), 'pa-temp-'))
    this.clock = clock
    mkdirSync(this.dir, { recursive: true })
  }

  get directory(): string {
    return this.dir
  }

  stage(sourcePath: string, kind: TempKind): string {
    if (!existsSync(sourcePath)) {
      throw new Error(`source not found: ${sourcePath}`)
    }
    const target = join(this.dir, `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(sourcePath) || ''}`)
    copyFileSync(sourcePath, target)
    this.registered.add(target)
    return target
  }

  stageBytes(fileName: string, bytes: Uint8Array, kind: TempKind): string {
    const safeName = basename(fileName).replace(/[^\w.-]/g, '_')
    const target = join(this.dir, `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`)
    writeFileSync(target, bytes)
    this.registered.add(target)
    return target
  }

  retain(paths: readonly string[], options: RetentionOptions): void {
    if (options.ttlMs <= 0) {
      for (const path of paths) this.release(path)
      return
    }
    const now = options.now ?? this.clock()
    for (const path of paths) {
      if (this.retained.has(path)) continue
      const kind = options.kind ?? inferKind(path)
      const expiresAt = now + options.ttlMs
      const timer = setTimeout(() => {
        this.release(path)
      }, options.ttlMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.retained.set(path, { kind, expiresAt, timer })
      this.registered.add(path)
    }
  }

  isRetained(path: string): boolean {
    return this.retained.has(path)
  }

  retainedUntil(path: string): number | undefined {
    return this.retained.get(path)?.expiresAt
  }

  retainedKind(path: string): TempKind | undefined {
    return this.retained.get(path)?.kind
  }

  retainedFiles(): readonly RetainedFileInfo[] {
    return Array.from(this.retained.entries()).map(([path, entry]) => ({
      path,
      kind: entry.kind,
      expiresAt: entry.expiresAt
    }))
  }

  purgeRetainedExcept(keepPaths: readonly string[]): number {
    const keep = new Set(keepPaths)
    let removed = 0
    for (const path of Array.from(this.retained.keys())) {
      if (keep.has(path)) continue
      this.release(path)
      removed += 1
    }
    return removed
  }

  purgeExpired(now = this.clock()): number {
    let removed = 0
    for (const [path, entry] of Array.from(this.retained.entries())) {
      if (entry.expiresAt > now) continue
      this.release(path)
      removed += 1
    }
    return removed
  }

  release(path: string): void {
    const entry = this.retained.get(path)
    if (entry) {
      clearTimeout(entry.timer)
      this.retained.delete(path)
    }
    this.registered.delete(path)
    try {
      if (existsSync(path)) rmSync(path, { force: true })
    } catch {
      // 清理失败不阻断业务
    }
  }

  releaseAll(): void {
    const all = new Set<string>([...this.registered, ...this.retained.keys()])
    for (const path of all) {
      this.release(path)
    }
  }

  isEmpty(): boolean {
    try {
      return readdirSync(this.dir).length === 0
    } catch {
      return true
    }
  }
}

function inferKind(path: string): TempKind {
  return basename(path).startsWith('voice-') ? 'voice' : 'image'
}

function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, filePath)
}

export { atomicWrite }