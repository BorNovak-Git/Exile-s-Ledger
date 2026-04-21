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
  /**
   * From advanced item copy (Prefix/Suffix modifier lines). Omitted when unknown.
   */
  modAffix?: 'prefix' | 'suffix'
  /**
   * Original mod line from clipboard when this row is matched client-side (no `tradeId`).
   * Used with `value` numeric min/max to tighten roll checks while keeping the mod shape.
   */
  modSourceLine?: string
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
  /** PoE2 socketed rune / augment lines when present on fetch payload */
  runeMods?: string[]
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
  /**
   * Approximate chaos equivalent for sorting (lowest = cheapest). Omitted when unpriced.
   */
  priceSortValue?: number
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
  /**
   * When true, no listings matched every required text mod and the results are the closest
   * available candidates (scored by how many mods they share, then price).
   */
  fallback?: boolean
  /** Optional short note to show the user (e.g. "No exact matches — showing closest"). */
  notice?: string
  raw?: unknown
}

export type ApiErrorShape = {
  message: string
  details?: unknown
}
