import type { ParseItemTextResponse, TradeFilterOption } from '../../shared/trade'

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

  for (const line of lines) {
    // Skip structural / header lines common in clipboard text
    if (/^--------$/.test(line)) continue
    if (
      /^(rarity:|item class:|item level:|quality:|requires level|armour:|evasion rating:|energy shield:)/i.test(
        line
      )
    )
      continue

    if (/^\{?\s*prefix\s+modifier\b/i.test(line)) {
      affixSection = 'prefix'
      continue
    }
    if (/^\{?\s*suffix\s+modifier\b/i.test(line)) {
      affixSection = 'suffix'
      continue
    }
    if (/^prefix modifiers?$/i.test(line) || /^prefixes?$/i.test(line)) {
      affixSection = 'prefix'
      continue
    }
    if (/^suffix modifiers?$/i.test(line) || /^suffixes?$/i.test(line)) {
      affixSection = 'suffix'
      continue
    }
    if (/^corrupted$/i.test(line)) {
      filters.push({
        id: 'corrupted',
        label: 'Corrupted',
        group: 'misc',
        tradeId: 'misc_filters.corrupted',
        value: { kind: 'text', text: 'true' }
      })
      continue
    }

    // PoE2 trade2 mappings for common mods in your sample.
    // Movement speed -> pseudo.pseudo_increased_movement_speed
    if (/increased movement speed/i.test(line)) {
      const n = parseModNumber(line)
      if (n !== undefined) {
        filters.push({
          id: 'pseudo.pseudo_increased_movement_speed',
          label: `${n}% increased Movement Speed`,
          group: 'mods',
          tradeId: 'pseudo.pseudo_increased_movement_speed',
          value: { kind: 'number', min: n },
          ...modMeta()
        })
        continue
      }
    }

    // Total lightning resistance -> pseudo.pseudo_total_lightning_resistance
    if (/to lightning resistance/i.test(line)) {
      const n = parseModNumber(line)
      if (n !== undefined) {
        filters.push({
          id: 'pseudo.pseudo_total_lightning_resistance',
          label: `+${n}% total to Lightning Resistance`,
          group: 'mods',
          tradeId: 'pseudo.pseudo_total_lightning_resistance',
          value: { kind: 'number', min: n },
          ...modMeta()
        })
        continue
      }
    }

    // Life regeneration per second -> explicit.stat_3325883026 (from your trace)
    if (/life regeneration per second/i.test(line)) {
      const n = parseModNumber(line)
      if (n !== undefined) {
        filters.push({
          id: 'explicit.stat_3325883026',
          label: `${n} Life Regeneration per second`,
          group: 'mods',
          tradeId: 'explicit.stat_3325883026',
          value: { kind: 'number', min: Math.floor(n) },
          ...modMeta()
        })
        continue
      }
    }

    // Heuristic: mod lines often start with +, -, or a number.
    if (
      /^[-+]?\d/.test(line) ||
      /^[-+]\d/.test(line) ||
      line.includes('%') ||
      line.includes('to ')
    ) {
      const roll = parseModNumber(line)
      const id = `mod:${line
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)}`
      if (roll !== undefined) {
        filters.push({
          id,
          label: line,
          group: 'mods',
          modSourceLine: line,
          value: { kind: 'number', min: roll },
          ...modMeta()
        })
      } else {
        filters.push({
          id,
          label: line,
          group: 'mods',
          value: { kind: 'text', text: line },
          ...modMeta()
        })
      }
    }
  }

  // De-dupe by id while preserving order
  const seen = new Set<string>()
  const deduped: TradeFilterOption[] = []
  for (const f of filters) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    deduped.push(f)
  }

  console.log('[parseItemText] done:', {
    itemName,
    itemType,
    filters: deduped.map((f) => ({ id: f.id, tradeId: f.tradeId, label: f.label }))
  })
  return { itemName, itemType, filters: deduped }
}
