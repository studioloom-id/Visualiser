import type { Provider, Quality, Render, Settings, Space } from '../types'
import { descendantIds } from '../store'

export const estimateCost = (s: Settings, provider: Provider, quality: Quality, count = 1) =>
  s.costs[provider][quality] * count

export const projectSpend = (spaces: Space[], renders: Render[], projectId: string) => {
  const ids = new Set(descendantIds(spaces, projectId))
  return renders.filter((r) => ids.has(r.spaceId)).reduce((a, r) => a + r.cost, 0)
}

/** null when allowed, otherwise the reason it is blocked */
export const budgetBlock = (cap: number | undefined, spent: number, next: number): string | null =>
  cap && cap > 0 && spent + next > cap + 1e-9
    ? `Budget cap reached: $${spent.toFixed(2)} spent + $${next.toFixed(2)} estimated exceeds the $${cap.toFixed(2)} cap.`
    : null

export const usd = (n: number) => `$${n.toFixed(2)}`
