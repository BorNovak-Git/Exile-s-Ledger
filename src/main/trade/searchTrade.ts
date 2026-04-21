import type {
  TradeFilterOption,
  TradeItemStats,
  TradeListingSummary,
  TradeSearchRequest,
  TradeSearchResponse
} from '../../shared/trade'
import { netRequestJson, netRequestTextWithRetry } from './netHttp'

type TradeSearchApiResponse = {
  id: string
  total: number
  result: string[]
}

type TradeFetchApiResponse = {
  result: Array<{
    id: string
    item?: {
      name?: string
      typeLine?: string
      ilvl?: number
      corrupted?: boolean
      note?: string
      requirements?: Array<{ name?: string; values?: Array<[string, number]> }>
      properties?: Array<{ name?: string; values?: Array<[string, number]> }>
      implicitMods?: string[]
      explicitMods?: string[]
      runeMods?: string[]
      craftedMods?: string[]
      enchantMods?: string[]
      fracturedMods?: string[]
    }
    listing?: {
      whisper?: string
      account?: { name?: string }
      price?: { type?: string; amount?: number; currency?: string }
    }
  }>
}

function formatPrice(price?: {
  type?: string
  amount?: number
  currency?: string
}): string | undefined {
  if (!price) return undefined
  if (price.amount === undefined || !price.currency) return undefined
  return `${price.amount} ${price.currency}`
}

function formatNameValueLines(
  list?: Array<{ name?: string; values?: Array<[string, number]> }>
): string[] | undefined {
  if (!list || !list.length) return undefined
  const lines: string[] = []
  for (const p of list) {
    const name = p.name?.trim()
    if (!name) continue
    const valueText = (p.values ?? [])
      .map((v) => (Array.isArray(v) && typeof v[0] === 'string' ? v[0] : ''))
      .filter((x) => x && x.trim().length)
      .join(' / ')
    lines.push(valueText.length ? `${name}: ${valueText}` : name)
  }
  return lines.length ? lines : undefined
}

function toTradeItemStats(
  item?: TradeFetchApiResponse['result'][number]['item']
): TradeItemStats | undefined {
  if (!item) return undefined
  const requirements = formatNameValueLines(item.requirements)
  const properties = formatNameValueLines(item.properties)
  const implicitMods = item.implicitMods?.length ? item.implicitMods : undefined
  const explicitMods = item.explicitMods?.length ? item.explicitMods : undefined
  const runeMods = item.runeMods?.length ? item.runeMods : undefined
  const craftedMods = item.craftedMods?.length ? item.craftedMods : undefined
  const enchantMods = item.enchantMods?.length ? item.enchantMods : undefined
  const fracturedMods = item.fracturedMods?.length ? item.fracturedMods : undefined

  if (
    !requirements &&
    !properties &&
    !implicitMods &&
    !explicitMods &&
    !runeMods &&
    !craftedMods &&
    !enchantMods &&
    !fracturedMods &&
    item.corrupted === undefined
  ) {
    return undefined
  }

  return {
    requirements,
    properties,
    implicitMods,
    explicitMods,
    runeMods,
    craftedMods,
    enchantMods,
    fracturedMods,
    corrupted: item.corrupted
  }
}

/** True if the item has any rolled affix / rune / crafted / enchant / fractured lines */
function itemHasAffixLines(item?: TradeFetchApiResponse['result'][number]['item']): boolean {
  if (!item) return false
  const lists = [
    item.implicitMods,
    item.explicitMods,
    item.runeMods,
    item.craftedMods,
    item.enchantMods,
    item.fracturedMods
  ]
  return lists.some((a) => Array.isArray(a) && a.length > 0)
}

/** Drop corrupted listings that have no affix-style lines (tooltip would only say "Corrupted"). */
function shouldDropCorruptedBare(item?: TradeFetchApiResponse['result'][number]['item']): boolean {
  return !!item?.corrupted && !itemHasAffixLines(item)
}

/** Rough chaos equivalents for sorting (best-effort; league rates vary). */
const CHAOS_PER_UNIT: Record<string, number> = {
  chaos: 1,
  divine: 200,
  exalted: 25,
  annul: 35,
  mirror: 80000,
  alch: 0.35,
  alchemy: 0.35,
  regal: 0.25,
  vaal: 0.6,
  aug: 0.08,
  transmute: 0.04,
  chromatic: 0.15,
  jeweller: 0.08,
  fusing: 0.5,
  scour: 0.4,
  blessed: 0.15,
  chisel: 0.12,
  silver: 0.02
}

function normalizeCurrencyId(currency: string): string {
  return currency
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/orb_of_/g, '')
    .replace(/_orb$/g, '')
}

