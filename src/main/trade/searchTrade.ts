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
      /**
       * PoE2 adds its own mod buckets on top of the classic PoE1 set. The trade
       * fetch returns each in its own parallel field — we must read them all or
       * the hover tooltip silently hides them. Mirrors `TRADE_STAT_PREFIXES`.
       */
      desecratedMods?: string[]
      sanctifiedMods?: string[]
      scourgeMods?: string[]
      /** Flasks return their "on use" mods here, not in explicitMods. */
      utilityMods?: string[]
      logbookMods?: string[]
      /** Only present when the fetch URL was called with `pseudos[]=`. */
      pseudoMods?: string[]
      /**
       * When the standard mod buckets are missing but the fetch still returned a
       * renderable item, trade2 sometimes only fills `extended.text` (the full item
       * tooltip as plain text, base64-encoded). We prefer the typed buckets but
       * fall back to this so the hover tooltip never ends up empty.
       *
       * `hashes` is the authoritative classifier: for each mod category the API
       * lists [stat_hash, indices_into_that_category_array]. We log it when a
       * hover looks mis-categorized so we can diagnose which bucket the server
       * actually considers each line to belong to.
       */
      extended?: {
        text?: string
        hashes?: {
          explicit?: Array<[string, number[]]>
          implicit?: Array<[string, number[]]>
          rune?: Array<[string, number[]]>
          crafted?: Array<[string, number[]]>
          fractured?: Array<[string, number[]]>
          enchant?: Array<[string, number[]]>
          desecrated?: Array<[string, number[]]>
          sanctified?: Array<[string, number[]]>
          scourge?: Array<[string, number[]]>
          pseudo?: Array<[string, number[]]>
        }
      }
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

/**
 * Trade2 mod text is returned with wiki-link markup baked in, e.g.
 *   "61% increased [EnergyShield|Energy Shield]"
 *   "+23 to [Intelligence|Intelligence]"
 * We want to show only the human-readable label.
 *   "[Display|Key]"  → "Display"
 *   "[JustOne]"      → "JustOne"
 */
function stripWikiMarkup(s: unknown): string {
  const raw = typeof s === 'string' ? s : String(s ?? '')
  return raw
    .replace(/\[([^\][|]+)\|([^\][]+)\]/g, '$2')
    .replace(/\[([^\][|]+)\]/g, '$1')
    .trim()
}

function cleanModList(list?: unknown[]): string[] | undefined {
  if (!list || !list.length) return undefined
  const cleaned = list.map((l) => stripWikiMarkup(l)).filter((l) => l.length > 0)
  return cleaned.length ? cleaned : undefined
}

function isDesecratedTagged(line: string): boolean {
  return /\(desecrated\)\s*$/i.test(line)
}

/**
 * Trade2 occasionally only fills `extended.text` (the full base64 item tooltip)
 * instead of the typed mod buckets — e.g. on corrupted items with only implicit
 * variants. Keep it as a last-resort fallback so the hover is never blank.
 */
function decodeExtendedText(text?: string): string[] | undefined {
  if (!text) return undefined
  let decoded = ''
  try {
    decoded = Buffer.from(text, 'base64').toString('utf8')
  } catch {
    return undefined
  }
  const lines = decoded
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        l !== '--------' &&
        !/^item class:/i.test(l) &&
        !/^rarity:/i.test(l) &&
        !/^requires /i.test(l) &&
        !/^item level:/i.test(l) &&
        !/^quality:/i.test(l)
    )
  return lines.length ? lines : undefined
}

