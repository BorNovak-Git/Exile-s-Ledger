<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw, nextTick, watch } from 'vue'
import type {
  ApiErrorShape,
  ParseItemTextResponse,
  TradeFilterOption,
  TradeFilterValue,
  TradeListingSummary,
  TradeSearchResponse
} from '../../shared/trade'
import {
  DEFAULT_OVERLAY_ACCELERATOR,
  loadSettings,
  saveSettings,
  type AppSettings
} from './settings'
import EditableFilterRow from './EditableFilterRow.vue'
import { buildElectronAccelerator } from './electronAcceleratorFromKeyEvent'

const itemText = ref('')
const settings = ref<AppSettings>(loadSettings())

const availableLeagues = ref<string[]>([])
const leaguesLoading = ref(false)
const leaguesError = ref<string | null>(null)

const leagueSelectValue = computed<string>({
  get() {
    const L = settings.value.league.trim()
    if (!L) return '__custom__'
    if (availableLeagues.value.includes(L)) return L
    return '__custom__'
  },
  set(v) {
    if (v === '__custom__') {
      if (!settings.value.league.trim()) settings.value.league = 'Standard'
    } else {
      settings.value.league = v
    }
    saveSettings(settings.value)
  }
})

const customLeague = computed<string>({
  get() {
    return settings.value.league
  },
  set(v) {
    settings.value.league = v
    saveSettings(settings.value)
  }
})

const baseUrl = computed<string>({
  get() {
    return settings.value.baseUrl
  },
  set(v) {
    settings.value.baseUrl = v
    saveSettings(settings.value)
  }
})

const showItemStatsOnHover = computed<boolean>({
  get() {
    return settings.value.showItemStatsOnHover
  },
  set(v) {
    settings.value.showItemStatsOnHover = v
    saveSettings(settings.value)
  }
})

const overlayAccelerator = computed({
  get() {
    return settings.value.overlayAccelerator
  },
  set(v: string) {
    settings.value.overlayAccelerator = v
    saveSettings(settings.value)
  }
})

const overlayHotkeyRegError = ref<string | null>(null)
let removeOverlayHotkeyListener: (() => void) | null = null
let overlayHotkeyDebounce: ReturnType<typeof setTimeout> | null = null

const recordingKeybind = ref(false)
const keybindRecorderCardRef = ref<HTMLElement | null>(null)
const keybindRecordError = ref<string | null>(null)

function startRecordingKeybind(): void {
  keybindRecordError.value = null
  recordingKeybind.value = true
}

function stopRecordingKeybind(): void {
  recordingKeybind.value = false
}

function onGlobalKeyRecord(e: KeyboardEvent): void {
  if (!recordingKeybind.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    stopRecordingKeybind()
    return
  }
  e.preventDefault()
  e.stopPropagation()
  const acc = buildElectronAccelerator(e)
  if (!acc) {
    keybindRecordError.value =
      'That key is not supported here. Try Ctrl/Cmd + a letter or number, F-keys, or type the accelerator manually.'
    return
  }
  keybindRecordError.value = null
  overlayAccelerator.value = acc
  void applyOverlayHotkeyFromSettings()
  stopRecordingKeybind()
}

watch(recordingKeybind, (on) => {
  if (on) {
    nextTick(() => {
      window.addEventListener('keydown', onGlobalKeyRecord, true)
      keybindRecorderCardRef.value?.focus()
    })
  } else {
    window.removeEventListener('keydown', onGlobalKeyRecord, true)
  }
})

/** Saved Electron accelerator (trimmed). Empty means hotkey disabled. */
const grabItemHotkeyDisplay = computed(() => settings.value.overlayAccelerator.trim())

/** Same as display, or a short label when hotkey is off. */
const grabItemHotkeyLabel = computed(() =>
  grabItemHotkeyDisplay.value.length ? grabItemHotkeyDisplay.value : 'Hotkey off (set below)'
)

/** Header / one-liners — always reflects the current saved keybind. */
const headerSubtitle = computed(() => {
  if (!grabItemHotkeyDisplay.value.length) {
    return 'Set grab hotkey in Settings, or clipboard → filters → search'
  }
  return `Press ${grabItemHotkeyDisplay.value} in PoE, or clipboard → filters → search`
})

async function applyOverlayHotkeyFromSettings(): Promise<void> {
  overlayHotkeyRegError.value = null
  const acc = settings.value.overlayAccelerator.trim()
  const res = await window.api.overlay.registerHotkey(acc)
  if ('message' in res) overlayHotkeyRegError.value = res.message
}

const parsing = ref(false)
const searching = ref(false)
const connecting = ref(false)
const showSettings = ref(false)

const tradeConnected = ref<boolean | null>(null)
const tradeCookies = ref<string[]>([])

const parseResult = ref<ParseItemTextResponse | null>(null)
const selectedIds = ref<Set<string>>(new Set())
const results = ref<TradeSearchResponse | null>(null)
const error = ref<string | null>(null)

const filters = computed<TradeFilterOption[]>(() => parseResult.value?.filters ?? [])

const filterGroups = computed<Partial<Record<TradeFilterOption['group'], TradeFilterOption[]>>>(
  () => {
    const groups: Partial<Record<TradeFilterOption['group'], TradeFilterOption[]>> = {}
    for (const f of filters.value) {
      if (!groups[f.group]) groups[f.group] = []
      groups[f.group]!.push(f)
    }
    return groups
  }
)

const modPrefixFilters = computed(() =>
  filters.value.filter((f) => f.group === 'mods' && f.modAffix === 'prefix')
)
const modSuffixFilters = computed(() =>
  filters.value.filter((f) => f.group === 'mods' && f.modAffix === 'suffix')
)
const modOtherFilters = computed(() =>
  filters.value.filter((f) => f.group === 'mods' && f.modAffix === undefined)
)

type ListingTooltipPos = { listing: TradeListingSummary; left: number; top: number; maxH: number }
const listingTooltip = ref<ListingTooltipPos | null>(null)
let listingTooltipHideTimer: ReturnType<typeof setTimeout> | null = null

function clearListingTooltipHide(): void {
  if (listingTooltipHideTimer) {
    clearTimeout(listingTooltipHideTimer)
    listingTooltipHideTimer = null
  }
}

function scheduleListingTooltipHide(): void {
  clearListingTooltipHide()
  listingTooltipHideTimer = setTimeout(() => {
    listingTooltip.value = null
    listingTooltipHideTimer = null
  }, 480)
}

