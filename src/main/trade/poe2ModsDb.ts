/**
 * Semantic lookup for PoE2 modifier stats.
 *
 * The live PoE2 trade API (`/api/trade2/data/stats`, see `poe2StatsDb.ts`) only
 * answers _what_ trade ids exist for a given mod shape — it doesn't tell you
 * which direction is "better" for pricing (higher-is-better vs lower-is-better)
 * nor which trade ids are semantically linked across mod types (explicit →
 * implicit → rune → desecrated → fractured for the same underlying stat).
 *
 * Exiled-Exchange-2's `stats.ndjson` does — their dataParser derives that info
 * from the PoE2 game data. We distil it offline into
 * `data/poe2Stats.json` via `scripts/fetchPoe2Data.mjs` and load the result
 * here so the parser can:
 *
 *   - tag each mod with `better` so the search sets `min` for positive stats
 *     and `max` for negative stats (e.g. attribute requirements)
 *   - surface all sibling trade ids (all six mod types for one underlying stat)
 *   - expose pseudo trade ids when available, so we can collapse a multi-part
 *     clipboard mod into a single pseudo filter on the server side
 *
 * Matching is by normalized shape string — kept byte-compatible with the live
 * DB's `normalizeStatText` so both lookups collide on the same key.
 */

import statsData from './data/poe2Stats.json'

export type LocalStatIds = {
  explicit?: string[]
  implicit?: string[]
  pseudo?: string[]
  fractured?: string[]
  enchant?: string[]
  rune?: string[]
  desecrated?: string[]
  sanctified?: string[]
  crafted?: string[]
  scourge?: string[]
}

export type LocalStatEntry = {
  /** EE2 internal reference, e.g. `"# to Spirit"`. Useful for debugging/logs. */
  ref: string
  /** `1` = higher is better, `-1` = lower is better, `0` = not a numeric mod. */
  better: 1 | -1 | 0
  ids: LocalStatIds
}

type RawRow = {
  ref: string
  shapes: string[]
  better: number
  ids: LocalStatIds
}

const byShape = new Map<string, LocalStatEntry>()
const byTradeId = new Map<string, LocalStatEntry>()

for (const row of statsData as RawRow[]) {
  const better = row.better === -1 ? -1 : row.better === 0 ? 0 : 1
  const entry: LocalStatEntry = { ref: row.ref, better, ids: row.ids }
  for (const shape of row.shapes) {
    // First writer wins — EE2's data is already sorted, and in practice shape
    // collisions across entries are rare (see e.g. the "# to Spirit" entry
    // owning its shape exclusively).
    if (!byShape.has(shape)) byShape.set(shape, entry)
  }
  for (const arr of Object.values(row.ids)) {
    if (!arr) continue
    for (const id of arr) {
      if (!byTradeId.has(id)) byTradeId.set(id, entry)
    }
  }
}

console.log(
  '[poe2ModsDb] loaded',
  statsData.length,
  'entries →',
  byShape.size,
  'shapes /',
  byTradeId.size,
  'trade ids'
)

/** Lookup by a pre-normalized shape (see `normalizeStatText`). */
export function lookupByShape(shape: string): LocalStatEntry | undefined {
  return byShape.get(shape)
}

/** Lookup by any trade id (explicit/implicit/pseudo/etc). */
export function lookupByTradeId(tradeId: string): LocalStatEntry | undefined {
  return byTradeId.get(tradeId)
}

/** Pseudo trade ids for a given mod entry, if any exist. */
export function pseudoTradeIdsFor(entry: LocalStatEntry | undefined): string[] | undefined {
  if (!entry) return undefined
  const p = entry.ids.pseudo
  return p && p.length > 0 ? p : undefined
}
