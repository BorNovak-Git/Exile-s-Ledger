import type { ParseItemTextResponse, TradeFilterOption } from '../../shared/trade'
import { getT1MaxForGroup } from './modT1Maxes'
import { findStatsForMod, parseSourceTag } from './poe2StatsDb'

function modTagFromLine(line: string): 'rune' | 'desecrated' | undefined {
  const t = parseSourceTag(line)?.toLowerCase()
  if (t === 'rune' || t === 'desecrated') return t
  return undefined
}

/**
 * Drops PoE's inline tier ranges so the visible label stays clean.
 *
 * With "Advanced Mod Descriptions" enabled in the PoE2 client, mod lines arrive as
 * `+47(40-55) to maximum Energy Shield` — the value glued to a `(min-max)` tier range.
 * That range is captured separately by `extractRollBounds`; we don't want to repeat it
 * in the UI label.
 */
function stripInlineRollRanges(line: string): string {
  return line.replace(/\(\s*-?\d+(?:\.\d+)?\s*[-–]\s*-?\d+(?:\.\d+)?\s*\)/g, '').replace(/\s{2,}/g, ' ').trim()
}

function displayModLabel(line: string, tag: 'rune' | 'desecrated' | undefined): string {
  let out = stripInlineRollRanges(line)
  if (tag) out = out.replace(/\s*\((rune|desecrated)\)\s*$/i, '').trim()
  return out
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

function parseNumberAfter(prefix: string, line: string): number | undefined {
  if (!line.toLowerCase().startsWith(prefix.toLowerCase())) return undefined
  const rest = line.slice(prefix.length).trim()
  const m = rest.match(/(-?\d+(\.\d+)?)/)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

function pushIfDefined<T>(arr: T[], value: T | undefined): void {
  if (value !== undefined) arr.push(value)
}

function findLine(lines: string[], re: RegExp): string | undefined {
  return lines.find((l) => re.test(l))
}

function parseRarity(lines: string[]): string | undefined {
  const ln = findLine(lines, /^rarity:/i)
  if (!ln) return undefined
  const v = ln.split(':', 2)[1]?.trim().toLowerCase()
  if (!v) return undefined
  if (v.includes('rare')) return 'rare'
  if (v.includes('magic')) return 'magic'
  if (v.includes('unique')) return 'unique'
  if (v.includes('normal')) return 'normal'
  return v
}

function parseItemClass(lines: string[]): string | undefined {
  const ln = findLine(lines, /^item class:/i)
  if (!ln) return undefined
  return ln.split(':', 2)[1]?.trim()
}

/**
 * Maps in-game `Item Class:` text to PoE2 trade `type_filters.category` option ids
 * (see https://www.pathofexile.com/api/trade2/data/filters?realm=poe2).
 */
function poe2CategoryFromItemClass(itemClass: string | undefined): string | undefined {
  const raw = (itemClass ?? '').trim()
  if (!raw) return undefined
  const n = raw.toLowerCase().replace(/\s+/g, ' ')

  const exact: Record<string, string> = {
    boots: 'armour.boots',
    gloves: 'armour.gloves',
    helmet: 'armour.helmet',
    helmets: 'armour.helmet',
    'body armour': 'armour.chest',
    'body armours': 'armour.chest',
    shield: 'armour.shield',
    shields: 'armour.shield',
    buckler: 'armour.buckler',
    bucklers: 'armour.buckler',
    focus: 'armour.focus',
    foci: 'armour.focus',
    quiver: 'armour.quiver',
    quivers: 'armour.quiver',
    sceptre: 'weapon.sceptre',
    sceptres: 'weapon.sceptre',
    wand: 'weapon.wand',
    wands: 'weapon.wand',
    staff: 'weapon.staff',
    staves: 'weapon.staff',
    bow: 'weapon.bow',
    bows: 'weapon.bow',
    crossbow: 'weapon.crossbow',
    crossbows: 'weapon.crossbow',
    claw: 'weapon.claw',
    claws: 'weapon.claw',
    dagger: 'weapon.dagger',
    daggers: 'weapon.dagger',
    spear: 'weapon.spear',
    spears: 'weapon.spear',
    flail: 'weapon.flail',
    flails: 'weapon.flail',
    talisman: 'weapon.talisman',
    talismans: 'weapon.talisman',
    ring: 'accessory.ring',
    rings: 'accessory.ring',
    amulet: 'accessory.amulet',
    amulets: 'accessory.amulet',
    belt: 'accessory.belt',
    belts: 'accessory.belt',
    'life flask': 'flask.life',
    'life flasks': 'flask.life',
    'mana flask': 'flask.mana',
    'mana flasks': 'flask.mana',
    jewel: 'jewel',
    jewels: 'jewel',
    'fishing rod': 'weapon.rod',
    'fishing rods': 'weapon.rod',
    quarterstaff: 'weapon.warstaff',
    quarterstaves: 'weapon.warstaff',
    warstaff: 'weapon.warstaff',
    warstaves: 'weapon.warstaff'
  }
  if (exact[n]) return exact[n]

  if (n.includes('quarter')) return 'weapon.warstaff'
  if (n.includes('sceptre')) return 'weapon.sceptre'
  if (n.includes('fishing')) return 'weapon.rod'

  if (n.includes('two hand') || n.includes('two-hand')) {
    if (n.includes('sword')) return 'weapon.twosword'
    if (n.includes('axe')) return 'weapon.twoaxe'
    if (n.includes('mace')) return 'weapon.twomace'
  }
  if (n.includes('one hand') || n.includes('one-hand')) {
    if (n.includes('sword')) return 'weapon.onesword'
    if (n.includes('axe')) return 'weapon.oneaxe'
    if (n.includes('mace')) return 'weapon.onemace'
  }

  if (n.includes('warstaff')) return 'weapon.warstaff'
  if (n.includes('staff') || n.includes('stave')) return 'weapon.staff'

  if (n.includes('waystone')) return 'map.waystone'

  return undefined
}

function parseSocketsRuneCount(lines: string[]): number | undefined {
  const ln = findLine(lines, /^sockets:/i)
  if (!ln) return undefined
  // PoE2 clipboard shows "Sockets: S" for a single rune socket in your sample.
  const after = ln.split(':', 2)[1]?.trim() ?? ''
  const runeCount = (after.match(/S/g) ?? []).length
  return runeCount > 0 ? runeCount : undefined
}

function parseModNumber(line: string): number | undefined {
  const m = line.match(/(-?\d+(\.\d+)?)/)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

/**
 * Finds the *first* `(min-max)` tier range on the line — inline or trailing.
 *
 * Awakened-poe-trade's parser does the same thing: when the player has "Advanced Mod
 * Descriptions" turned on in the PoE client, every value in a mod line is followed by
 * its tier range glued in parentheses, e.g.
 *   `+47(40-55) to maximum Energy Shield`
 *   `58(50-70) to 62(55-75) Physical Thorns damage`
 * The first range is the one bound to the value we use as the slider's roll, so that's
 * what we hand back. Square-bracket and trailing variants are kept for forwards
 * compatibility (some clipboards / tooling produce `[min-max]` or trailing ranges).
 */
function extractRollBounds(line: string): { min: number; max: number } | undefined {
  const inline = line.match(/\(\s*(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)\s*\)/)
  if (inline) {
    const a = Number(inline[1])
    const b = Number(inline[2])
    if (Number.isFinite(a) && Number.isFinite(b))
      return a <= b ? { min: a, max: b } : { min: b, max: a }
  }
  const bracket = line.match(/\[\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*\]/)
  if (bracket) {
    const a = Number(bracket[1])
    const b = Number(bracket[2])
    if (Number.isFinite(a) && Number.isFinite(b))
      return a <= b ? { min: a, max: b } : { min: b, max: a }
  }
  return undefined
}

/**
 * Produces the slider metadata for a mod line.
 *
 * The slider's max is the **T1 roll ceiling for the mod as a whole**, not just
 * the tier on this particular item — i.e. if the user has a T5 "+# to maximum
 * Energy Shield" roll, the slider still stretches up to the T1 max (~89) so
 * they can compare against the global best possible roll. Priority order:
 *
 *   1. Prebuilt `t1MaxRolls.json` lookup keyed by trade stat id (shipped with
 *      the app, generated from LocalIdentity's poe2-data + EE2 stats).
 *   2. Inline `(min-max)` tier range from the clipboard when "Advanced Mod
 *      Descriptions" is enabled in PoE2 — only covers the item's own tier but
 *      is the best we can do when a mod is missing from the bundled data.
 *   3. `Math.max(roll, 1)` as a last-resort floor so the slider is still
 *      usable even without any metadata.
 *
 * `min` stays at 0 in the common case — users dialing the slider upwards is
 * the natural interaction. We only shrink below 0 if the item's roll is
 * negative (e.g. debuff-style mods) or the clipboard tier's `min` is below 0.
 */
function rollMetaFromLine(
  roll: number,
  line: string,
  tradeIds?: readonly string[]
): { modRoll: number; modRollBounds: { min: number; max: number } } {
  const bounds = extractRollBounds(line)
  const r = Math.floor(roll)
  const t1 = getT1MaxForGroup(tradeIds)

  if (t1 !== undefined) {
    // Accept the bundled data as the ceiling, but never below the item's own
    // roll — legacy/divine-pending rolls can technically sit above the
    // current-patch T1, and the slider must still be able to represent them.
    const max = Math.max(t1, r)
    const min = bounds && bounds.min < 0 ? Math.min(bounds.min, r, 0) : Math.min(r, 0)
    return { modRoll: r, modRollBounds: { min, max } }
  }

  if (!bounds) return { modRoll: r, modRollBounds: { min: Math.min(r, 0), max: Math.max(r, 1) } }
  return {
    modRoll: r,
    modRollBounds: { min: Math.min(bounds.min, r, 0), max: Math.max(bounds.max, r) }
  }
}

export function parseItemText(text: string): ParseItemTextResponse {
  console.log('[parseItemText] start')
  const rawLines = text.split(/\r?\n/)
  const lines = rawLines.map(normalizeLine).filter((l) => l.length > 0)
  console.log('[parseItemText] lines:', lines.length)

  let itemName: string | undefined
  let itemType: string | undefined

  // Heuristic for PoE-style clipboard text:
  // Rarity: X
  // <name>
  // <type>
  const rarityIdx = lines.findIndex((l) => /^rarity:/i.test(l))
  if (rarityIdx >= 0) {
    itemName = lines[rarityIdx + 1]
    itemType = lines[rarityIdx + 2]
  } else {
    itemName = lines[0]
    itemType = lines[1]
  }

  const filters: TradeFilterOption[] = []

  // Trade2 "type filters"
  const rarity = parseRarity(lines)
  if (rarity) {
    filters.push({
      id: `rarity:${rarity}`,
      label: `Rarity: ${rarity}`,
      group: 'item',
      tradeId: 'type_filters.rarity',
      value: { kind: 'text', text: rarity }
    })
  }

  const itemClass = parseItemClass(lines)
  const category = poe2CategoryFromItemClass(itemClass)
  if (category) {
    filters.push({
      id: `category:${category}`,
      label: itemClass ? `Item category: ${itemClass}` : `Category: ${category}`,
      group: 'item',
      tradeId: 'type_filters.category',
      value: { kind: 'text', text: category }
    })
  }

  // Basic item-ish fields we can usually find.
  const itemLevelLine = lines.find((l) => /^item level:/i.test(l))
  const ilvl = itemLevelLine ? parseNumberAfter('Item Level:', itemLevelLine) : undefined
  pushIfDefined(
    filters,
    ilvl !== undefined
      ? {
          id: 'itemLevel',
          label: `Item level ${ilvl}`,
          group: 'item',
          tradeId: 'type_filters.ilvl',
          value: { kind: 'number', min: ilvl }
        }
      : undefined
  )

  const qualityLine = lines.find((l) => /^quality:/i.test(l))
  const quality = qualityLine ? parseNumberAfter('Quality:', qualityLine) : undefined
  pushIfDefined(
    filters,
    quality !== undefined
      ? {
          id: 'quality',
          label: `Quality ~${quality} (similar)`,
          group: 'item',
          tradeId: 'type_filters.quality',
          value: { kind: 'number', min: quality }
        }
      : undefined
  )

  const reqLevelLine = lines.find((l) => /^requires level/i.test(l))
  const reqLevel = reqLevelLine ? parseNumberAfter('Requires Level', reqLevelLine) : undefined
  pushIfDefined(
    filters,
    reqLevel !== undefined
      ? {
          id: 'requiresLevel',
          label: `Character level required ≤ ${reqLevel}`,
          group: 'requirements',
          tradeId: 'req_filters.lvl',
          value: { kind: 'number', max: reqLevel }
        }
      : undefined
  )

  const hasArmourLine = lines.some((l) => l.toLowerCase().startsWith('armour:'))
  const hasEvasionLine = lines.some((l) => l.toLowerCase().startsWith('evasion rating:'))
  const hasEnergyShieldLine = lines.some((l) => l.toLowerCase().startsWith('energy shield:'))

  for (const key of ['Armour:', 'Evasion Rating:', 'Energy Shield:'] as const) {
    const ln = lines.find((l) => l.toLowerCase().startsWith(key.toLowerCase()))
    const val = ln ? parseNumberAfter(key, ln) : undefined
    if (val === undefined) continue
    // Avoid duplicates: for Energy Shield we emit the trade2 equipment filter only.
    if (key === 'Energy Shield:') {
      filters.push({
        id: 'equipment.es',
        label: `Energy Shield >= ${val}`,
        group: 'defences',
        tradeId: 'equipment_filters.es',
        value: { kind: 'number', min: val }
      })
      continue
    }

    const id = key === 'Armour:' ? 'armour' : 'evasion'
    const tradeId = key === 'Armour:' ? 'equipment_filters.ar' : 'equipment_filters.ev'
    filters.push({
      id,
      label: `${key.replace(':', '')} ~${val} (similar)`,
      group: 'defences',
      tradeId,
      value: { kind: 'number', min: val }
    })
  }

  // Clipboard text for pure ES armour omits Armour / Evasion entirely; ES-only search must cap AR/EV
  // or the trade site returns hybrids that still meet ES >= min.
  if (hasEnergyShieldLine && !hasArmourLine && !hasEvasionLine) {
    filters.push({
      id: 'defence.pure_es.ar_max',
      label: 'Armour ≤ 0',
      group: 'defences',
      tradeId: 'equipment_filters.ar',
      value: { kind: 'number', max: 0 }
    })
    filters.push({
      id: 'defence.pure_es.ev_max',
      label: 'Evasion Rating ≤ 0',
      group: 'defences',
      tradeId: 'equipment_filters.ev',
      value: { kind: 'number', max: 0 }
    })
  }

  const runeSockets = parseSocketsRuneCount(lines)
  if (runeSockets !== undefined) {
    filters.push({
      id: 'equipment.rune_sockets',
      label: `Rune sockets >= ${runeSockets}`,
      group: 'item',
      tradeId: 'equipment_filters.rune_sockets',
      value: { kind: 'number', min: runeSockets }
    })
  }

  // Mods: very loose extraction (prototype).
  // Advanced copy uses Prefix/Suffix Modifier lines — track for UI grouping.
  let affixSection: 'prefix' | 'suffix' | undefined
  const modMeta = (): { modAffix?: 'prefix' | 'suffix' } =>
    affixSection !== undefined ? { modAffix: affixSection } : {}

  /**
   * Hybrid-mod detector.
   *
   * PoE2 desecrated modifiers commonly emit _two_ sub-stat lines in the clipboard
   * (e.g. "+14 to max Energy Shield (desecrated)" immediately followed by
   * "25% increased Energy Shield (desecrated)"). Both belong to one real modifier —
   * the trade search should count them as one slot, but the UI still shows two
   * sliders so each sub-roll is editable.
   *
   * Heuristic: consecutive emitted mod filters with the same source tag and no
   * `--------` / "Corrupted" / block-boundary line between them are treated as
   * siblings of the same hybrid group.
   */
  let hybridActive: { tag: 'rune' | 'desecrated'; groupId: string } | undefined
  let hybridSeq = 0
  const nextHybridGroupId = (tag: 'rune' | 'desecrated'): string => {
    hybridSeq++
    return `${tag}#${hybridSeq}`
  }

  for (const line of lines) {
    if (/^--------$/.test(line)) {
      hybridActive = undefined
      continue
    }
    if (
      /^(rarity:|item class:|item level:|quality:|requires level|armour:|evasion rating:|energy shield:)/i.test(
        line
      )
    ) {
      hybridActive = undefined
      continue
    }

    if (/^click to react$/i.test(line)) continue
    if (/^unidentified$/i.test(line)) continue
    if (/^mirrored$/i.test(line)) continue
    if (/^sockets:/i.test(line)) continue
    if (/^stack size:/i.test(line)) continue

    if (/^\{?\s*prefix\s+modifier\b/i.test(line)) {
      affixSection = 'prefix'
      hybridActive = undefined
      continue
    }
    if (/^\{?\s*suffix\s+modifier\b/i.test(line)) {
      affixSection = 'suffix'
      hybridActive = undefined
      continue
    }
    if (/^prefix modifiers?$/i.test(line) || /^prefixes?$/i.test(line)) {
      affixSection = 'prefix'
      hybridActive = undefined
      continue
    }
    if (/^suffix modifiers?$/i.test(line) || /^suffixes?$/i.test(line)) {
      affixSection = 'suffix'
      hybridActive = undefined
      continue
    }
    if (/^corrupted$/i.test(line)) {
      hybridActive = undefined
      filters.push({
        id: 'corrupted',
        label: 'Corrupted',
        group: 'misc',
        tradeId: 'misc_filters.corrupted',
        value: { kind: 'text', text: 'true' }
      })
      continue
    }

    // Generic mod: loose heuristic to identify a rolled line, then consult the PoE2 stats DB
    // to resolve it to a real trade stat id (awakened-poe-trade's approach).
    if (
      /^[-+]?\d/.test(line) ||
      /^[-+]\d/.test(line) ||
      line.includes('%') ||
      /\bto\b/i.test(line)
    ) {
      const roll = parseModNumber(line)
      const match = findStatsForMod(line)
      const tag = modTagFromLine(line)

      // Resolve the hybrid group id for this row:
      //  - `desecrated` mods commonly emit 2+ consecutive sub-stats that share one mod.
      //  - Untagged explicits can also be hybrid (e.g. "% increased X" + "+N to X" prefix),
      //    but we can't reliably detect those without DB metadata, so leave them unmarked.
      //  - `rune` lines are tagged but each rune is a single stat — no hybrid grouping.
      let hybridGroupId: string | undefined
      if (tag === 'desecrated') {
        if (hybridActive?.tag === tag) {
          hybridGroupId = hybridActive.groupId
        } else {
          hybridGroupId = nextHybridGroupId(tag)
          hybridActive = { tag, groupId: hybridGroupId }
        }
      } else {
        hybridActive = undefined
      }

      if (tag === 'rune') {
        if (match.entries.length > 0) {
          const primary = match.entries[0]
          filters.push({
            id: `rune:${primary.id}`,
            label: displayModLabel(line, tag),
            group: 'item',
            tradeId: primary.id,
            modTag: 'rune',
            value:
              roll !== undefined
                ? { kind: 'number', min: Math.floor(roll) }
                : { kind: 'text', text: line }
          })
        } else if (roll !== undefined) {
          filters.push({
            id: `rune:line:${line.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}`,
            label: displayModLabel(line, tag),
            group: 'item',
            modTag: 'rune',
            value: { kind: 'number', min: Math.floor(roll) }
          })
        }
        continue
      }

      if (match.entries.length > 0) {
        const primary = match.entries[0]
        const tradeIds = match.entries.map((e) => e.id)
        const id = `stat:${primary.id}`
        filters.push({
          id,
          label: displayModLabel(line, tag),
          group: 'mods',
          tradeId: primary.id,
          ...(tradeIds.length > 1 ? { tradeIds } : {}),
          ...(tag ? { modTag: tag } : {}),
          ...(hybridGroupId ? { modHybridGroupId: hybridGroupId } : {}),
          modSourceLine: line,
          value:
            roll !== undefined
              ? { kind: 'number', min: Math.floor(roll) }
              : { kind: 'text', text: line },
          ...(roll !== undefined ? rollMetaFromLine(roll, line, tradeIds) : {}),
          ...modMeta()
        })
        continue
      }

      const id = `mod:${line
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)}`
      if (roll !== undefined) {
        filters.push({
          id,
          label: displayModLabel(line, tag),
          group: 'mods',
          modSourceLine: line,
          value: { kind: 'number', min: roll },
          ...(tag ? { modTag: tag } : {}),
          ...(hybridGroupId ? { modHybridGroupId: hybridGroupId } : {}),
          ...rollMetaFromLine(roll, line),
          ...modMeta()
        })
      } else {
        filters.push({
          id,
          label: displayModLabel(line, tag),
          group: 'mods',
          value: { kind: 'text', text: line },
          ...(tag ? { modTag: tag } : {}),
          ...(hybridGroupId ? { modHybridGroupId: hybridGroupId } : {}),
          ...modMeta()
        })
      }
    } else {
      // Any other non-mod line breaks the hybrid chain (we don't want a stray piece
      // of UI text between two desecrated lines to accidentally keep the chain alive).
      hybridActive = undefined
    }
  }

  // De-dupe by both row id and primary trade stat id (preserving order).
  //
  // The trade-stat dedupe catches cases where two parser branches resolve the
  // same clipboard line to the same trade filter — e.g. a pseudo shortcut
  // plus the DB-matched explicit — so the UI doesn't show two rows for one
  // underlying mod. Non-mod rows (type/equipment/misc filters) share
  // trade-path-ish ids like `type_filters.rarity`, which is intentional and
  // should never be collapsed; we only dedupe rows whose tradeId looks like a
  // stat id (has a `.stat_` suffix or a `pseudo.` / `explicit.` / etc prefix).
  const seenIds = new Set<string>()
  const seenStatTradeIds = new Set<string>()
  const deduped: TradeFilterOption[] = []
  for (const f of filters) {
    if (seenIds.has(f.id)) continue
    const isStatTradeId =
      !!f.tradeId && /^(explicit|implicit|fractured|rune|desecrated|enchant|crafted|pseudo|sanctum)\./.test(f.tradeId)
    if (isStatTradeId && f.tradeId && seenStatTradeIds.has(f.tradeId)) continue
    seenIds.add(f.id)
    if (isStatTradeId && f.tradeId) seenStatTradeIds.add(f.tradeId)
    deduped.push(f)
  }

  console.log('[parseItemText] done:', {
    itemName,
    itemType,
    filters: deduped.map((f) => ({
      id: f.id,
      tradeId: f.tradeId,
      tradeIds: f.tradeIds,
      label: f.label
    }))
  })
  return { itemName, itemType, filters: deduped }
}