function positionListingTooltip(r: TradeListingSummary, rowEl: HTMLElement): void {
  const rect = rowEl.getBoundingClientRect()
  const margin = 10
  const tw = 320
  const vw = window.innerWidth
  const vh = window.innerHeight
  /** Slight overlap with the row so the cursor can reach the tooltip without leaving "hover" for long. */
  const bridgeOverlap = 10
  let left = rect.right + margin - bridgeOverlap
  if (left + tw > vw - margin) {
    left = Math.max(margin, rect.left - margin - tw + bridgeOverlap)
  }
  const maxH = Math.min(480, Math.floor(vh * 0.78))
  let top = rect.top
  if (top + maxH > vh - margin) top = Math.max(margin, vh - margin - maxH)
  if (top < margin) top = margin
  listingTooltip.value = { listing: r, left, top, maxH }
}

function onListingRowEnter(r: TradeListingSummary, ev: MouseEvent): void {
  if (!showItemStatsOnHover.value || !r.stats) return
  clearListingTooltipHide()
  const el = ev.currentTarget as HTMLElement
  nextTick(() => positionListingTooltip(r, el))
}

function onListingRowLeave(): void {
  scheduleListingTooltipHide()
}

function onListingEyeEnter(r: TradeListingSummary, ev: MouseEvent): void {
  if (!showItemStatsOnHover.value || !r.stats) return
  clearListingTooltipHide()
  const row = (ev.currentTarget as HTMLElement | null)?.closest('.listingRow') as HTMLElement | null
  const el = row ?? (ev.currentTarget as HTMLElement)
  nextTick(() => positionListingTooltip(r, el))
}

/**
 * Close tooltip when something else scrolls (e.g. results list). Must ignore scroll events
 * that originate from the tooltip body: with capture:true on window, inner tooltip scroll
 * still hits this listener first and would otherwise close the tooltip immediately.
 */
function onScrollCloseTooltip(ev?: Event): void {
  const t = ev?.target
  if (t instanceof Element && t.closest('[data-listing-tooltip-root]')) return
  if (listingTooltip.value) listingTooltip.value = null
  clearListingTooltipHide()
}

const itemDecorativeIcon = computed(() => {
  const catFilter = filters.value.find((f) => f.tradeId === 'type_filters.category')
  const cat = catFilter?.value?.kind === 'text' ? catFilter.value.text : ''
  if (cat.startsWith('weapon')) return 'swords'
  if (cat.startsWith('armour')) return 'shield'
  if (cat.startsWith('accessory')) return 'workspace_premium'
  if (cat.startsWith('flask')) return 'water_drop'
  if (cat.startsWith('gem')) return 'diamond'
  if (cat.startsWith('map')) return 'map'
  return 'auto_awesome'
})

