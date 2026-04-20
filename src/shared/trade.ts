export type TradeFilterValue =
  | { kind: 'text'; text: string }
  | { kind: 'number'; min?: number; max?: number }

export type TradeFilterOption = {
  id: string
  label: string
  group: 'item' | 'requirements' | 'defences' | 'mods' | 'misc'
  value?: TradeFilterValue
  /**
   * If present, this is the concrete trade API field/stat id.
   * For the prototype we allow leaving this undefined and falling back to term search.
   */
  tradeId?: string
}

export type ParseItemTextResponse = {
  itemName?: string
  itemType?: string
  filters: TradeFilterOption[]
}

export type TradeSearchRequest = {
  league: string
  baseUrl?: string
  selectedFilters: TradeFilterOption[]
  /**
   * Optional free-text term; useful while tradeId mapping is incomplete.
   */
  term?: string
  limit?: number
}

export type TradeItemStats = {
  requirements?: string[]
  properties?: string[]
  implicitMods?: string[]
  explicitMods?: string[]
  craftedMods?: string[]
  enchantMods?: string[]
  fracturedMods?: string[]
  corrupted?: boolean
}

export type TradeListingSummary = {
  id: string
  whisper?: string
  seller?: string
  price?: string
  name?: string
  typeLine?: string
  ilvl?: number
  corrupted?: boolean
  note?: string
  stats?: TradeItemStats
}

export type TradeSearchResponse = {
  queryId?: string
  total?: number
  results: TradeListingSummary[]
  raw?: unknown
}

export type ApiErrorShape = {
  message: string
  details?: unknown
}