function toTradeItemStats(
  item?: TradeFetchApiResponse['result'][number]['item']
): TradeItemStats | undefined {
  if (!item) return undefined
  const requirements = formatNameValueLines(item.requirements)
  const properties = formatNameValueLines(item.properties)
  const implicitMods = cleanModList(item.implicitMods)
  let explicitMods = cleanModList(item.explicitMods)
  const runeMods = cleanModList(item.runeMods)
  const craftedMods = cleanModList(item.craftedMods)
  const enchantMods = cleanModList(item.enchantMods)
  const fracturedMods = cleanModList(item.fracturedMods)
  let desecratedMods = cleanModList(item.desecratedMods)
  const sanctifiedMods = cleanModList(item.sanctifiedMods)
  const scourgeMods = cleanModList(item.scourgeMods)
  const utilityMods = cleanModList(item.utilityMods)
  const logbookMods = cleanModList(item.logbookMods)
  const pseudoMods = cleanModList(item.pseudoMods)

  // Some API payloads put non-desecrated text inside `desecratedMods`.
  // Keep only explicitly tagged "(desecrated)" lines green; merge everything
  // else back into regular explicit mods.
  if (desecratedMods?.length) {
    const tagged = desecratedMods.filter(isDesecratedTagged)
    const plain = desecratedMods.filter((line) => !isDesecratedTagged(line))
    if (plain.length) {
      explicitMods = [...(explicitMods ?? []), ...plain]
    }
    desecratedMods = tagged.length ? tagged : undefined
  }

  const anyTypedMods =
    implicitMods ||
    explicitMods ||
    runeMods ||
    craftedMods ||
    enchantMods ||
    fracturedMods ||
    desecratedMods ||
    sanctifiedMods ||
    scourgeMods ||
    utilityMods ||
    logbookMods ||
    pseudoMods

  // Fallback path: server gave us no typed buckets but did include `extended.text`.
  // Decode and stash under explicitMods so the tooltip still has something to show.
  const fallbackExplicit = !anyTypedMods ? decodeExtendedText(item.extended?.text) : undefined

  const corrupted = item.corrupted === true ? true : undefined
  return {
    requirements,
    properties,
    implicitMods,
    explicitMods: explicitMods ?? fallbackExplicit,
    runeMods,
    craftedMods,
    enchantMods,
    fracturedMods,
    desecratedMods,
    sanctifiedMods,
    scourgeMods,
    utilityMods,
    logbookMods,
    pseudoMods,
    corrupted
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
    item.fracturedMods,
    item.desecratedMods,
    item.sanctifiedMods,
    item.scourgeMods,
    item.utilityMods,
    item.logbookMods
  ]
  return lists.some((a) => Array.isArray(a) && a.length > 0)
}

/** Drop corrupted listings that have no affix-style lines (tooltip would only say "Corrupted"). */
function shouldDropCorruptedBare(item?: TradeFetchApiResponse['result'][number]['item']): boolean {
  return !!item?.corrupted && !itemHasAffixLines(item)
}

/** Trade sometimes returns stubs with only name/type — nothing to show in a hover comparison. */
function fetchPayloadMissingTooltipBasics(
  item?: TradeFetchApiResponse['result'][number]['item']
): boolean {
  if (!item) return true
  if ((item.properties?.length ?? 0) > 0) return false
  if ((item.requirements?.length ?? 0) > 0) return false
  return !itemHasAffixLines(item)
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

type StatLeaf = {
  id: string
  disabled: boolean
  value?: { min?: number; max?: number | null }
}

type StatGroup = {
  /**
   * `and`: all filters must match.  `count` with `value.min: 1`: any filter matches (OR).
   * Nested groups are allowed so a hybrid mod can occupy a single outer slot while
   * still matching any of its sub-stats — awakened-poe-trade uses the same pattern.
   */
  type: 'and' | 'count' | 'not' | 'if'
  filters: Array<StatLeaf | StatGroup>
  value?: { min?: number; max?: number }
  disabled: boolean
}

type Trade2Payload = {
  query: {
    status: { option: string }
    /**
     * Item base type (e.g. "Ceremonial Robe"). Same field awakened-poe-trade
     * uses to constrain results to the same base — without it we get every chest in the category.
     */
    type?: string
    stats?: StatGroup[]
    filters: {
      type_filters: { filters: Record<string, unknown>; disabled: boolean }
      equipment_filters: { filters: Record<string, unknown>; disabled: boolean }
      req_filters?: { filters: Record<string, unknown>; disabled: boolean }
      misc_filters?: { filters: Record<string, unknown>; disabled: boolean }
    }
  }
  sort: { price: 'asc' }
}

/**
 * Trade2 stat prefixes we forward as `query.stats[].filters[].id`.
 * PoE2 adds `rune`, `desecrated`, `sanctified` on top of the classic PoE1 set.
 * Anything outside this list is a local concern (equipment_filters.*, type_filters.*, …)
 * and handled in its own branch above.
 */
const TRADE_STAT_PREFIXES = [
  'pseudo.',
  'explicit.',
  'implicit.',
  'enchant.',
  'crafted.',
  'fractured.',
  'rune.',
  'desecrated.',
  'sanctified.',
  'scourge.'
]

function isTradeStatId(id: string): boolean {
  for (const p of TRADE_STAT_PREFIXES) if (id.startsWith(p)) return true
  return false
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
    item.fracturedMods,
    item.desecratedMods,
    item.sanctifiedMods,
    item.scourgeMods,
    item.utilityMods,
    item.logbookMods
  ]
  const out: string[] = []
  for (const b of buckets)
    if (Array.isArray(b)) for (const s of b) if (typeof s === 'string') out.push(s)
  return out
}