function toggleSelected(id: string, checked: boolean): void {
  const next = new Set(selectedIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedIds.value = next
}

/** Which numeric bounds to show for editing (search still uses whatever min/max are set). */
function numberSlotsFor(f: TradeFilterOption): ('min' | 'max')[] {
  if (f.value?.kind !== 'number') return []
  const id = f.tradeId ?? ''
  if (id === 'req_filters.lvl') return ['max']
  if (/^(explicit\.|implicit\.|pseudo\.|rune\.)/.test(id)) return ['min', 'max']
  // Client-matched mods (clipboard line, no trade stat id): same min/max editing as other affixes.
  if (f.group === 'mods' && f.modSourceLine) return ['min', 'max']
  return ['min']
}

function onFilterNumberInput(id: string, field: 'min' | 'max', raw: string): void {
  const list = parseResult.value?.filters
  if (!list) return
  const f = list.find((x) => x.id === id)
  if (!f || f.value?.kind !== 'number') return
  const t = raw.trim()
  const parsed: number | undefined = t === '' || t === '-' ? undefined : Number(t)
  if (parsed !== undefined && Number.isNaN(parsed)) return
  const prev = f.value
  f.value = {
    kind: 'number',
    min: field === 'min' ? parsed : prev.min,
    max: field === 'max' ? parsed : prev.max
  }
}

const selectedFilters = computed(() => filters.value.filter((f) => selectedIds.value.has(f.id)))

function toPlainSelectedFilters(list: TradeFilterOption[]): TradeFilterOption[] {
  return list.map((f) => {
    const rawF = toRaw(f) as TradeFilterOption
    const rawV = rawF.value ? (toRaw(rawF.value) as TradeFilterValue) : undefined
    return {
      id: rawF.id,
      label: rawF.label,
      group: rawF.group,
      tradeId: rawF.tradeId,
      modAffix: rawF.modAffix,
      modSourceLine: rawF.modSourceLine,
      value: rawV ? { ...rawV } : undefined
    }
  })
}

async function onConvert(): Promise<void> {
  error.value = null
  results.value = null
  const raw = itemText.value.trim()
  if (!raw.length) {
    error.value = `No item text. Press ${grabItemHotkeyLabel.value} in PoE or use Import from clipboard.`
    return
  }
  parsing.value = true
  try {
    const res = await window.api.trade.parseItemText(raw)
    parseResult.value = res
    selectedIds.value = new Set(res.filters.map((f) => f.id))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to parse item text'
  } finally {
    parsing.value = false
  }
}

async function onImportFromClipboard(): Promise<void> {
  error.value = null
  try {
    const text = await window.api.app.readClipboardText()
    if (!text.trim()) {
      error.value = 'Clipboard has no text. In PoE, focus an item and press Ctrl+C, then try again.'
      return
    }
    itemText.value = text
    await onConvert()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not read clipboard'
  }
}

function isApiErrorShape(x: unknown): x is ApiErrorShape {
  return !!x && typeof x === 'object' && 'message' in x
}

async function onSearch(): Promise<void> {
  listingTooltip.value = null
  clearListingTooltipHide()
  error.value = null
  searching.value = true
  try {
    const plainSelected = toPlainSelectedFilters(selectedFilters.value)
    const res = await window.api.trade.search({
      league: settings.value.league.trim() || 'Standard',
      baseUrl: settings.value.baseUrl.trim() || undefined,
      selectedFilters: plainSelected,
      limit: 10
    })
    if (isApiErrorShape(res)) {
      error.value = res.message
      results.value = null
    } else {
      results.value = res
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Search failed'
  } finally {
    searching.value = false
  }
}

async function onConnect(): Promise<void> {
  error.value = null
  connecting.value = true
  try {
    const res = await window.api.trade.connect(settings.value.baseUrl.trim() || undefined)
    if (isApiErrorShape(res)) error.value = res.message
    else {
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        await refreshTradeStatus()
        if (tradeConnected.value === true) break
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Connect failed'
  } finally {
    connecting.value = false
  }
}

async function loadLeagues(): Promise<void> {
  leaguesLoading.value = true
  leaguesError.value = null
  try {
    const res = await window.api.trade.listLeagues(settings.value.baseUrl.trim() || undefined)
    if (isApiErrorShape(res)) {
      availableLeagues.value = []
      leaguesError.value = res.message
    } else {
      availableLeagues.value = res.leagues
    }
  } catch (e) {
    availableLeagues.value = []
    leaguesError.value = e instanceof Error ? e.message : 'Failed to load leagues'
  } finally {
    leaguesLoading.value = false
  }
}

function onMinimizeWindow(): void {
  void window.api.app.minimizeMainWindow()
}

function onCloseWindow(): void {
  void window.api.app.closeMainWindow()
}

async function refreshTradeStatus(): Promise<void> {
  try {
    const res = await window.api.trade.status(settings.value.baseUrl.trim() || undefined)
    if (isApiErrorShape(res)) {
      tradeConnected.value = null
      tradeCookies.value = []
      return
    }
    tradeConnected.value = res.connected
    tradeCookies.value = res.cookies
  } catch {
    tradeConnected.value = null
    tradeCookies.value = []
  }
}

watch(
  () => settings.value.overlayAccelerator,
  () => {
    if (overlayHotkeyDebounce) clearTimeout(overlayHotkeyDebounce)
    overlayHotkeyDebounce = setTimeout(() => {
      void applyOverlayHotkeyFromSettings()
      overlayHotkeyDebounce = null
    }, 450)
  }
)

onMounted(() => {
  settings.value = loadSettings()
  refreshTradeStatus()
  loadLeagues()
  window.addEventListener('scroll', onScrollCloseTooltip, true)

  removeOverlayHotkeyListener = window.api.overlay.onItemFromHotkey((p) => {
    showSettings.value = false
    listingTooltip.value = null
    clearListingTooltipHide()
    if (p.error) {
      error.value = p.error
      return
    }
    itemText.value = p.text ?? ''
    error.value = null
    void onConvert()
  })
  void applyOverlayHotkeyFromSettings()
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScrollCloseTooltip, true)
  window.removeEventListener('keydown', onGlobalKeyRecord, true)
  clearListingTooltipHide()
  removeOverlayHotkeyListener?.()
  removeOverlayHotkeyListener = null
  if (overlayHotkeyDebounce) clearTimeout(overlayHotkeyDebounce)
})
</script>

<template>
  <div class="app">
    <!-- ── HEADER ───────────────────────────────────────────────── -->
    <header class="appHeader">
      <div class="headerInner">
        <div class="headerBrand">
          <span class="mi">inventory_2</span>
          <div class="brandText">
            <h1 class="brandTitle">Exile's Ledger</h1>
            <p class="brandSub">{{ headerSubtitle }}</p>
          </div>
        </div>
        <div class="headerActions">
          <button type="button" class="iconBtn" title="Settings" @click="showSettings = true">
            <span class="mi">settings</span>
          </button>
          <button type="button" class="iconBtn" title="Minimize" @click="onMinimizeWindow">
            <span class="mi">minimize</span>
          </button>
          <button
            type="button"
            class="iconBtn iconBtnClose"
            title="Close window"
            @click="onCloseWindow"
          >
            <span class="mi">close</span>
          </button>
        </div>
      </div>
    </header>

    <!-- ── STATUS BAR ────────────────────────────────────────────── -->
    <div class="statusBar">
      <span class="mi statusBolt">bolt</span>
      <span class="statusText">
        <span v-if="tradeConnected === true" class="stConnected">Connected</span>
        <span v-else-if="tradeConnected === false" class="stBad"
          >Not connected — search may 403</span
        >
        <span v-else class="stUnk">Trade status unknown</span>
        <span v-if="settings.league" class="stLeague"> · {{ settings.league }}</span>
      </span>
    </div>

    <!-- ── MAIN ─────────────────────────────────────────────────── -->
    <main class="mainWrap">
      <div v-if="error" class="errorStrip">{{ error }}</div>

      <template v-if="parseResult">
        <div class="bodyLayout">
          <!-- ── LEFT: Item card + filters ───────────────────────── -->
          <aside class="itemSidebar">
            <div class="filterToolbar">
              <button
                type="button"
                class="btn btnPrimary"
                :disabled="searching || selectedFilters.length === 0"
                @click="onSearch"
              >
                <span class="mi btnIco">search_insights</span>
                {{ searching ? 'Searching…' : 'Price Check' }}
              </button>
              <button
                type="button"
                class="btn btnGhost"
                :disabled="parsing"
                title="Replace item from clipboard (PoE: Ctrl+C on item first)"
                @click="onImportFromClipboard"
              >
                <span class="mi btnIco">content_paste</span>
                Import
              </button>
            </div>

            <!-- Item header card -->
            <div class="itemCard">
              <div class="itemCardDecor" aria-hidden="true">
                <span class="mi itemCardDecorIcon">{{ itemDecorativeIcon }}</span>
              </div>
              <div class="itemCardBody">
                <h2 class="itemName">{{ parseResult.itemName || '—' }}</h2>
                <p class="itemTypeLine">{{ parseResult.itemType || '' }}</p>
                <div class="itemChips">
                  <span
                    v-for="f in filters.filter((f) => f.group === 'misc')"
                    :key="f.id"
                    class="chip chipCorrupted"
                    >Corrupted</span
                  >
                  <span
                    v-if="
                      filters.find((f) => f.tradeId === 'type_filters.rarity')?.value?.kind ===
                      'text'
                    "
                    class="chip chipNormal"
                    >{{
                      (filters.find((f) => f.tradeId === 'type_filters.rarity')?.value as any)?.text
                    }}</span
                  >
                  <span
                    v-if="filters.find((f) => f.tradeId === 'type_filters.category')"
                    class="chip chipNormal"
                    >{{
                      (filters.find((f) => f.tradeId === 'type_filters.category')?.label ?? '')
                        .replace('Item category: ', '')
                        .replace('Category: ', '')
                    }}</span
                  >
                </div>
              </div>
            </div>

            <!-- Filter sections -->
            <div class="filterArea">
              <div v-if="filterGroups.item?.length" class="filterSection">
                <div class="filterSecHead">
                  <span class="filterSecLabel labelGold">Item Properties</span>
                </div>
                <ul class="filterList">
                  <EditableFilterRow
                    v-for="f in filterGroups.item"
                    :key="f.id"
                    :filter="f"
                    :selected="selectedIds.has(f.id)"
                    bullet="gold"
                    :slots="numberSlotsFor(f)"
                    @toggle="toggleSelected"
                    @num-input="onFilterNumberInput"
                  />
                </ul>
              </div>

              <div v-if="filterGroups.requirements?.length" class="filterSection">
                <div class="filterSecHead">
                  <span class="filterSecLabel labelMuted">Requirements</span>
                </div>
                <ul class="filterList">
                  <EditableFilterRow
                    v-for="f in filterGroups.requirements"
                    :key="f.id"
                    :filter="f"
                    :selected="selectedIds.has(f.id)"
                    bullet="muted"
                    :slots="numberSlotsFor(f)"
                    @toggle="toggleSelected"
                    @num-input="onFilterNumberInput"
                  />
                </ul>
              </div>

              <div v-if="filterGroups.defences?.length" class="filterSection">
                <div class="filterSecHead">
                  <span class="filterSecLabel labelGold">Defences</span>
                </div>
                <ul class="filterList">
                  <EditableFilterRow
                    v-for="f in filterGroups.defences"
                    :key="f.id"
                    :filter="f"
                    :selected="selectedIds.has(f.id)"
                    bullet="gold"
                    :slots="numberSlotsFor(f)"
                    @toggle="toggleSelected"
                    @num-input="onFilterNumberInput"
                  />
                </ul>
              </div>

              <div v-if="modPrefixFilters.length" class="filterSection">
                <div class="filterSecHead">
                  <span class="filterSecLabel labelPurple">Prefixes</span>
                </div>
                <ul class="filterList">
                  <EditableFilterRow
                    v-for="f in modPrefixFilters"
                    :key="f.id"
                    :filter="f"
                    :selected="selectedIds.has(f.id)"
                    bullet="purple"
                    :slots="numberSlotsFor(f)"
                    @toggle="toggleSelected"
                    @num-input="onFilterNumberInput"
                  />
                </ul>
              </div>

              <div v-if="modSuffixFilters.length" class="filterSection">
                <div class="filterSecHead">
                  <span class="filterSecLabel labelPurple">Suffixes</span>
                </div>
                <ul class="filterList">
                  <EditableFilterRow
                    v-for="f in modSuffixFilters"
                    :key="f.id"
                    :filter="f"
                    :selected="selectedIds.has(f.id)"
                    bullet="purple"
                    :slots="numberSlotsFor(f)"
                    @toggle="toggleSelected"
                    @num-input="onFilterNumberInput"
                  />
                </ul>
              </div>

              <div v-if="modOtherFilters.length" class="filterSection">
                <div class="filterSecHead">
                  <span class="filterSecLabel labelPurple">Modifiers</span>
                </div>
                <ul class="filterList">
                  <EditableFilterRow
                    v-for="f in modOtherFilters"
                    :key="f.id"
                    :filter="f"
                    :selected="selectedIds.has(f.id)"
                    bullet="purple"
                    :slots="numberSlotsFor(f)"
                    @toggle="toggleSelected"
                    @num-input="onFilterNumberInput"
                  />
                </ul>
              </div>
            </div>
          </aside>

          <!-- ── RIGHT: Results ───────────────────────────────────── -->
          <div class="resultsArea">
            <div class="resultsHead">
              <h3 class="resultsTitle">Recent Listings</h3>
              <span v-if="results?.total !== undefined" class="resultsCount">
                {{ results.total.toLocaleString() }} found &middot;
                {{ results.results.length }} shown
                <span class="resultsSortHint"> · cheapest first</span>
              </span>
            </div>

            <div v-if="results?.notice" class="resultsNotice">
              <span class="mi noticeIco">info</span>
              <span>{{ results.notice }}</span>
            </div>

            <div v-if="!results" class="emptyState">
              <span class="mi emptyIco">search_insights</span>
              <p>Click <strong>Price Check</strong> to search for similar listings.</p>
            </div>

            <div v-else-if="results.results.length === 0" class="emptyState">
              <span class="mi emptyIco">sentiment_dissatisfied</span>
              <p>No listings matched the selected filters.</p>
            </div>

            <div v-else class="listingList">
              <div
                v-for="r in results.results"
                :key="r.id"
                class="listingRow"
                @mouseenter="onListingRowEnter(r, $event)"
                @mouseleave="onListingRowLeave"
              >
                <div class="listingAccent"></div>

                <div
                  class="listingEye"
                  aria-hidden="true"
                  @mouseenter.stop="onListingEyeEnter(r, $event)"
                >
                  <span class="eyeBtn">
                    <span class="mi">visibility</span>
                  </span>
                </div>

                <!-- Info -->
                <div class="listingInfo">
                  <p class="listingName">
                    {{ (r.name && r.name.length ? r.name + ' ' : '') + (r.typeLine ?? '') }}
                  </p>
                  <div class="listingMeta">
                    <span v-if="r.ilvl !== undefined">iLvl {{ r.ilvl }}</span>
                    <span v-if="r.ilvl !== undefined && r.corrupted" class="metaSep">·</span>
                    <span v-if="r.corrupted" class="metaCorrupted">Corrupted</span>
                  </div>
                </div>

                <!-- Price -->
                <div class="listingRight">
                  <div v-if="r.price" class="priceBlock">
                    <span class="priceAmt">{{ r.price.split(' ')[0] }}</span>
                    <span class="priceCurr">{{ r.price.split(' ').slice(1).join(' ') }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="importOnlyView">
        <div class="importOnlyCard">
          <span class="mi importOnlyIco">touch_app</span>
          <h3 class="importOnlyTitle">Load an item</h3>
          <p class="importOnlyText">
            <template v-if="grabItemHotkeyDisplay">
              Press <code class="kbdHint">{{ grabItemHotkeyDisplay }}</code> in Path of Exile with
              the item under the cursor to copy its data here, or import from the clipboard.
            </template>
            <template v-else>
              Set a grab hotkey in Settings, then press it in PoE with the item under the cursor, or
              import from the clipboard.
            </template>
          </p>
          <div class="importOnlyActions">
            <button
              type="button"
              class="btn btnPrimary"
              :disabled="parsing"
              @click="onImportFromClipboard"
            >
              <span class="mi btnIco">content_paste</span>
              Import from clipboard
            </button>
            <button type="button" class="btn btnGhost" @click="showSettings = true">
              <span class="mi btnIco">keyboard</span>
              Grab hotkey…
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- ── SETTINGS MODAL ────────────────────────────────────────── -->
    <div v-if="showSettings" class="modalBackdrop" @click.self="showSettings = false">
      <div class="modal">
        <div class="modalTop">
          <h2 class="modalTitle">Settings</h2>
          <button class="iconBtn" @click="showSettings = false">
            <span class="mi">close</span>
          </button>
        </div>

        <!-- Connection -->
        <div class="settingsBlock">
          <div class="settingsBlockLabel">PoE Trade Connection</div>
          <div class="connRow">
            <span
              class="connBadge"
              :class="
                tradeConnected === true
                  ? 'connOk'
                  : tradeConnected === false
                    ? 'connBad'
                    : 'connUnk'
              "
            >
              {{
                tradeConnected === true
                  ? 'Connected'
                  : tradeConnected === false
                    ? 'Not connected'
                    : 'Unknown'
              }}
            </span>
            <span v-if="tradeConnected === false" class="connHint"
              >Search may 403 until connected</span
            >
          </div>
          <div class="settingsActions">
            <button class="btn btnSecondary" :disabled="connecting" @click="onConnect">
              <span class="mi btnIco">open_in_new</span>
              {{ connecting ? 'Opening…' : 'Connect to PoE Trade' }}
            </button>
            <button class="btn btnGhost" @click="refreshTradeStatus">Refresh</button>
          </div>
        </div>

        <!-- League -->
        <div class="settingsBlock">
          <div class="settingsBlockLabel">League</div>
          <div class="leagueRow">
            <select v-model="leagueSelectValue" class="settingsSelect" :disabled="leaguesLoading">
              <option v-for="l in availableLeagues" :key="l" :value="l">{{ l }}</option>
              <option value="__custom__">Custom…</option>
            </select>
            <button class="btn btnGhost" :disabled="leaguesLoading" @click="loadLeagues">
              {{ leaguesLoading ? '…' : 'Refresh' }}
            </button>
          </div>
          <div v-if="leaguesError" class="settingsError">{{ leaguesError }}</div>
          <div v-else-if="!leaguesLoading && availableLeagues.length === 0" class="settingsHint">
            No leagues loaded — check base URL or click Refresh.
          </div>
          <div v-if="leagueSelectValue === '__custom__'" class="settingsSubField">
            <label class="settingsSubLabel">Custom league name</label>
            <input
              v-model="customLeague"
              class="settingsInput"
              placeholder="e.g. Fate of the Vaal"
            />
          </div>
        </div>

        <!-- Base URL -->
        <div class="settingsBlock">
          <div class="settingsBlockLabel">Trade Base URL</div>
          <input
            v-model="baseUrl"
            class="settingsInput"
            placeholder="https://www.pathofexile.com"
          />
        </div>

        <!-- Grab item: global hotkey -->
        <div class="settingsBlock">
          <div class="settingsBlockLabel">Grab item from game</div>
          <p class="settingsHint settingsHintTight">
            Press <code class="kbdHint">{{ grabItemHotkeyLabel }}</code> in PoE with an item
            highlighted to copy its data into this app (clipboard is restored).
            <strong>Change</strong> records a new key;
          </p>
          <label class="settingsSubLabel" for="overlayAccInput">Current keybind</label>
          <div class="accelRow">
            <input
              id="overlayAccInput"
              v-model="overlayAccelerator"
              class="settingsInput accelInput"
              :placeholder="DEFAULT_OVERLAY_ACCELERATOR"
              spellcheck="false"
              autocomplete="off"
            />
            <button
              type="button"
              class="btn btnSecondary accelChangeBtn"
              @click="startRecordingKeybind"
            >
              Change
            </button>
          </div>
          <div v-if="overlayHotkeyRegError" class="settingsError">{{ overlayHotkeyRegError }}</div>
        </div>

        <!-- Hover stats -->
        <div class="settingsBlock">
          <div class="settingsBlockLabel">Item Stats on Hover</div>
          <label class="toggleRow">
            <input v-model="showItemStatsOnHover" type="checkbox" class="toggleCheck" />
            <span class="toggleLabel">Show item stats when hovering a result</span>
          </label>
        </div>

        <p class="settingsFooter">© 2026 | Bor Novak</p>
      </div>
    </div>

    <!-- Keybind recorder (Change) — capture phase listener on window while open -->
    <Teleport to="body">
      <div
        v-if="recordingKeybind"
        class="keybindRecorderBackdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keybindRecordTitle"
        @click.self="stopRecordingKeybind"
      >
        <div
          ref="keybindRecorderCardRef"
          class="keybindRecorderCard"
          tabindex="-1"
          @keydown.stop
          @click.stop
        >
          <h3 id="keybindRecordTitle" class="keybindRecorderTitle">Press new keybind</h3>
          <p class="keybindRecorderHint">
            Current: <code class="kbdHint">{{ grabItemHotkeyLabel }}</code
            >. Hold <strong>Ctrl</strong> (Windows) or <strong>Cmd</strong> (Mac), optional
            Shift/Alt, then the final key. <strong>Esc</strong> cancels.
          </p>
          <p v-if="keybindRecordError" class="settingsError keybindRecorderErr">
            {{ keybindRecordError }}
          </p>
          <button type="button" class="btn btnGhost" @click="stopRecordingKeybind">Cancel</button>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="listingTooltip && showItemStatsOnHover && listingTooltip.listing.stats"
        class="listingTooltipFloat"
        data-listing-tooltip-root
        :style="{
          left: listingTooltip.left + 'px',
          top: listingTooltip.top + 'px',
          maxHeight: listingTooltip.maxH + 'px'
        }"
        @mouseenter="clearListingTooltipHide"
        @mouseleave="scheduleListingTooltipHide"
      >
        <template v-if="listingTooltip.listing.stats">
          <div class="ttHead">Item Details</div>
          <div
            class="listingTooltipScroll"
            :style="{
              maxHeight: Math.max(96, listingTooltip.maxH - 56) + 'px'
            }"
            @wheel.stop
          >
            <div v-if="listingTooltip.listing.stats.properties?.length" class="ttSection">
              <div
                v-for="(line, i) in listingTooltip.listing.stats.properties"
                :key="'p' + i"
                class="ttRow"
              >
                <span class="ttKey">{{ line.split(':')[0] }}</span>
                <span class="ttVal">{{
                  line.includes(':') ? line.split(':').slice(1).join(':').trim() : ''
                }}</span>
              </div>
            </div>
            <div v-if="listingTooltip.listing.stats.requirements?.length" class="ttSection">
              <div class="ttSLabel">Requirements</div>
              <div
                v-for="(line, i) in listingTooltip.listing.stats.requirements"
                :key="'r' + i"
                class="ttRow"
              >
                {{ line }}
              </div>
            </div>
            <div v-if="listingTooltip.listing.stats.implicitMods?.length" class="ttSection">
              <div class="ttSLabel">Implicit</div>
              <div
                v-for="(line, i) in listingTooltip.listing.stats.implicitMods"
                :key="'im' + i"
                class="ttMod ttImplicit"
              >
                {{ line }}
              </div>
            </div>
            <div v-if="listingTooltip.listing.stats.runeMods?.length" class="ttSection">
              <div class="ttSLabel">Runes / augments</div>
              <div
                v-for="(line, i) in listingTooltip.listing.stats.runeMods"
                :key="'run' + i"
                class="ttMod ttRune"
              >
                {{ line }}
              </div>
            </div>
            <div v-if="listingTooltip.listing.stats.explicitMods?.length" class="ttSection">
              <div class="ttSLabel">Explicit</div>
              <div
                v-for="(line, i) in listingTooltip.listing.stats.explicitMods"
                :key="'ex' + i"
                class="ttMod"
              >
                {{ line }}
              </div>
            </div>
            <div v-if="listingTooltip.listing.stats.craftedMods?.length" class="ttSection">
              <div
                v-for="(line, i) in listingTooltip.listing.stats.craftedMods"
                :key="'cr' + i"
                class="ttMod ttCrafted"
              >
                {{ line }}
              </div>
            </div>
            <div v-if="listingTooltip.listing.stats.enchantMods?.length" class="ttSection">
              <div
                v-for="(line, i) in listingTooltip.listing.stats.enchantMods"
                :key="'en' + i"
                class="ttMod ttEnchant"
              >
                {{ line }}
              </div>
            </div>
            <div v-if="listingTooltip.listing.stats.fracturedMods?.length" class="ttSection">
              <div
                v-for="(line, i) in listingTooltip.listing.stats.fracturedMods"
                :key="'fr' + i"
                class="ttMod ttFractured"
              >
                {{ line }}
              </div>
            </div>
            <div v-if="listingTooltip.listing.stats.corrupted" class="ttCorrupted">Corrupted</div>
          </div>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ─── Tokens ────────────────────────────────────────────────────── */
.app {
  --gold: #e7c178;
  --gold-dim: #b3914d;
  --purple: #e5b4ff;
  --purple-bg: #692a90;
  --purple-on: #dda1ff;
  --bg: #131313;
  --s0: #0e0e0e;
  --s1: #1c1b1b;
  --s2: #201f1f;
  --s3: #2a2a2a;
  --s4: #353534;
  --s5: #3a3939;
  --text: #e5e2e1;
  --text-dim: #d1c5b4;
  --outline: #4d4639;
  --error: #ffb4ab;
  --error-bg: #93000a;

  min-height: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--bg);
  color: var(--text);
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

/* ─── Material Symbols ──────────────────────────────────────────── */
.mi {
  font-family: 'Material Symbols Outlined';
  font-variation-settings:
    'FILL' 0,
    'wght' 400,
    'GRAD' 0,
    'opsz' 24;
  font-size: 20px;
  line-height: 1;
  display: inline-block;
  vertical-align: middle;
  user-select: none;
  font-style: normal;
}

/* ─── Scrollbar ─────────────────────────────────────────────────── */
::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
::-webkit-scrollbar-track {
  background: var(--s0);
}
::-webkit-scrollbar-thumb {
  background: var(--gold);
}

/* ─── Header ─────────────────────────────────────────────────────── */
.appHeader {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--s0);
  box-shadow: 0 4px 32px rgba(231, 193, 120, 0.06);
  -webkit-app-region: drag;
  app-region: drag;
}
.headerInner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 28px;
}
.headerActions {
  display: flex;
  align-items: center;
  gap: 2px;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
.headerBrand {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--gold);
}
.brandText {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.brandTitle {
  font-family: 'Newsreader', serif;
  font-size: 20px;
  font-weight: 600;
  color: var(--gold);
  letter-spacing: -0.02em;
  margin: 0;
  line-height: 1.15;
}
.brandSub {
  margin: 0;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 500;
  color: rgba(209, 197, 180, 0.55);
  letter-spacing: 0.02em;
}
.iconBtn {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  background: transparent;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s;
  border-radius: 2px;
}
.iconBtn:hover {
  color: var(--gold);
}
.iconBtnClose:hover {
  color: var(--error);
}

/* ─── Status bar ────────────────────────────────────────────────── */
.statusBar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 24px;
  background: var(--s0);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  border-top: 1px solid rgba(77, 70, 57, 0.15);
}
.statusBolt {
  font-size: 14px;
}
.stConnected {
  color: rgba(90, 220, 150, 0.85);
}
.stBad {
  color: var(--error);
}
.stUnk {
  color: var(--text-dim);
}
.stLeague {
  color: var(--gold);
}

