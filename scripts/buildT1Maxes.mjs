#!/usr/bin/env node
/**
 * Offline generator for the T1-max lookup that feeds the modifier sliders.
 *
 * Pulls two public data sets and joins them:
 *   1. Exiled-Exchange-2 `stats.ndjson` — maps each PoE2 trade stat id
 *      (e.g. `explicit.stat_3489782002`) back to the game-internal stat id
 *      (e.g. `base_maximum_energy_shield`).
 *   2. LocalIdentity's `poe2-data/data/mods.json` — every mod row with its
 *      `StatsKey{1..6}.Id` and `Stat{1..6}Min/Max`.
 *
 * For a given trade stat id we find every mod row whose stat id slot matches
 * the underlying game stat and pick the biggest `Stat*Max`. That's the T1 roll
 * the user wants the slider to cap at.
 *
 * Different trade stat *types* (explicit / implicit / rune / desecrated) see
 * different pools of mods: an explicit "+# to maximum Energy Shield" caps at
 * ~89 (the level-82 prefix), while the implicit variant caps around 30 (from
 * implicit bases). We bucket by GenerationType + Domain accordingly.
 *
 * Output: `src/main/trade/data/t1MaxRolls.json` — a flat
 * `{ [tradeId]: number }` lookup we load in the main process at startup.
 *
 * Run manually whenever the upstream data updates (e.g. after a PoE2 patch):
 *   node scripts/buildT1Maxes.mjs
 */

import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const OUT_PATH = join(REPO_ROOT, 'src/main/trade/data/t1MaxRolls.json')

const STATS_URL =
  'https://raw.githubusercontent.com/Kvan7/Exiled-Exchange-2/master/dataParser/output/en/stats.ndjson'
const MODS_URL = 'https://raw.githubusercontent.com/LocalIdentity/poe2-data/main/data/mods.json'

// PoE2 item/jewel domains — these are the only ones a player can trade for, so
// everything else (monster affixes, map mods, delirium, …) is noise for our
// purposes.
const ITEM_DOMAINS = new Set([1, 11])

// GenerationType enum values observed in the dump, broken out by trade stat type:
//   1 = Prefix            -> explicit / fractured / rune / desecrated pool
//   2 = Suffix            -> explicit / fractured / rune / desecrated pool
//   3 = Implicit/Unique   -> implicit pool (also unique-item rolls — we let
//                             the unique cap leak into `implicit` because PoE
//                             treats both as implicit for trade purposes)
//   5 = Corrupted implicit -> implicit pool
//   9 = Enchant (best guess) -> enchant pool
const GEN_POOLS = {
  explicit: new Set([1, 2]),
  fractured: new Set([1, 2]),
  rune: new Set([1, 2]),
  desecrated: new Set([1, 2]),
  implicit: new Set([3, 5]),
  enchant: new Set([3, 9]),
  crafted: new Set([1, 2]),
  sanctum: new Set([1, 2]),
  pseudo: new Set([1, 2, 3, 5])
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status}`)
  await pipeline(res.body, createWriteStream(dest))
}

async function loadCached(url, name) {
  const cacheDir = join(tmpdir(), 'exiles-ledger-t1')
  await mkdir(cacheDir, { recursive: true })
  const dest = join(cacheDir, name)
  try {
    await readFile(dest)
    return dest
  } catch {
    console.log(`[download] ${url}`)
    await download(url, dest)
    return dest
  }
}

function statSlotIter(mod) {
  // Mods carry up to six stat slots; we stream them as {gameId, max} pairs.
  const out = []
  for (let i = 1; i <= 6; i++) {
    const key = mod[`StatsKey${i}`]
    if (!key || !key.Id) continue
    const max = mod[`Stat${i}Max`]
    if (!Number.isFinite(max)) continue
    out.push({ gameId: key.Id, max })
  }
  return out
}

function parseStatsNdjson(text) {
  // gameId -> { [poolType]: Set<tradeId> }
  const gameIdToTradeIds = new Map()
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    let rec
    try {
      rec = JSON.parse(t)
    } catch {
      continue
    }
    const gameId = rec.id
    if (!gameId) continue
    const byType = rec.trade?.ids
    if (!byType) continue
    let bucket = gameIdToTradeIds.get(gameId)
    if (!bucket) {
      bucket = {}
      gameIdToTradeIds.set(gameId, bucket)
    }
    for (const type of Object.keys(byType)) {
      const list = byType[type]
      if (!Array.isArray(list)) continue
      if (!bucket[type]) bucket[type] = new Set()
      for (const id of list) bucket[type].add(id)
    }
  }
  return gameIdToTradeIds
}

function buildPerPoolMax(mods) {
  // poolType -> gameId -> max (across mods matching that pool's gen types +
  // item-ish domain)
  const pools = {}
  for (const poolType of Object.keys(GEN_POOLS)) pools[poolType] = new Map()

  for (const mod of mods) {
    if (!ITEM_DOMAINS.has(mod.Domain)) continue
    const gen = mod.GenerationType
    for (const slot of statSlotIter(mod)) {
      for (const poolType of Object.keys(GEN_POOLS)) {
        if (!GEN_POOLS[poolType].has(gen)) continue
        const table = pools[poolType]
        const prev = table.get(slot.gameId)
        if (prev === undefined || slot.max > prev) table.set(slot.gameId, slot.max)
      }
    }
  }
  return pools
}

async function main() {
  const statsPath = await loadCached(STATS_URL, 'ee2-stats.ndjson')
  const modsPath = await loadCached(MODS_URL, 'poe2-mods.json')

  console.log('[parse] stats.ndjson')
  const statsText = await readFile(statsPath, 'utf8')
  const gameIdToTradeIds = parseStatsNdjson(statsText)
  console.log('[parse] stats game ids:', gameIdToTradeIds.size)

  console.log('[parse] mods.json')
  const mods = JSON.parse(await readFile(modsPath, 'utf8'))
  console.log('[parse] mods:', mods.length)

  const pools = buildPerPoolMax(mods)
  for (const poolType of Object.keys(pools)) {
    console.log(`[pool] ${poolType} stat ids: ${pools[poolType].size}`)
  }

  // For each (gameId, poolType) pair with a known max, emit every trade id of
  // that type. Trade ids for unknown pools fall back to the `explicit` pool so
  // every tradeId we recognise gets *some* ceiling.
  const out = {}
  let covered = 0
  let missing = 0
  for (const [gameId, byType] of gameIdToTradeIds) {
    for (const type of Object.keys(byType)) {
      const pool = pools[type] ?? pools.explicit
      const max = pool.get(gameId)
      if (max === undefined) {
        missing += byType[type].size
        continue
      }
      for (const tradeId of byType[type]) {
        out[tradeId] = max
        covered++
      }
    }
  }
  console.log('[emit] tradeIds with T1 max:', covered, ' missing:', missing)

  // Round to integers — PoE2 display mods like "+# to maximum ES" are always
  // whole numbers. The only places we'd lose precision are `dp: true` stats
  // (e.g. life-regen-per-sec) which already ship with a single decimal place
  // that gets floored in `rollMetaFromLine`.
  for (const k of Object.keys(out)) out[k] = Math.round(out[k])

  await mkdir(dirname(OUT_PATH), { recursive: true })
  await writeFile(OUT_PATH, JSON.stringify(out) + '\n', 'utf8')
  console.log('[write]', OUT_PATH, 'bytes:', (JSON.stringify(out).length / 1024).toFixed(1), 'KB')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