type ClientModRule = { shape: string; min?: number; max?: number }
/** Hybrid-aware slot: a single modifier is 1 slot, even if it has multiple sub-stat rules. */
type ClientModSlot = { rules: ClientModRule[] }

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

/**
 * Count how many typed-mod _slots_ the listing satisfies. A hybrid modifier counts
 * as one slot regardless of how many sub-stats it has — matching any sub-stat line
 * on the listing satisfies the slot, mirroring the server-side nested count group.
 */
function countMatchedModSlots(item: ItemPayload, slots: ClientModSlot[]): number {
  if (!slots.length) return 0
  const lines = collectAllModTexts(item)
  let hits = 0
  for (const slot of slots) {
    if (slot.rules.some((rule) => lines.some((line) => lineMatchesModRule(line, rule)))) hits++
  }
  return hits
}

/**
 * Build one slot per `group: 'mods'` filter — including DB-matched ones. Filters
 * sharing a `modHybridGroupId` are combined into one slot with multiple rules so
 * the scoring matches the server-side nested-count semantics.
 */
function buildClientModSlots(selected: TradeFilterOption[]): ClientModSlot[] {
  const hybrid = new Map<string, ClientModRule[]>()
  const solo: ClientModSlot[] = []
  for (const f of selected) {
    if (f.group !== 'mods') continue
    const source =
      f.modSourceLine ?? (f.value?.kind === 'text' ? f.value.text : undefined) ?? f.label
    if (!source) continue
    const shape = normalizeModText(source)
    if (!shape.length) continue
    const rule: ClientModRule =
      f.value?.kind === 'number' ? { shape, min: f.value.min, max: f.value.max } : { shape }
    if (f.modHybridGroupId) {
      const arr = hybrid.get(f.modHybridGroupId) ?? []
      arr.push(rule)
      hybrid.set(f.modHybridGroupId, arr)
    } else {
      solo.push({ rules: [rule] })
    }
  }
  const slots = [...solo]
  for (const rules of hybrid.values()) slots.push({ rules })
  return slots
}