/* ─── Main layout ───────────────────────────────────────────────── */
.mainWrap {
  max-width: 1160px;
  margin: 0 auto;
  padding: 32px 28px 80px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.errorStrip {
  padding: 11px 14px;
  background: var(--error-bg);
  color: var(--error);
  font-size: 12px;
  white-space: pre-wrap;
  border-radius: 2px;
  flex-shrink: 0;
}

.filterToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--s1);
  border: 1px solid rgba(77, 70, 57, 0.12);
}

.importOnlyView {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  padding: 24px 16px;
}
.importOnlyCard {
  max-width: 420px;
  text-align: center;
  padding: 28px 24px;
  background: var(--s1);
  border: 1px solid rgba(77, 70, 57, 0.15);
}
.importOnlyIco {
  font-size: 40px;
  color: var(--gold);
  opacity: 0.85;
  display: block;
  margin-bottom: 12px;
}
.importOnlyTitle {
  font-family: 'Newsreader', serif;
  font-size: 20px;
  font-weight: 600;
  color: var(--gold);
  margin: 0 0 10px;
}
.importOnlyText {
  margin: 0 0 20px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-dim);
}
.kbdHint {
  display: inline;
  padding: 2px 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--gold);
  background: var(--s2);
  border: 1px solid rgba(231, 193, 120, 0.25);
  border-radius: 2px;
}
.importOnlyActions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}
.settingsInlineCode {
  font-family: ui-monospace, monospace;
  font-size: 10px;
  color: var(--gold-dim);
  padding: 1px 5px;
  background: var(--s2);
  border-radius: 2px;
}