function priceSortValue(price?: {
  type?: string
  amount?: number
  currency?: string
}): number | undefined {
  if (!price || price.amount === undefined || !price.currency) return undefined
  const key = normalizeCurrencyId(price.currency)
  const mult = CHAOS_PER_UNIT[key] ?? CHAOS_PER_UNIT[key.replace(/_/g, '')] ?? 0.02
  return price.amount * mult
}

type Trade2Payload = {
  query: {
    status: { option: string }
    stats?: Array<{
      type: 'and'
      filters: Array<{
        id: string
        disabled: boolean
        value?: { min?: number; max?: number | null }
      }>
      disabled: boolean
    }>
    filters: {
      type_filters: { filters: Record<string, unknown>; disabled: boolean }
      equipment_filters: { filters: Record<string, unknown>; disabled: boolean }
      req_filters?: { filters: Record<string, unknown>; disabled: boolean }
      misc_filters?: { filters: Record<string, unknown>; disabled: boolean }
    }
  }
  sort: { price: 'asc' }
}

function isTradeStatId(id: string): boolean {
  return (
    id.startsWith('pseudo.') ||
    id.startsWith('explicit.') ||
    id.startsWith('implicit.') ||
    id.startsWith('rune.')
  )
}

/** Strip numbers / punctuation so "30% to Lightning Resistance" and "+30 to Lightning Resistance" compare as the same stat. */
function normalizeModText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-+]?\d+(\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9# ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type ItemPayload = TradeFetchApiResponse['result'][number]['item']

function collectAllModTexts(item?: ItemPayload): string[] {
  if (!item) return []
  const buckets: (string[] | undefined)[] = [
    item.implicitMods,
    item.explicitMods,
    item.runeMods,
    item.craftedMods,
    item.enchantMods,
    item.fracturedMods
  ]
  const out: string[] = []
  for (const b of buckets)
    if (Array.isArray(b)) for (const s of b) if (typeof s === 'string') out.push(s)
  return out
}

type ClientModRule = { shape: string; min?: number; max?: number }

function firstNumberInModLine(line: string): number | undefined {
  const m = line.match(/-?\d+(?:\.\d+)?/)
  if (!m) return undefined
  const n = Number(m[0])
  return Number.isFinite(n) ? n : undefined
}

function lineMatchesModRule(itemLine: string, rule: ClientModRule): boolean {
  const norm = normalizeModText(itemLine)
  if (!norm.includes(rule.shape) && !rule.shape.includes(norm)) return false
  if (rule.min === undefined && rule.max === undefined) return true
  const n = firstNumberInModLine(itemLine)
  if (n === undefined) return false
  if (rule.min !== undefined && n < rule.min) return false
  if (rule.max !== undefined && n > rule.max) return false
  return true
}

function countMatchedModRules(item: ItemPayload, rules: ClientModRule[]): number {
  if (!rules.length) return 0
  const lines = collectAllModTexts(item)
  let hits = 0
  for (const rule of rules) {
    if (lines.some((line) => lineMatchesModRule(line, rule))) hits++
  }
  return hits
}

function buildClientModRules(selected: TradeFilterOption[]): ClientModRule[] {
  const rules: ClientModRule[] = []
  for (const f of selected) {
    if (f.group !== 'mods' || f.tradeId) continue
    const src = f.modSourceLine
    if (src && f.value?.kind === 'number') {
      const shape = normalizeModText(src)
      if (shape.length) {
        rules.push({
          shape,
          min: f.value.min,
          max: f.value.max
        })
      }
      continue
    }
    if (f.value?.kind === 'text' && typeof f.value.text === 'string') {
      const shape = normalizeModText(f.value.text)
      if (shape.length) rules.push({ shape })
    }
  }
  return rules
}

export async function searchTrade(req: TradeSearchRequest): Promise<TradeSearchResponse> {
  const baseUrl = (req.baseUrl ?? 'https://www.pathofexile.com').replace(/\/+$/, '')
  const limit = Math.max(1, Math.min(req.limit ?? 10, 50))
  console.log('[searchTrade] start', { baseUrl, league: req.league, limit })

  // PoE2 trade uses "trade2" endpoints and a query shape like:
  // POST /api/trade2/search/poe2/<league>
  // { query: { status, stats, filters }, sort }
  const statFilters: Array<{
    id: string
    disabled: boolean
    value?: { min?: number; max?: number | null }
  }> = []
  const pseudos = new Set<string>()

  const typeFilters: Record<string, unknown> = {}
  const equipFilters: Record<string, unknown> = {}
  const reqFilters: Record<string, unknown> = {}
  const miscFilters: Record<string, unknown> = {}

  for (const f of req.selectedFilters) {
    if (!f.tradeId) continue

    if (f.tradeId === 'type_filters.rarity') {
      if (f.value?.kind === 'text') typeFilters.rarity = { option: f.value.text }
      continue
    }
    if (f.tradeId === 'type_filters.category') {
      if (f.value?.kind === 'text') typeFilters.category = { option: f.value.text }
      continue
    }
    if (f.tradeId === 'type_filters.ilvl' && f.value?.kind === 'number') {
      const { min, max } = f.value
      if (min !== undefined || max !== undefined) {
        typeFilters.ilvl = {
          ...(min !== undefined ? { min } : {}),
          ...(max !== undefined ? { max } : {})
        }
      }
      continue
    }
    if (f.tradeId === 'type_filters.quality' && f.value?.kind === 'number') {
      const { min, max } = f.value
      if (min !== undefined || max !== undefined) {
        typeFilters.quality = {
          ...(min !== undefined ? { min } : {}),
          ...(max !== undefined ? { max } : {})
        }
      }
      continue
    }

    if (f.tradeId === 'req_filters.lvl' && f.value?.kind === 'number') {
      const lvl: Record<string, number> = {}
      if (f.value.min !== undefined) lvl.min = f.value.min
      if (f.value.max !== undefined) lvl.max = f.value.max
      if (Object.keys(lvl).length) reqFilters.lvl = lvl
      continue
    }

    if (f.tradeId === 'misc_filters.corrupted' && f.value?.kind === 'text') {
      miscFilters.corrupted = { option: f.value.text }
      continue
    }

    if (f.tradeId === 'equipment_filters.es' && f.value?.kind === 'number') {
      const n = f.value.min
      if (n !== undefined) equipFilters.es = { min: n, max: null }
      continue
    }
    if (f.tradeId === 'equipment_filters.ar' && f.value?.kind === 'number') {
      const n = f.value.min
      if (n !== undefined) equipFilters.ar = { min: n, max: null }
      continue
    }
    if (f.tradeId === 'equipment_filters.ev' && f.value?.kind === 'number') {
      const n = f.value.min
      if (n !== undefined) equipFilters.ev = { min: n, max: null }
      continue
    }
    if (f.tradeId === 'equipment_filters.rune_sockets' && f.value?.kind === 'number') {
      const n = f.value.min
      if (n !== undefined) equipFilters.rune_sockets = { min: n, max: null }
      continue
    }

    if (isTradeStatId(f.tradeId)) {
      if (f.value?.kind !== 'number') continue
      const { min, max } = f.value
      let value: { min?: number; max?: number | null } | undefined
      if (min !== undefined && max !== undefined) {
        value = { min, max: max ?? null }
      } else if (min !== undefined) {
        value = { min }
      } else if (max !== undefined) {
        value = { max }
      } else {
        continue
      }
      statFilters.push({ id: f.tradeId, disabled: false, value })
      if (f.tradeId.startsWith('pseudo.')) pseudos.add(f.tradeId)
    }
  }

  // Mods without a trade stat id: client-side shape match (+ optional min/max on the mod's roll).
  const textModRules = buildClientModRules(req.selectedFilters)

  const filters: Trade2Payload['query']['filters'] = {
    type_filters: { filters: typeFilters, disabled: false },
    equipment_filters: { filters: equipFilters, disabled: false }
  }
  if (Object.keys(reqFilters).length) {
    filters.req_filters = { filters: reqFilters, disabled: false }
  }
  if (Object.keys(miscFilters).length) {
    filters.misc_filters = { filters: miscFilters, disabled: false }
  }

  const body: Trade2Payload = {
    query: {
      status: { option: 'securable' },
      ...(statFilters.length
        ? { stats: [{ type: 'and', filters: statFilters, disabled: false }] }
        : {}),
      filters
    },
    sort: { price: 'asc' }
  }

  console.log('[searchTrade] POST payload:', JSON.stringify(body))
  const searchUrl = `${baseUrl}/api/trade2/search/poe2/${encodeURIComponent(req.league)}`
  const searchRes = await netRequestJson<TradeSearchApiResponse>({
    url: searchUrl,
    method: 'POST',
    body
  })
  console.log('[searchTrade] search status:', searchRes.status)

  if (searchRes.status < 200 || searchRes.status >= 300 || !searchRes.json) {
    const bodyPreview = (searchRes.text ?? '').slice(0, 400)
    if (searchRes.status === 429) {
      throw new Error(
        `Trade search rate limited (429). Wait a minute and try again, or search less often.\n\n${bodyPreview}`
      )
    }
    throw new Error(
      `Trade search failed (${searchRes.status}). If this is a Cloudflare block, click "Connect to trade site" in the app once, then retry.\n\n${bodyPreview}`
    )
  }

  const searchJson = searchRes.json
  console.log('[searchTrade] search response:', {
    id: searchJson.id,
    total: searchJson.total,
    results: searchJson.result?.length
  })
  // Trade search returns cheapest listings first; we fetch a small pool then rank client-side:
  // exact text-mod match first, then most shared mods, then cheapest (same idea as many trade overlays).
  const candidatePoolSize = textModRules.length ? Math.min(20, Math.max(limit * 2, limit)) : limit
  const allIds = (searchJson.result ?? []).slice(0, candidatePoolSize)

  if (allIds.length === 0) {
    return { queryId: searchJson.id, total: searchJson.total, results: [], raw: searchJson }
  }

  const FETCH_CHUNK_SIZE = 10
  /** Short pause between fetch GETs to reduce 429s; small pool keeps search snappy. */
  const delayBetweenFetchChunksMs = textModRules.length ? 140 : 0
  const fetchedRows: TradeFetchApiResponse['result'] = []
  let lastFetchUrl = ''

  for (let i = 0; i < allIds.length; i += FETCH_CHUNK_SIZE) {
    if (i > 0 && delayBetweenFetchChunksMs > 0) {
      await new Promise((r) => setTimeout(r, delayBetweenFetchChunksMs))
    }
    const chunk = allIds.slice(i, i + FETCH_CHUNK_SIZE)
    const url = new URL(`${baseUrl}/api/trade2/fetch/${chunk.map(encodeURIComponent).join(',')}`)
    url.searchParams.set('query', searchJson.id)
    url.searchParams.set('realm', 'poe2')
    for (const p of pseudos) url.searchParams.append('pseudos[]', p)
    lastFetchUrl = url.toString()

    console.log('[searchTrade] fetch url:', lastFetchUrl)
    const fetchRes = await netRequestTextWithRetry({ url: lastFetchUrl, method: 'GET' })
    console.log('[searchTrade] fetch status:', fetchRes.status)
    if (fetchRes.status < 200 || fetchRes.status >= 300) {
      const bodyPreview = (fetchRes.text ?? '').slice(0, 400)
      if (fetchRes.status === 429) {
        throw new Error(
          `Trade fetch rate limited (429) after automatic retries. Wait a minute and try again.\n\n${bodyPreview}`
        )
      }
      throw new Error(`Trade fetch failed (${fetchRes.status}).\n\n${bodyPreview}`)
    }

    let chunkJson: TradeFetchApiResponse
    try {
      chunkJson = JSON.parse(fetchRes.text) as TradeFetchApiResponse
    } catch {
      throw new Error('Trade fetch returned non-JSON response.')
    }

    for (const r of chunkJson.result ?? []) fetchedRows.push(r)
  }

  const fetchJson: TradeFetchApiResponse = { result: fetchedRows }
  const needleCount = textModRules.length
  const scored = fetchedRows
    .filter((r) => !shouldDropCorruptedBare(r.item))
    .map((r) => {
      const matchN = countMatchedModRules(r.item, textModRules)
      const exact = needleCount > 0 && matchN === needleCount
      const price = priceSortValue(r.listing?.price)
      return { r, matchN, exact, price }
    })
  scored.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1
    if (needleCount > 0 && b.matchN !== a.matchN) return b.matchN - a.matchN
    const pa = a.price
    const pb = b.price
    if (pa !== undefined && pb !== undefined) return pa - pb
    if (pa !== undefined) return -1
    if (pb !== undefined) return 1
    return 0
  })
  const top = scored.slice(0, limit)
  const rows = top.map((s) => s.r)
  const fallbackUsed = needleCount > 0 && top.length > 0 && !top.some((s) => s.exact)

  console.log(
    '[searchTrade] fetch response items:',
    fetchedRows.length,
    'shown:',
    rows.length,
    'fallback:',
    fallbackUsed
  )

  const results: TradeListingSummary[] = rows.map((r) => {
    const sortVal = priceSortValue(r.listing?.price)
    return {
      id: r.id,
      whisper: r.listing?.whisper,
      seller: r.listing?.account?.name,
      price: formatPrice(r.listing?.price),
      priceSortValue: sortVal,
      name: r.item?.name,
      typeLine: r.item?.typeLine,
      ilvl: r.item?.ilvl,
      corrupted: r.item?.corrupted,
      note: r.item?.note,
      stats: toTradeItemStats(r.item)
    }
  })

  return {
    queryId: searchJson.id,
    total: searchJson.total,
    results,
    fallback: fallbackUsed,
    ...(fallbackUsed
      ? {
          notice:
            'No exact text-mod match in the first comparable listings — showing the closest by shared mods (cheapest within that set).'
        }
      : {}),
    raw: { search: searchJson, fetch: fetchJson, request: body, fetchUrl: lastFetchUrl }
  }
}