export async function searchTrade(req: TradeSearchRequest): Promise<TradeSearchResponse> {
  const baseUrl = (req.baseUrl ?? 'https://www.pathofexile.com').replace(/\/+$/, '')
  const limit = Math.max(1, Math.min(req.limit ?? 10, 50))
  console.log('[searchTrade] start', {
    baseUrl,
    league: req.league,
    limit,
    itemType: req.itemType
  })

  // PoE2 trade uses "trade2" endpoints and a query shape like:
  // POST /api/trade2/search/poe2/<league>
  // { query: { status, stats, filters }, sort }
  //
  // modSlots: one entry per typed modifier, used to build a single
  // `{ type: 'count', value: { min: K }, filters: [...] }` group. Starting K = N
  // (all mods must match), then relaxing K downward so we surface the best-matching
  // listings we actually have (8/8 → 6/8 → 4/8 → 2/8 …).
  //
  // A hybrid mod (e.g. one desecrated modifier with two sub-stats in the clipboard)
  // becomes a single slot here — a nested `{ type: 'count', min: 1, filters: [...] }`
  // group so that matching any sub-stat on the listing satisfies the whole modifier.
  const modSlots: Array<StatLeaf | StatGroup> = []
  /** Parallel client-side "this row is part of hybrid X" tracking (used for scoring). */
  const hybridSlotMembers = new Map<string, StatLeaf[]>()
  const pseudos = new Set<string>()

  const typeFilters: Record<string, unknown> = {}
  const equipFilters: Record<string, unknown> = {}
  const reqFilters: Record<string, unknown> = {}
  const miscFilters: Record<string, unknown> = {}

  function rollToValue(v?: { min?: number; max?: number }): StatLeaf['value'] | undefined {
    if (!v) return undefined
    const min = v.min
    const max = v.max
    if (min !== undefined && max !== undefined) return { min, max: max ?? null }
    if (min !== undefined) return { min }
    if (max !== undefined) return { max }
    return undefined
  }

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

    /**
     * Bracket a "min N" defence value into a ±10% window around N.
     *
     * awakened-poe-trade's price-check uses a narrow percentage range for defences
     * (see `createFilters` → `rollToFilter` in their `pathofexile-trade.ts`) so that
     * a 283-ES chest is compared against 255–311-ES chests, not 500-ES top-tier ones.
     * An open-ended `min: 283` returns much better items and overprices the result.
     */
    const bracketDefence = (
      min: number | undefined,
      max: number | undefined
    ): { min: number | null; max: number | null } => {
      if (min !== undefined && max !== undefined) return { min, max }
      if (min !== undefined) {
        return { min: Math.max(0, Math.floor(min * 0.9)), max: Math.ceil(min * 1.1) }
      }
      if (max !== undefined) return { min: null, max }
      return { min: null, max: null }
    }

    if (f.tradeId === 'equipment_filters.es' && f.value?.kind === 'number') {
      equipFilters.es = bracketDefence(f.value.min, f.value.max)
      continue
    }
    if (f.tradeId === 'equipment_filters.ar' && f.value?.kind === 'number') {
      equipFilters.ar = bracketDefence(f.value.min, f.value.max)
      continue
    }
    if (f.tradeId === 'equipment_filters.ev' && f.value?.kind === 'number') {
      equipFilters.ev = bracketDefence(f.value.min, f.value.max)
      continue
    }
    if (f.tradeId === 'equipment_filters.rune_sockets' && f.value?.kind === 'number') {
      // Exact socket count — a 3-socket chest is worth a lot more than a 2-socket one,
      // so bracketing via `min` alone pulls pricier items into the comparison set.
      const n = f.value.min ?? f.value.max
      if (n !== undefined) equipFilters.rune_sockets = { min: n, max: n }
      continue
    }

    if (isTradeStatId(f.tradeId)) {
      if (f.value?.kind !== 'number') continue
      // Rune-granted lines live in the item-properties group. Runes are consumables
      // the buyer can apply themselves, so matching against another listing's
      // _explicit_ roll of the same shape would require a much rarer (and pricier)
      // item. Skip them entirely from stat matching — they're UI-only rows.
      if (f.group === 'item' || f.modTag === 'rune') continue
      const leafValue = rollToValue(f.value)
      if (!leafValue) continue

      const ids = f.tradeIds && f.tradeIds.length > 0 ? f.tradeIds : [f.tradeId]
      for (const id of ids) if (id.startsWith('pseudo.')) pseudos.add(id)

      const leaf: StatLeaf = { id: ids[0], disabled: false, value: leafValue }

      if (f.modHybridGroupId) {
        // Accumulate — finalized into one nested count group after the loop.
        const arr = hybridSlotMembers.get(f.modHybridGroupId) ?? []
        arr.push(leaf)
        hybridSlotMembers.set(f.modHybridGroupId, arr)
      } else {
        // Primary id only — the count-group relax plan (K-of-N) is cheaper to reason
        // about than nested OR groups, and primary is the DB's best guess.
        modSlots.push(leaf)
      }
    }
  }

  // Collapse each hybrid group into a single slot. Two or more sub-stats of the same
  // modifier co-occur on the listing, so `count:{min:1}` is the correct server-side
  // test — it evaluates to true iff _any_ of the sub-stats match, i.e. the hybrid mod
  // is present with its declared rolls.
  for (const members of hybridSlotMembers.values()) {
    if (members.length === 1) {
      modSlots.push(members[0])
    } else {
      modSlots.push({
        type: 'count',
        value: { min: 1 },
        disabled: false,
        filters: members
      })
    }
  }

  // Used for client-side scoring of fetched rows (6/6 vs 5/6 vs 4/6 etc.)
  const clientModSlots = buildClientModSlots(req.selectedFilters)

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

  type RelaxStep = {
    /** K in "K-of-N mods must match". 0 = stats dropped entirely. */
    minMatch: number
    withItemType: boolean
  }

  function buildBody(step: RelaxStep): Trade2Payload {
    const stats: StatGroup[] = []
    if (step.minMatch > 0 && modSlots.length > 0) {
      stats.push({
        type: 'count',
        value: { min: step.minMatch },
        disabled: false,
        filters: modSlots
      })
    }
    return {
      query: {
        status: { option: 'securable' },
        ...(step.withItemType && req.itemType && req.itemType.trim().length
          ? { type: req.itemType.trim() }
          : {}),
        ...(stats.length ? { stats } : {}),
        filters
      },
      sort: { price: 'asc' }
    }
  }

  const searchUrl = `${baseUrl}/api/trade2/search/poe2/${encodeURIComponent(req.league)}`

  async function doSearch(body: Trade2Payload): Promise<TradeSearchApiResponse> {
    console.log('[searchTrade] POST payload:', JSON.stringify(body))
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
    return searchRes.json
  }

  const hasItemType = !!(req.itemType && req.itemType.trim().length)
  const modCount = modSlots.length
  /**
   * Relax plan — MINIMAL ladder. PoE2 trade search is rate limited at roughly
   * 5-8 hits per 10 seconds per IP; firing 10+ search POSTs back-to-back guarantees
   * a 429 storm that stalls the UI for a full minute on `Retry-After`.
   *
   * So we only try at most 4 search POSTs per user action:
   *  1. strict:  type + all mods (K=N)
   *  2. medium:  type + ⌈N/2⌉ mods
   *  3. loose:   no type + K=1 (any mod matches)
   *  4. last:    no type + no stats (bare category/defence shell)
   * Each step that already returns enough listings breaks the loop early.
   */
  const relaxPlan: RelaxStep[] = []
  if (modCount > 0 && hasItemType) {
    relaxPlan.push({ minMatch: modCount, withItemType: true })
    const half = Math.max(1, Math.ceil(modCount / 2))
    if (half !== modCount) relaxPlan.push({ minMatch: half, withItemType: true })
  } else if (modCount > 0) {
    relaxPlan.push({ minMatch: modCount, withItemType: false })
  } else if (hasItemType) {
    relaxPlan.push({ minMatch: 0, withItemType: true })
  }
  if (modCount > 0) {
    relaxPlan.push({ minMatch: 1, withItemType: false })
  }
  relaxPlan.push({ minMatch: 0, withItemType: false })

  /**
   * Target pool for client-side ranking. Smaller than before (was 30) — we need just
   * enough variety to rank, not an exhaustive scrape, and every extra step is one
   * more /search POST counting against the rate budget.
   */
  const poolTarget = clientModSlots.length ? Math.max(limit + 5, 12) : limit
  /** Stop early once we have at least this many — reranking doesn't need poolTarget. */
  const earlyStopAt = Math.max(limit, 8)
  /** Minimum gap between /search POSTs to stay under ~5 req/10s. */
  const searchStepDelayMs = 900

  // Each listing's "step index" in the ladder — smaller is a stricter match.
  // Used both for the notice (was there an exact hit?) and to prefer stricter hits
  // when the id shows up in multiple relax steps (it always will — a K=8 match also
  // matches K=6, K=4, etc.).
  const idFirstSeenStep = new Map<string, number>()
  const aggregatedIds: string[] = []
  let strictestHitSearchJson: TradeSearchApiResponse | undefined
  let strictestHitStep: RelaxStep | undefined
  let lastSearchJson: TradeSearchApiResponse | undefined
  let usedStep: RelaxStep = relaxPlan[0]
  let body = buildBody(relaxPlan[0])

  for (let i = 0; i < relaxPlan.length; i++) {
    const step = relaxPlan[i]
    if (i > 0) {
      console.log(
        `[searchTrade] have ${aggregatedIds.length} (target ${poolTarget}) — widening to { minMatch: ${step.minMatch}, withItemType: ${step.withItemType} }`
      )
      // Throttle between POSTs; PoE2 /search allows only ~5/10s per IP.
      await new Promise((r) => setTimeout(r, searchStepDelayMs))
    }
    body = buildBody(step)
    const stepSearchJson = await doSearch(body)
    lastSearchJson = stepSearchJson
    usedStep = step

    const ids = stepSearchJson.result ?? []
    let addedHere = 0
    for (const id of ids) {
      if (idFirstSeenStep.has(id)) continue
      idFirstSeenStep.set(id, i)
      aggregatedIds.push(id)
      addedHere++
      if (aggregatedIds.length >= poolTarget) break
    }
    console.log(
      `[searchTrade] step #${i} minMatch=${step.minMatch} withItemType=${step.withItemType} — total=${stepSearchJson.total}, added ${addedHere}, pool=${aggregatedIds.length}`
    )

    if ((stepSearchJson.total ?? 0) > 0 && strictestHitStep === undefined) {
      strictestHitStep = step
      strictestHitSearchJson = stepSearchJson
    }

    // Early exit: as soon as we have a usable pool, stop burning rate limit budget.
    if (aggregatedIds.length >= earlyStopAt) break
  }

  // Strictest step that actually matched anything is what the UI should describe —
  // a widened pool including K=1 listings shouldn't advertise "matched 1/N" when a
  // K=N hit also exists. Fall back to the last response so `total`/`id` are defined
  // even when no step returned anything.
  if (strictestHitStep) usedStep = strictestHitStep
  const searchJson = strictestHitSearchJson ?? lastSearchJson!

  const relaxedFromItemType = !usedStep.withItemType && hasItemType
  const relaxedFromStats = modCount > 0 && usedStep.minMatch === 0
  const relaxedMinMatch = modCount > 0 ? usedStep.minMatch : undefined

  console.log('[searchTrade] aggregated search result:', {
    id: searchJson.id,
    totalAtStrictestHit: searchJson.total,
    aggregatedIds: aggregatedIds.length,
    usedStep,
    relaxedFromItemType,
    relaxedFromStats
  })

  const allIds = aggregatedIds.slice(0, poolTarget)

  if (allIds.length === 0) {
    return { queryId: searchJson.id, total: searchJson.total, results: [], raw: searchJson }
  }

  const FETCH_CHUNK_SIZE = 10
  /** Short pause between fetch GETs to reduce 429s; small pool keeps search snappy. */
  const delayBetweenFetchChunksMs = clientModSlots.length ? 140 : 0
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

  // Diagnostic dump — which mod bucket the API put each line in, for every
  // listing. If a hover looks miscategorised ("all explicits appearing under
  // Desecrated"), this is the one place that tells us whether our tooltip
  // logic or the server itself did the wrong thing.
  for (const r of fetchedRows) {
    const it = r.item
    if (!it) continue
    const buckets = {
      implicit: it.implicitMods?.length ?? 0,
      explicit: it.explicitMods?.length ?? 0,
      rune: it.runeMods?.length ?? 0,
      crafted: it.craftedMods?.length ?? 0,
      enchant: it.enchantMods?.length ?? 0,
      fractured: it.fracturedMods?.length ?? 0,
      desecrated: it.desecratedMods?.length ?? 0,
      sanctified: it.sanctifiedMods?.length ?? 0,
      scourge: it.scourgeMods?.length ?? 0,
      utility: it.utilityMods?.length ?? 0,
      logbook: it.logbookMods?.length ?? 0,
      pseudo: it.pseudoMods?.length ?? 0
    }
    const hashCounts = it.extended?.hashes
      ? Object.fromEntries(
          Object.entries(it.extended.hashes).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
        )
      : undefined
    console.log('[searchTrade] item buckets', {
      id: r.id?.slice(0, 10),
      name: it.name,
      typeLine: it.typeLine,
      buckets,
      hashCounts,
      desecratedText: it.desecratedMods,
      explicitText: it.explicitMods
    })
  }

  const fetchJson: TradeFetchApiResponse = { result: fetchedRows }

  const needleCount = clientModSlots.length
  if (clientModSlots.length) {
    console.log(
      '[searchTrade] client mod slots (ranking):',
      clientModSlots.map((s) => ({
        rules: s.rules.map((r) => ({ shape: r.shape, min: r.min, max: r.max }))
      }))
    )
  }

  /**
   * Cleanup filters. We log the reason each dropped row was dropped — if the trade API
   * returns a tiny pool (e.g. 1 result at minMatch=2) we never want the user to see
   * "0 shown", so we only drop rows that are genuinely unrenderable (no id/listing).
   * Older heuristics (`fetchPayloadMissingTooltipBasics`, `shouldDropCorruptedBare`) are
   * retained as _downrank_ signals instead of hard drops when the pool is small.
   */
  const poolIsSmall = fetchedRows.length <= 3
  const dropReason = (r: TradeFetchApiResponse['result'][number]): string | undefined => {
    if (!r || !r.id) return 'missing-id'
    if (!r.listing || !r.listing.price) return 'no-price'
    if (poolIsSmall) return undefined
    if (fetchPayloadMissingTooltipBasics(r.item)) return 'sparse-item-payload'
    if (shouldDropCorruptedBare(r.item)) return 'corrupted-no-affixes'
    return undefined
  }
  const droppedForReason = new Map<string, number>()
  const kept = fetchedRows.filter((r) => {
    const reason = dropReason(r)
    if (reason) {
      droppedForReason.set(reason, (droppedForReason.get(reason) ?? 0) + 1)
      return false
    }
    return true
  })
  if (droppedForReason.size) {
    console.log(
      '[searchTrade] dropped fetch rows:',
      Object.fromEntries(droppedForReason),
      'poolIsSmall:',
      poolIsSmall
    )
  }

  const scored = kept.map((r) => {
    const matchN = countMatchedModSlots(r.item, clientModSlots)
    const exact = needleCount > 0 && matchN === needleCount
    const price = priceSortValue(r.listing?.price)
    return { r, matchN, exact, price }
  })
  // Rank: most matched mods first (so 6/6 beats 5/6 beats 4/6), then cheapest within
  // the same bucket. This mirrors the relax ladder above — the API returned things that
  // have _at least_ K matches, and here we pull those with more matches to the top.
  scored.sort((a, b) => {
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
  const bestMatchN = top.reduce((m, s) => Math.max(m, s.matchN), 0)

  console.log('[searchTrade] scored candidates (all fetched, sorted):', scored.length)
  scored.forEach((s, i) => {
    const it = s.r.item
    const label = [it?.name, it?.typeLine].filter(Boolean).join(' / ') || '(no name)'
    console.log(`[searchTrade]   pool #${i + 1}`, {
      label,
      price: formatPrice(s.r.listing?.price),
      chaosEquiv: s.price,
      matchN: s.matchN,
      rulesTotal: needleCount,
      exact: s.exact,
      listingId: s.r.id
    })
  })

  console.log('[searchTrade] final listings (shown in UI):', top.length)
  top.forEach((s, i) => {
    const it = s.r.item
    const label = [it?.name, it?.typeLine].filter(Boolean).join(' / ') || '(no name)'
    console.log(`[searchTrade]   UI #${i + 1}`, {
      label,
      price: formatPrice(s.r.listing?.price),
      chaosEquiv: s.price,
      matchN: s.matchN,
      rulesTotal: needleCount,
      exact: s.exact,
      seller: s.r.listing?.account?.name
    })
  })

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

  const notices: string[] = []
  if (relaxedFromItemType && !relaxedFromStats) {
    notices.push(
      `No listings matched the exact base type "${req.itemType}". Showing results from the broader category instead.`
    )
  }
  if (relaxedFromStats) {
    notices.push(
      'No listings matched any of the selected mods. Showing same-category listings so you can compare bases — try unticking some mods and search again.'
    )
  } else if (relaxedMinMatch !== undefined && modCount > 0 && relaxedMinMatch < modCount) {
    notices.push(
      `No listings matched all ${modCount} selected mods. Showing listings matching the best we could find (at least ${relaxedMinMatch}/${modCount}, best here: ${bestMatchN}/${modCount}).`
    )
  }

  return {
    queryId: searchJson.id,
    total: searchJson.total,
    results,
    fallback: fallbackUsed || relaxedFromItemType || relaxedFromStats,
    ...(notices.length ? { notice: notices.join(' ') } : {}),
    raw: { search: searchJson, fetch: fetchJson, request: body, fetchUrl: lastFetchUrl }
  }
}