.accelRow {
  display: flex;
  gap: 10px;
  align-items: stretch;
}
.accelInput {
  flex: 1;
  min-width: 0;
}
.accelChangeBtn {
  flex-shrink: 0;
}

.keybindRecorderBackdrop {
  position: fixed;
  inset: 0;
  z-index: 20000;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.keybindRecorderCard {
  max-width: 420px;
  width: 100%;
  padding: 24px 22px;
  background: var(--s1);
  border: 1px solid rgba(231, 193, 120, 0.2);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.75);
  outline: none;
}
.keybindRecorderTitle {
  font-family: 'Newsreader', serif;
  font-size: 18px;
  font-weight: 600;
  color: var(--gold);
  margin: 0 0 10px;
}
.keybindRecorderHint {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-dim);
}
.keybindRecorderErr {
  margin-bottom: 12px;
}

/* ─── Buttons ───────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 10px 18px;
  transition:
    background 0.15s,
    box-shadow 0.15s;
  border-radius: 2px;
  white-space: nowrap;
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn:active:not(:disabled) {
  background: var(--s0) !important;
}
.btnPrimary {
  background: var(--gold);
  color: #3a2600;
}
.btnPrimary:hover:not(:disabled) {
  background: #f0cc84;
}
.btnSecondary {
  background: var(--s4);
  color: var(--text);
  box-shadow: inset 0 0 0 1px rgba(231, 193, 120, 0.2);
}
.btnSecondary:hover:not(:disabled) {
  background: var(--s5);
}
.btnGhost {
  background: transparent;
  color: var(--text-dim);
  box-shadow: inset 0 0 0 1px rgba(77, 70, 57, 0.45);
}
.btnGhost:hover:not(:disabled) {
  color: var(--gold);
  box-shadow: inset 0 0 0 1px rgba(231, 193, 120, 0.3);
}
.btnIco {
  font-size: 15px;
}

/* ─── Body layout ───────────────────────────────────────────────── */
.bodyLayout {
  display: grid;
  grid-template-columns: minmax(300px, 360px) 1fr;
  gap: 20px;
  align-items: start;
}

