import type { TradeItemStats, TradeListingSummary, TradeSearchRequest, TradeSearchResponse } from '../../shared/trade'
import { netRequestJson, netRequestText } from './netHttp'

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

function formatPrice(price?: { type?: string; amount?: number; currency?: string }): string | undefined {
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

function toTradeItemStats(item?: TradeFetchApiResponse['result'][number]['item']): TradeItemStats | undefined {
  if (!item) return undefined
  const requirements = formatNameValueLines(item.requirements)
  const properties = formatNameValueLines(item.properties)
  const implicitMods = item.implicitMods?.length ? item.implicitMods : undefined
  const explicitMods = item.explicitMods?.length ? item.explicitMods : undefined
  const craftedMods = item.craftedMods?.length ? item.craftedMods : undefined
  const enchantMods = item.enchantMods?.length ? item.enchantMods : undefined
  const fracturedMods = item.fracturedMods?.length ? item.fracturedMods : undefined

  if (
    !requirements &&
    !properties &&
    !implicitMods &&
    !explicitMods &&
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
    craftedMods,
    enchantMods,
    fracturedMods,
    corrupted: item.corrupted
  }
}

type Trade2Payload = {
  query: {
    status: { option: string }
    stats?: Array<{
      type: 'and'
      filters: Array<{ id: string; disabled: boolean; value?: { min?: number; max?: number } }>
      disabled: boolean
    }>
    filters?: {
      type_filters?: {
        filters: {
          rarity?: { option: string }
          category?: { option: string }
        }
        disabled: boolean
      }
      equipment_filters?: {
        filters: {
          es?: { min?: number; max?: number | null }
          rune_sockets?: { min?: number; max?: number | null }
        }
        disabled: boolean
      }
    }
  }
  sort: { price: 'asc' }
}

function isTradeStatId(id: string): boolean {
  return id.startsWith('pseudo.') || id.startsWith('explicit.') || id.startsWith('implicit.') || id.startsWith('rune.')
}

export async function searchTrade(req: TradeSearchRequest): Promise<TradeSearchResponse> {
  const baseUrl = (req.baseUrl ?? 'https://www.pathofexile.com').replace(/\/+$/, '')
  const limit = Math.max(1, Math.min(req.limit ?? 10, 50))
  console.log('[searchTrade] start', { baseUrl, league: req.league, limit })

  // PoE2 trade uses "trade2" endpoints and a query shape like:
  // POST /api/trade2/search/poe2/<league>
  // { query: { status, stats, filters }, sort }
  const statFilters: Array<{ id: string; disabled: boolean; value?: { min?: number; max?: number } }> = []
  const pseudos = new Set<string>()

  let rarityOption: string | undefined
  let categoryOption: string | undefined
  let esMin: number | undefined
  let runeSocketsMin: number | undefined

  for (const f of req.selectedFilters) {
    if (!f.tradeId) continue

    if (f.tradeId === 'type_filters.rarity') {
      if (f.value?.kind === 'text') rarityOption = f.value.text
      continue
    }
    if (f.tradeId === 'type_filters.category') {
      if (f.value?.kind === 'text') categoryOption = f.value.text
      continue
    }
    if (f.tradeId === 'equipment_filters.es') {
      if (f.value?.kind === 'number') esMin = f.value.min
      continue
    }
    if (f.tradeId === 'equipment_filters.rune_sockets') {
      if (f.value?.kind === 'number') runeSocketsMin = f.value.min
      continue
    }

    if (isTradeStatId(f.tradeId)) {
      const value =
        f.value?.kind === 'number'
          ? { min: f.value.min, max: f.value.max }
          : undefined
      statFilters.push({ id: f.tradeId, disabled: false, value })
      if (f.tradeId.startsWith('pseudo.')) pseudos.add(f.tradeId)
    }
  }

  const body: Trade2Payload = {
    query: {
      status: { option: 'securable' },
      ...(statFilters.length
        ? { stats: [{ type: 'and', filters: statFilters, disabled: false }] }
        : {}),
      filters: {
        type_filters: {
          filters: {
            ...(rarityOption ? { rarity: { option: rarityOption } } : {}),
            ...(categoryOption ? { category: { option: categoryOption } } : {})
          },
          disabled: false
        },
        equipment_filters: {
          filters: {
            ...(esMin !== undefined ? { es: { min: esMin, max: null } } : {}),
            ...(runeSocketsMin !== undefined ? { rune_sockets: { min: runeSocketsMin, max: null } } : {})
          },
          disabled: false
        }
      }
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
    throw new Error(
      `Trade search failed (${searchRes.status}). If this is a Cloudflare block, click "Connect to trade site" in the app once, then retry.\n\n${bodyPreview}`
    )
  }

  const searchJson = searchRes.json
  console.log('[searchTrade] search response:', { id: searchJson.id, total: searchJson.total, results: searchJson.result?.length })
  const ids = (searchJson.result ?? []).slice(0, limit)

  if (ids.length === 0) {
    return { queryId: searchJson.id, total: searchJson.total, results: [], raw: searchJson }
  }

  const fetchUrl = new URL(
    `${baseUrl}/api/trade2/fetch/${ids.map(encodeURIComponent).join(',')}`
  )
  fetchUrl.searchParams.set('query', searchJson.id)
  fetchUrl.searchParams.set('realm', 'poe2')
  for (const p of pseudos) fetchUrl.searchParams.append('pseudos[]', p)

  console.log('[searchTrade] fetch url:', fetchUrl.toString())
  const fetchRes = await netRequestText({ url: fetchUrl.toString(), method: 'GET' })
  console.log('[searchTrade] fetch status:', fetchRes.status)
  if (fetchRes.status < 200 || fetchRes.status >= 300) {
    const bodyPreview = (fetchRes.text ?? '').slice(0, 400)
    throw new Error(`Trade fetch failed (${fetchRes.status}).\n\n${bodyPreview}`)
  }

  let fetchJson: TradeFetchApiResponse
  try {
    fetchJson = JSON.parse(fetchRes.text) as TradeFetchApiResponse
  } catch (e) {
    throw new Error('Trade fetch returned non-JSON response.')
  }
  console.log('[searchTrade] fetch response items:', fetchJson.result?.length ?? 0)
  const results: TradeListingSummary[] = (fetchJson.result ?? []).map((r) => ({
    id: r.id,
    whisper: r.listing?.whisper,
    seller: r.listing?.account?.name,
    price: formatPrice(r.listing?.price),
    name: r.item?.name,
    typeLine: r.item?.typeLine,
    ilvl: r.item?.ilvl,
    corrupted: r.item?.corrupted,
    note: r.item?.note,
    stats: toTradeItemStats(r.item)
  }))

  return {
    queryId: searchJson.id,
    total: searchJson.total,
    results,
    raw: { search: searchJson, fetch: fetchJson, request: body, fetchUrl: fetchUrl.toString() }
  }
}

