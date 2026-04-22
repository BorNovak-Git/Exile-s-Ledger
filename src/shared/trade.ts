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
   * When one clipboard mod matches several trade stat ids (e.g. the same text exists
   * as `explicit.stat_X` and `rune.stat_Y`), we send them all as an OR group
   * (trade2 `{ type: 'count', value: { min: 1 } }`). Populated from the PoE2 stats DB.
   * `tradeId` stays set to the primary id for UI/labelling purposes.
   */
  tradeIds?: string[]
  /**
   * From advanced item copy (Prefix/Suffix modifier lines). Omitted when unknown.
   */
  modAffix?: 'prefix' | 'suffix'
  /**
   * Original mod line from clipboard when this row is matched client-side (no `tradeId`).
   * Used with `value` numeric min/max to tighten roll checks while keeping the mod shape.
   */
  modSourceLine?: string
  /**
   * UI: rune/desecrated lines use the same chip treatment as Corrupted on the item card.
   */
  modTag?: 'rune' | 'desecrated'
  /**
   * Populated when the clipboard lines of a single hybrid modifier produce multiple filter
   * rows (e.g. one desecrated mod with two sub-stats: `+X to max ES` and `Y% increased ES`).
   *
   * Filters sharing this id are siblings of the same real modifier; the trade search counts
   * them as ONE slot (so a 7-mod item with one hybrid desecrated mod is still "7 mods" to
   * match, not "8"). Each sibling keeps its own slider because each sub-roll is independent.
   */
  modHybridGroupId?: string
  /**
   * Primary numeric roll parsed from the item for this row (threshold slider high end when no tier range).
   */
  modRoll?: number
  /**
   * Tier roll span when the clipboard line includes it, e.g. `(120–160)`. Slider endpoints use this;
   * otherwise {@link modRoll} defines the top of the bar (match-this-item ceiling).
   */
  modRollBounds?: { min: number; max: number }
  /**
   * `1` = higher-is-better (positive stats — ES, spirit, resistances), `-1` = lower-is-better
   * (negative stats — attribute requirements, cost multipliers), `0` = unranked.
   *
   * Sourced from the bundled PoE2 mods DB. The search builder uses this to pick between
   * `{ min: roll }` and `{ max: roll }` on the server-side filter, so a -12% Str req
   * row doesn't accidentally ask the server for "at least -12% strength required".
   */
  statBetter?: 1 | -1 | 0
  /**
   * Pseudo trade ids for this stat, when EE2's data publishes one. When present, the
   * search prefers the pseudo id over the raw explicit/implicit/rune set to collapse
   * multi-source mods (e.g. all resistance tiers) into a single server filter.
   */
  pseudoTradeIds?: string[]
  /**
   * Initial ticked/unticked state when the filters are first shown. Rare-item explicit
   * mods default to un-ticked (following Exiled-Exchange-2 / APT), because searching for
   * every explicit from a rare drops hit counts to zero — the user picks the 2-3 mods
   * that actually drive the price.
   */
  defaultEnabled?: boolean
  /**
   * Live ticked/unticked state. When the renderer calls `trade:search`, disabled rows
   * aren't even sent into the request — same effect as unchecking in the UI. Present
   * only on the request payload; the parser sets `defaultEnabled` instead.
   */
  enabled?: boolean
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
  /**
   * Parsed item base type (e.g. "Ceremonial Robe"). When present we constrain
   * results to the same base so ES/AR/EV ranges and prices stay comparable.
   * Same approach as awakened-poe-trade's `query.type`.
   */
  itemType?: string
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
  /** PoE2 desecrated modifiers (well of souls / unholy). */
  desecratedMods?: string[]
  /** PoE2 sanctified modifiers (sanctum / sanctified relics). */
  sanctifiedMods?: string[]
  /** PoE2 scourge modifiers. */
  scourgeMods?: string[]
  /** Flask "utility" mods (flask-granted auras / charges). */
  utilityMods?: string[]
  /** Logbook / expedition mods. */
  logbookMods?: string[]
  /** Server-returned pseudo stats (only present when the fetch is called with `pseudos[]`). */
  pseudoMods?: string[]
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