/* ─── Item sidebar ──────────────────────────────────────────────── */
.itemSidebar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ─── Item card ─────────────────────────────────────────────────── */
.itemCard {
  background: var(--s1);
  padding: 28px 20px 22px;
  position: relative;
  overflow: hidden;
  text-align: center;
}
.itemCardDecor {
  position: absolute;
  right: -14px;
  top: -14px;
  opacity: 0.04;
  transform: rotate(12deg);
  pointer-events: none;
}
.itemCardDecorIcon {
  font-size: 108px;
  color: var(--gold);
}
.itemCardBody {
  position: relative;
}
.itemName {
  font-family: 'Newsreader', serif;
  font-size: 22px;
  font-weight: 600;
  color: var(--gold);
  letter-spacing: -0.02em;
  margin: 0 0 4px;
  line-height: 1.15;
}
.itemTypeLine {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--purple);
  font-weight: 700;
  margin: 0 0 14px;
}
.itemChips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  justify-content: center;
}
.chip {
  padding: 3px 9px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: 2px;
}
.chipNormal {
  background: var(--s4);
  color: var(--text);
}
.chipCorrupted {
  background: var(--purple-bg);
  color: var(--purple-on);
}

/* ─── Filter area ───────────────────────────────────────────────── */
.filterArea {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filterSection {
  background: var(--s1);
  padding: 12px 14px;
}
.filterSecHead {
  padding-bottom: 7px;
  border-bottom: 1px solid rgba(77, 70, 57, 0.12);
  margin-bottom: 9px;
}
.filterSecLabel {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.22em;
}
.labelGold {
  color: var(--gold);
}
.labelPurple {
  color: var(--purple);
}
.labelMuted {
  color: var(--text-dim);
}

.filterList {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ─── Results area ──────────────────────────────────────────────── */
.resultsArea {
  display: flex;
  flex-direction: column;
}

.resultsHead {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(77, 70, 57, 0.1);
  margin-bottom: 4px;
}
.resultsTitle {
  font-family: 'Newsreader', serif;
  font-size: 21px;
  font-weight: 500;
  color: var(--gold);
  margin: 0;
  letter-spacing: -0.01em;
}
.resultsCount {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.resultsSortHint {
  text-transform: none;
  letter-spacing: 0.06em;
  font-weight: 500;
  opacity: 0.75;
}

.resultsNotice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  padding: 8px 12px;
  border: 1px solid rgba(200, 162, 75, 0.35);
  background: rgba(200, 162, 75, 0.08);
  color: var(--text-dim);
  font-size: 12px;
  letter-spacing: 0.02em;
  border-radius: 2px;
}
.resultsNotice .noticeIco {
  font-size: 16px;
  color: var(--gold);
}

.emptyState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 20px;
  gap: 14px;
  color: var(--text-dim);
  font-size: 13px;
  text-align: center;
}
.emptyIco {
  font-size: 42px;
  opacity: 0.25;
}
.emptyState strong {
  color: var(--gold);
}

/* ─── Listing rows ──────────────────────────────────────────────── */
.listingList {
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.listingRow {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 15px 20px;
  background: var(--s1);
  margin-top: 2px;
  transition: background 0.2s;
  overflow: visible;
}
.listingRow:hover {
  background: var(--s3);
}

.listingAccent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0;
  background: var(--gold);
  transition: width 0.2s;
}
.listingRow:hover .listingAccent {
  width: 2px;
}

/* ─── Eye (decorative) + floating tooltip (teleported to body) ─── */
.listingEye {
  position: relative;
  flex-shrink: 0;
  pointer-events: auto;
}
.eyeBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  background: var(--s4);
  color: var(--text-dim);
  border-radius: 2px;
}
.listingRow:hover .eyeBtn {
  color: var(--gold);
}

