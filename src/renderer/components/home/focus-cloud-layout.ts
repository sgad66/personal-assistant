export interface CloudWordBox {
  readonly width: number
  readonly height: number
}

export interface CloudPlacement {
  readonly x: number
  readonly y: number
  readonly rotate: number
}

export interface CloudLayout {
  readonly placements: readonly CloudPlacement[]
  readonly height: number
}

export interface CloudLayoutOptions {
  readonly width: number
  readonly gap?: number
  readonly minHeight?: number
  readonly aspect?: number
  readonly maxWords?: number
}

interface Rect {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}


const ROTATIONS: readonly number[] = [-2.4, 1.8, -1.2, 2.6, -1.8, 1.4]
const MAX_ROTATE_WIDTH = 96

const ANGLE_ORDER: readonly number[] = [
  0,
  Math.PI,
  Math.PI / 2,
  -Math.PI / 2,
  Math.PI / 4,
  -Math.PI / 4,
  (3 * Math.PI) / 4,
  (-3 * Math.PI) / 4,
  Math.PI / 6,
  -Math.PI / 6,
  (5 * Math.PI) / 6,
  (-5 * Math.PI) / 6,
  Math.PI / 3,
  -Math.PI / 3,
  (2 * Math.PI) / 3,
  (-2 * Math.PI) / 3
]

const ANGLE_JITTER: readonly number[] = [
  0,
  0.06,
  -0.05,
  0.09,
  -0.08,
  0.05,
  0.11,
  -0.1,
  0.07,
  -0.04,
  0.08,
  -0.07,
  0.05,
  -0.06,
  0.1,
  -0.09
]

function rectOf(x: number, y: number, width: number, height: number): Rect {
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2
  }
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top
}

function round(value: number): number {
  return Math.round(value)
}

export function layoutFocusCloud(
  items: readonly CloudWordBox[],
  options: CloudLayoutOptions
): CloudLayout {
  const width = Number.isFinite(options.width) ? Math.max(0, options.width) : 0
  const gap = Math.max(0, options.gap ?? 12)
  const minHeight = Math.max(0, options.minHeight ?? 200)
  const aspect = Math.min(0.9, Math.max(0.3, options.aspect ?? 0.48))
  const count = Math.min(items.length, Math.max(0, options.maxWords ?? 24))

  if (count === 0 || width <= 0) return { placements: [], height: 0 }

  const rx = Math.min(Math.max(72, width / 2 - 18), 260)
  const ry = Math.max(56, rx * aspect)
  const placements: CloudPlacement[] = []
  const rects: Rect[] = []

  const withinBounds = (rect: Rect): boolean => {
    if (rect.left < -width / 2 + 2 || rect.right > width / 2 - 2) return false
    if (Math.abs(rect.top) > ry + 30 || Math.abs(rect.bottom) > ry + 30) return false
    return true
  }

  for (let index = 0; index < count; index += 1) {
    const item = items[index]
    const wordWidth = Math.max(24, item?.width ?? 48)
    const wordHeight = Math.max(12, item?.height ?? 18)
    const rotate = index > 0 && wordWidth <= MAX_ROTATE_WIDTH ? ROTATIONS[index % ROTATIONS.length] : 0

    let placed: CloudPlacement | undefined
    if (index === 0) {
      const rect = rectOf(0, 0, wordWidth, wordHeight)
      if (withinBounds(rect)) placed = { x: 0, y: 0, rotate: 0 }
    }

    if (!placed) {
      for (let ringStep = 0; ringStep <= 12 && !placed; ringStep += 1) {
        const ring = 0.3 + ringStep * 0.06
        for (let step = 0; step < ANGLE_ORDER.length && !placed; step += 1) {
          const angle =
            ANGLE_ORDER[(step + index - 1 + ANGLE_ORDER.length) % ANGLE_ORDER.length] +
            ANGLE_JITTER[(step + index) % ANGLE_JITTER.length]
          const x = round(rx * ring * Math.cos(angle))
          const y = round(ry * ring * Math.sin(angle))
          const rect = rectOf(x, y, wordWidth, wordHeight)
          if (!withinBounds(rect)) continue
          if (rects.some((other) => overlaps(rect, other, gap))) continue
          placed = { x, y, rotate }
        }
      }
    }

    if (!placed) {
      const bottom = rects.reduce((max, rect) => Math.max(max, rect.bottom), 0)
      placed = { x: 0, y: round(bottom + gap + wordHeight / 2), rotate }
    }

    placements.push(placed)
    rects.push(rectOf(placed.x, placed.y, wordWidth, wordHeight))
  }

  const halfHeight = rects.reduce(
    (max, rect) => Math.max(max, Math.abs(rect.top), Math.abs(rect.bottom)),
    0
  )

  return {
    placements,
    height: Math.max(minHeight, Math.ceil(halfHeight * 2 + 24))
  }
}