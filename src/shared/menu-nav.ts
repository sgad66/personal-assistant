export type MenuNavKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'Escape'

export function nextMenuIndex(current: number, key: MenuNavKey, count: number): number {
  if (count <= 0) return -1
  if (key === 'Escape') return -1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (current < 0 || current >= count) return 0
  if (key === 'ArrowDown') return (current + 1) % count
  return (current - 1 + count) % count
}