.listingTooltipFloat {
  position: fixed;
  z-index: 10000;
  width: 320px;
  max-width: min(320px, calc(100vw - 20px));
  padding: 0;
  box-sizing: border-box;
  display: block;
  overflow: hidden;
  overscroll-behavior: contain;
  background: rgba(14, 14, 14, 0.96);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(77, 70, 57, 0.2);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.65);
  border-radius: 2px;
  pointer-events: auto;
}

.listingTooltipScroll {
  overflow-x: hidden;
  overflow-y: scroll;
  padding: 0 18px 18px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}
.listingTooltipScroll::-webkit-scrollbar {
  width: 8px;
}
.listingTooltipScroll::-webkit-scrollbar-thumb {
  background: rgba(231, 193, 120, 0.28);
  border-radius: 4px;
}
.listingTooltipScroll::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
}

.ttHead {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--gold);
  padding: 16px 18px 10px;
  margin: 0;
  border-bottom: 1px solid rgba(77, 70, 57, 0.2);
}
.ttSection {
  margin-top: 14px;
}
.listingTooltipScroll > .ttSection:first-child {
  margin-top: 12px;
}
.ttSLabel {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.ttRow {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-dim);
  padding: 5px 0;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.ttKey {
  flex-shrink: 0;
}
.ttVal {
  color: var(--text);
  font-weight: 600;
  min-width: 0;
  text-align: right;
}
.ttMod {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-dim);
  font-family: ui-monospace, monospace;
  padding: 5px 0;
  word-break: break-word;
  overflow-wrap: anywhere;
  white-space: normal;
}
.ttImplicit {
  color: rgba(140, 200, 255, 0.9);
}
.ttRune {
  color: rgba(200, 220, 160, 0.92);
}
.ttCrafted {
  color: rgba(130, 255, 170, 0.9);
}
.ttFractured {
  color: rgba(255, 210, 140, 0.9);
}
.ttEnchant {
  color: rgba(255, 170, 255, 0.9);
}
.ttCorrupted {
  margin-top: 12px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--purple);
}

