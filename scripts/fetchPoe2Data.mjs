#!/usr/bin/env node
/**
 * Offline downloader for the PoE2 stats semantics lookup.
 *
 * Pulls Exiled-Exchange-2's `stats.ndjson` (NDJSON of every PoE2 trade stat with
 * its `better` direction and `trade.ids` per mod type) and distils it into a
 * compact JSON the main process can `import` at startup:
 *
 *   src/main/trade/data/poe2Stats.json
 *
 * Why not import the NDJSON directly? Electron-vite bundles the main process,
 * and shipping 800KB of newline-delimited JSON as an asset is awkward when we
 * only need ~5 fields per row. Flattening up front also lets us precompute the
 * normalized shape once.
 *
 * Run manually after a PoE2 patch:
 *   npm run update:poe2-data
 */

import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const OUT_PATH = join(REPO_ROOT, 'src/main/trade/data/poe2Stats.json')

const STATS_URL =
  'https://raw.githubusercontent.com/Kvan7/Exiled-Exchange-2/dev/dataParser/output/en/stats.ndjson'

/** Quick mirror of `normalizeStatText` in poe2StatsDb.ts — kept in sync by hand. */
function normalizeStatText(raw) {
  return raw
    .toLowerCase()
    .replace(/\((rune|desecrated|implicit|fractured|enchant|crafted|corrupted)\)/g, ' ')
    .replace(/\(\s*-?\d+(?:\.\d+)?\s*[-–]\s*-?\d+(?:\.\d+)?\s*\)/g, ' ')
    .replace(/[+-]?\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9# %]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function downloadToTmp(url, filename) {
  const tmp = join(tmpdir(), filename)
  console.log(`[fetch-poe2-data] downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`)
  await pipeline(res.body, createWriteStream(tmp))
  console.log(`[fetch-poe2-data] -> ${tmp}`)
  return tmp
}

async function main() {
  const statsTmp = await downloadToTmp(STATS_URL, 'ee2-stats.ndjson')
  const raw = await readFile(statsTmp, 'utf8')

  const rows = []
  let skippedNoMatcher = 0
  let skippedNoTrade = 0

  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    let obj
    try {
      obj = JSON.parse(s)
    } catch {
      continue
    }
    // Skip rows without any text matcher — we can't map a clipboard line to them.
    if (!Array.isArray(obj.matchers) || obj.matchers.length === 0) {
      skippedNoMatcher++
      continue
    }
    const trade = obj.trade ?? {}
    const ids = trade.ids ?? {}
    // Skip rows with no trade ids at all — they can't drive a server-side search.
    const hasAnyId = Object.values(ids).some((v) => Array.isArray(v) && v.length > 0)
    if (!hasAnyId) {
      skippedNoTrade++
      continue
    }

    // Collect every matcher text (EE2's "negate" variants included), normalized.
    // Some matchers carry a `negate` flag — they flip sign in the UI, which we
    // don't need for enabling/better/pseudos, so we just capture the shape.
    const shapes = new Set()
    for (const m of obj.matchers) {
      const text = typeof m?.string === 'string' ? m.string : ''
      if (!text) continue
      const shape = normalizeStatText(text)
      if (shape) shapes.add(shape)
    }
    if (shapes.size === 0) {
      skippedNoMatcher++
      continue
    }

    rows.push({
      ref: obj.ref,
      shapes: [...shapes],
      better: typeof obj.better === 'number' ? obj.better : 1,
      ids: {
        explicit: ids.explicit ?? undefined,
        implicit: ids.implicit ?? undefined,
        pseudo: ids.pseudo ?? undefined,
        fractured: ids.fractured ?? undefined,
        enchant: ids.enchant ?? undefined,
        rune: ids.rune ?? undefined,
        desecrated: ids.desecrated ?? undefined,
        sanctified: ids.sanctified ?? undefined,
        crafted: ids.crafted ?? undefined,
        scourge: ids.scourge ?? undefined
      }
    })
  }

  // Strip empty `ids` subkeys so the final JSON is tidy.
  for (const r of rows) {
    for (const k of Object.keys(r.ids)) {
      if (r.ids[k] === undefined) delete r.ids[k]
    }
  }

  await mkdir(dirname(OUT_PATH), { recursive: true })
  await writeFile(OUT_PATH, JSON.stringify(rows), 'utf8')
  console.log(
    `[fetch-poe2-data] wrote ${rows.length} rows → ${OUT_PATH} ` +
      `(skipped no-matcher: ${skippedNoMatcher}, no-trade-ids: ${skippedNoTrade})`
  )
}

main().catch((err) => {
  console.error('[fetch-poe2-data] failed:', err)
  process.exit(1)
})
