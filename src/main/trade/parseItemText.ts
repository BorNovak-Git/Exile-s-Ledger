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

function poe2CategoryFromItemClass(itemClass: string | undefined): string | undefined {
  const c = (itemClass ?? '').toLowerCase()
  if (c === 'boots') return 'armour.boots'
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
      label: `Category: ${category}`,
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
      ? { id: 'itemLevel', label: `Item level >= ${ilvl}`, group: 'item', value: { kind: 'number', min: ilvl } }
      : undefined
  )

  const qualityLine = lines.find((l) => /^quality:/i.test(l))
  const quality = qualityLine ? parseNumberAfter('Quality:', qualityLine) : undefined
  pushIfDefined(
    filters,
    quality !== undefined
      ? { id: 'quality', label: `Quality >= ${quality}`, group: 'item', value: { kind: 'number', min: quality } }
      : undefined
  )

  const reqLevelLine = lines.find((l) => /^requires level/i.test(l))
  const reqLevel = reqLevelLine ? parseNumberAfter('Requires Level', reqLevelLine) : undefined
  pushIfDefined(
    filters,
    reqLevel !== undefined
      ? {
          id: 'requiresLevel',
          label: `Requires level <= ${reqLevel}`,
          group: 'requirements',
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
    filters.push({
      id,
      label: `${key.replace(':', '')} >= ${val}`,
      group: 'defences',
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
  // Keep original mod text as "term" candidate; later you can map these to trade stat ids.
  for (const line of lines) {
    // Skip structural / header lines common in clipboard text
    if (/^--------$/.test(line)) continue
    if (/^(rarity:|item class:|item level:|quality:|requires level|armour:|evasion rating:|energy shield:)/i.test(line)) continue
    if (/^corrupted$/i.test(line)) {
      filters.push({ id: 'corrupted', label: 'Corrupted', group: 'misc' })
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
          value: { kind: 'number', min: n }
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
          value: { kind: 'number', min: n }
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
          value: { kind: 'number', min: Math.floor(n) }
        })
        continue
      }
    }

    // Heuristic: mod lines often start with +, -, or a number.
    if (/^[+\-]?\d/.test(line) || /^[+\-]\d/.test(line) || line.includes('%') || line.includes('to ')) {
      filters.push({
        id: `mod:${line.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)}`,
        label: line,
        group: 'mods',
        value: { kind: 'text', text: line }
      })
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