/* ─── Listing info ──────────────────────────────────────────────── */
.listingInfo {
  flex: 1;
  min-width: 0;
}
.listingName {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.listingMeta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-dim);
  align-items: center;
  flex-wrap: wrap;
}
.metaSep {
  opacity: 0.45;
}
.metaCorrupted {
  color: var(--purple);
  font-weight: 700;
}

/* ─── Price ─────────────────────────────────────────────────────── */
.listingRight {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
}
.priceBlock {
  display: flex;
  align-items: baseline;
  gap: 5px;
}
.priceAmt {
  font-family: 'Newsreader', serif;
  font-size: 24px;
  font-weight: 500;
  color: var(--purple);
  line-height: 1;
}
.priceCurr {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: rgba(229, 180, 255, 0.65);
}

/* ─── Settings modal ────────────────────────────────────────────── */
.modalBackdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.68);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 40px 16px 80px;
  z-index: 100;
  overflow-y: auto;
}
.modal {
  width: min(580px, 100%);
  background: var(--s1);
  box-shadow:
    0 40px 80px rgba(0, 0, 0, 0.75),
    0 0 0 1px rgba(231, 193, 120, 0.08);
  display: flex;
  flex-direction: column;
}
.modalTop {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid rgba(77, 70, 57, 0.1);
}
.modalTitle {
  font-family: 'Newsreader', serif;
  font-size: 18px;
  font-weight: 500;
  color: var(--gold);
  margin: 0;
}

.settingsBlock {
  padding: 18px 22px;
  border-bottom: 1px solid rgba(77, 70, 57, 0.08);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.settingsBlock:last-of-type {
  border-bottom: none;
}
.settingsFooter {
  margin: 0;
  padding: 14px 22px 20px;
  font-size: 11px;
  color: var(--text-dim);
  text-align: center;
  letter-spacing: 0.06em;
  border-top: 1px solid rgba(77, 70, 57, 0.08);
}
.settingsBlockLabel {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--gold);
}
.connRow {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.connBadge {
  padding: 3px 10px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  border-radius: 2px;
}
.connOk {
  background: rgba(90, 220, 150, 0.1);
  color: rgba(90, 220, 150, 0.9);
}
.connBad {
  background: rgba(255, 138, 138, 0.1);
  color: rgba(255, 138, 138, 0.9);
}
.connUnk {
  background: var(--s4);
  color: var(--text-dim);
}
.connHint {
  font-size: 11px;
  color: var(--text-dim);
}
.settingsActions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.cookieDet {
}
.cookieSum {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-dim);
  cursor: pointer;
}
.cookiePre {
  margin: 8px 0 0;
  padding: 10px;
  background: var(--s0);
  font-size: 11px;
  color: var(--text-dim);
  white-space: pre-wrap;
  border-radius: 2px;
}

.leagueRow {
  display: flex;
  gap: 8px;
  align-items: center;
}
.settingsSelect,
.settingsInput {
  flex: 1;
  background: var(--s2);
  border: none;
  outline: none;
  color: var(--text);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  padding: 10px 12px;
  border-radius: 2px;
  transition: background 0.2s;
  width: 100%;
  box-sizing: border-box;
}
.settingsSelect:focus,
.settingsInput:focus {
  background: var(--s3);
}
.settingsSelect option {
  background: var(--s2);
}
.settingsError {
  font-size: 11px;
  color: var(--error);
}
.settingsHint {
  font-size: 11px;
  color: var(--text-dim);
}
.settingsHintTight {
  margin: 0 0 10px;
  line-height: 1.45;
}
.settingsLink {
  color: var(--gold);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.settingsLink:hover {
  color: var(--gold-dim);
}
.settingsSubField {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.settingsSubLabel {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.toggleRow {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 10px 12px;
  background: var(--s2);
  border-radius: 2px;
  transition: background 0.15s;
}
.toggleRow:hover {
  background: var(--s3);
}
.toggleCheck {
  appearance: none;
  -webkit-appearance: none;
  width: 13px;
  height: 13px;
  border: 1px solid rgba(77, 70, 57, 0.65);
  background: var(--s3);
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 2px;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.toggleCheck:checked {
  background: var(--gold);
  border-color: var(--gold);
}
.toggleLabel {
  font-size: 12px;
  color: var(--text-dim);
}
.toggleRow:hover .toggleLabel {
  color: var(--text);
}

/* ─── Responsive ────────────────────────────────────────────────── */
@media (max-width: 860px) {
  .bodyLayout {
    grid-template-columns: 1fr;
  }
  .mainWrap {
    padding: 24px 16px 80px;
  }
}
</style>
