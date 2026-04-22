import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { netRequestJson } from './netHttp'

/**
 * PoE2 trade stats database.
 *
 * Mirrors awakened-poe-trade's approach of mapping clipboard mod lines to real trade stat ids,
 * so the server filters on actual mods instead of us doing shape matching on fetched items.
 *
 * Source: `GET /api/trade2/data/stats?realm=poe2`.
 * Cached on disk (`userData/poe2-stats.json`) so cold start without network still works for a day.
 */

type StatEntryApi = {
  id: string
  text: string
  type: string
}

type StatGroupApi = {
  id: string
  label: string
  entries: StatEntryApi[]
}

type StatsApiResponse = {
  result: StatGroupApi[]
}

export type StatEntry = {
  /** e.g. `explicit.stat_1671376347`, `rune.stat_xxx`, `pseudo.pseudo_total_lightning_resistance` */
  id: string
  /** Raw API text with `#` placeholders, e.g. `+# to maximum Energy Shield`. */
  text: string
  /** `explicit` | `implicit` | `pseudo` | `rune` | `enchant` | `crafted` | `fractured` | `desecrated` | ... */
  type: string
  /** Result of `normalizeStatText(text)`; used as lookup key. */
  normShape: string
}

type StatsDb = {
  fetchedAt: number
  entries: StatEntry[]
  /** Index: normalized shape → all entries sharing that shape (across types). */
  byShape: Map<string, StatEntry[]>
}

let cached: StatsDb | undefined
let loading: Promise<StatsDb> | undefined

const CACHE_FILE = 'poe2-stats.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Normalize a clipboard line or a DB stat text to a shape useful for matching.
 *
 * - Numbers (incl. optional sign) → `#`
 * - Source-tag suffixes like `(rune)`, `(desecrated)` stripped
 * - Punctuation other than `%` and `#` collapsed to spaces
 *
 * Clipboard `"+47 to maximum Energy Shield"` and DB `"+# to maximum Energy Shield"` both
 * normalize to `"# to maximum energy shield"`.
 */
export function normalizeStatText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\((rune|desecrated|implicit|fractured|enchant|crafted|corrupted)\)/g, ' ')
    // Drop PoE's "Advanced Mod Descriptions" inline tier ranges — `47(40-55)` becomes
    // just `47` so the resulting shape still matches DB entries like `# to maximum
    // energy shield` instead of bloating into `# # # to maximum energy shield`.
    .replace(/\(\s*-?\d+(?:\.\d+)?\s*[-–]\s*-?\d+(?:\.\d+)?\s*\)/g, ' ')
    .replace(/[+-]?\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9# %]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tag hint from clipboard, if line ends with e.g. `(rune)` or `(desecrated)`. */
export function parseSourceTag(line: string): string | undefined {
  const m = line
    .toLowerCase()
    .match(/\((rune|desecrated|implicit|fractured|enchant|crafted|corrupted)\)/)
  return m?.[1]
}

export function getLoadedStatsDb(): StatsDb | undefined {
  return cached
}

/** Lazily-triggered loader. Safe to call many times; concurrent callers share one promise. */
export async function loadPoe2StatsDb(baseUrl = 'https://www.pathofexile.com'): Promise<StatsDb> {
  if (cached) return cached
  if (loading) return loading

  loading = (async () => {
    const onDisk = await readDiskCache()
    if (onDisk && Date.now() - onDisk.fetchedAt < CACHE_TTL_MS) {
      console.log('[poe2StatsDb] using disk cache, entries:', onDisk.entries.length)
      cached = buildDb(onDisk.entries)
      cached.fetchedAt = onDisk.fetchedAt
      return cached
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/api/trade2/data/stats?realm=poe2`
    console.log('[poe2StatsDb] fetching', url)
    try {
      const res = await netRequestJson<StatsApiResponse>({ url })
      if (res.status >= 200 && res.status < 300 && res.json?.result) {
        const flat: StatEntry[] = []
        for (const group of res.json.result) {
          for (const e of group.entries ?? []) {
            if (!e?.id || !e?.text) continue
            flat.push({
              id: e.id,
              text: e.text,
              type: e.type || group.id,
              normShape: normalizeStatText(e.text)
            })
          }
        }
        console.log('[poe2StatsDb] loaded entries:', flat.length, 'groups:', res.json.result.length)
        await writeDiskCache({ fetchedAt: Date.now(), entries: flat })
        cached = buildDb(flat)
        cached.fetchedAt = Date.now()
        return cached
      }
      console.warn('[poe2StatsDb] fetch status:', res.status)
    } catch (err) {
      console.warn('[poe2StatsDb] fetch threw:', err instanceof Error ? err.message : err)
    }

    if (onDisk) {
      console.warn('[poe2StatsDb] falling back to stale disk cache')
      cached = buildDb(onDisk.entries)
      cached.fetchedAt = onDisk.fetchedAt
      return cached
    }
    // Empty db so callers still work (they'll just get no matches).
    cached = buildDb([])
    return cached
  })()
  try {
    return await loading
  } finally {
    loading = undefined
  }
}

function buildDb(entries: StatEntry[]): StatsDb {
  const byShape = new Map<string, StatEntry[]>()
  for (const e of entries) {
    const arr = byShape.get(e.normShape) ?? []
    arr.push(e)
    byShape.set(e.normShape, arr)
  }
  return { fetchedAt: 0, entries, byShape }
}

export type ModMatch = {
  /** Candidate trade entries whose shape matches the mod line. */
  entries: StatEntry[]
  /** `rune` / `desecrated` / `implicit` etc, if the clipboard line had such a suffix tag. */
  sourceTag?: string
}

/**
 * Resolve a clipboard mod line to trade stat entries.
 *
 * If `sourceTag` narrows to one type (e.g. `rune`) we return only that type's entries.
 * Otherwise we return the "best match" group: explicit takes precedence over other types
 * so a plain resistance line maps to its `explicit.stat_*`, not the `pseudo.*` variant
 * (which typically has different text like "total to ...").
 */
export function findStatsForMod(line: string): ModMatch {
  const db = cached
  if (!db) return { entries: [] }
  const shape = normalizeStatText(line)
  const all = db.byShape.get(shape) ?? []
  const sourceTag = parseSourceTag(line)

  if (sourceTag && all.length) {
    const typed = all.filter((e) => e.type.toLowerCase() === sourceTag)
    if (typed.length) return { entries: typed, sourceTag }
  }

  // Prefer explicit when the clipboard line has no tag (matches awakened's default).
  const explicit = all.filter((e) => e.type.toLowerCase() === 'explicit')
  if (explicit.length) return { entries: explicit, sourceTag }
  return { entries: all, sourceTag }
}

async function readDiskCache(): Promise<
  { fetchedAt: number; entries: StatEntry[] } | undefined
> {
  try {
    const file = join(app.getPath('userData'), CACHE_FILE)
    const raw = await fs.readFile(file, 'utf8')
    const p = JSON.parse(raw) as { fetchedAt: number; entries: StatEntry[] }
    if (!p || !Array.isArray(p.entries) || typeof p.fetchedAt !== 'number') return undefined
    return p
  } catch {
    return undefined
  }
}

async function writeDiskCache(payload: {
  fetchedAt: number
  entries: StatEntry[]
}): Promise<void> {
  try {
    const file = join(app.getPath('userData'), CACHE_FILE)
    await fs.writeFile(file, JSON.stringify(payload), 'utf8')
  } catch (err) {
    console.warn(
      '[poe2StatsDb] disk cache write failed',
      err instanceof Error ? err.message : err
    )
  }
}
