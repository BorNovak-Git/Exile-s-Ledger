/**
 * T1 (best-tier) max-roll lookup for modifier sliders.
 *
 * Built offline by `scripts/buildT1Maxes.mjs` from LocalIdentity's `poe2-data`
 * + Exiled-Exchange-2's `stats.ndjson`. The resulting JSON is a flat
 * `{ [tradeStatId]: number }` map of the *theoretical* best roll (e.g. T1
 * prefix max) for every mod the trade API knows about, so sliders cap at the
 * true ceiling rather than just the specific item's tier.
 *
 * If a trade id isn't in the table the caller should fall back to the
 * clipboard-parsed tier range (then to the item's own roll) — plenty of mods
 * are missing because the upstream game-data dump lags behind PoE2 patches.
 */
import t1MaxRolls from './data/t1MaxRolls.json'

const TABLE = t1MaxRolls as Record<string, number>

/**
 * Returns the T1 max roll for a trade stat id, or `undefined` if we don't know
 * one. Results are whole-number rolls — PoE2's explicit mods don't use
 * fractional values, and we round at generation time.
 */
export function getT1Max(tradeId: string | undefined): number | undefined {
  if (!tradeId) return undefined
  const v = TABLE[tradeId]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Picks the largest T1 max across a group of trade ids (used for OR groups,
 * where a single clipboard line maps to several trade stats).
 */
export function getT1MaxForGroup(tradeIds: readonly string[] | undefined): number | undefined {
  if (!tradeIds || tradeIds.length === 0) return undefined
  let best: number | undefined
  for (const id of tradeIds) {
    const v = TABLE[id]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    if (best === undefined || v > best) best = v
  }
  return best
}
