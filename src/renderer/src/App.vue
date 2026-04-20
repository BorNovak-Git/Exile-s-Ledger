<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue'
import type { ApiErrorShape, ParseItemTextResponse, TradeFilterOption, TradeSearchResponse } from '../../shared/trade'
import { loadSettings, saveSettings, type AppSettings } from './settings'

const itemText = ref('')
const settings = ref<AppSettings>(loadSettings())

const KNOWN_LEAGUES = ['Standard', 'Hardcore'] as const
type KnownLeague = (typeof KNOWN_LEAGUES)[number]

const leagueSelectValue = computed<string>({
  get() {
    return (KNOWN_LEAGUES as readonly string[]).includes(settings.value.league) ? settings.value.league : '__custom__'
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

function toggleSelected(id: string, checked: boolean): void {
  const next = new Set(selectedIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedIds.value = next
}

const selectedFilters = computed(() => filters.value.filter((f) => selectedIds.value.has(f.id)))

function toPlainSelectedFilters(list: TradeFilterOption[]): TradeFilterOption[] {
  // Vue wraps objects in reactive Proxies; Electron IPC can't structured-clone Proxies.
  return list.map((f) => {
    const rawF = toRaw(f) as TradeFilterOption
    const rawV = rawF.value ? (toRaw(rawF.value) as TradeFilterOption['value']) : undefined
    return {
      id: rawF.id,
      label: rawF.label,
      group: rawF.group,
      tradeId: rawF.tradeId,
      value: rawV ? { ...(rawV as any) } : undefined
    }
  })
}

async function onConvert(): Promise<void> {
  error.value = null
  results.value = null
  parsing.value = true
  try {
    const res = await window.api.trade.parseItemText(itemText.value)
    parseResult.value = res
    selectedIds.value = new Set(res.filters.map((f) => f.id))
    console.log('[renderer] parse result:', {
      itemName: res.itemName,
      itemType: res.itemType,
      filters: res.filters
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to parse item text'
  } finally {
    parsing.value = false
  }
}

function isApiErrorShape(x: unknown): x is ApiErrorShape {
  return !!x && typeof x === 'object' && 'message' in x
}

async function onSearch(): Promise<void> {
  error.value = null
  searching.value = true
  try {
    const plainSelected = toPlainSelectedFilters(selectedFilters.value)
    console.log('[renderer] selected filters (plain):', plainSelected)
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
      console.log('[renderer] search results:', { queryId: res.queryId, total: res.total, shown: res.results.length })
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
      console.log('[renderer] connect opened')
      // Poll status for a short time since cookies may be set after redirects/login.
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

onMounted(() => {
  // in case localStorage is cleared or schema changes
  settings.value = loadSettings()
  refreshTradeStatus()
})
</script>

<template>
  <div class="wrap">
    <header class="header">
      <div>
        <div class="title">PoE2 Trade Prototype</div>
        <div class="subtitle">Paste item text → pick filters → search</div>
      </div>
      <div class="headerActions">
        <button class="button" @click="showSettings = true">Settings</button>
      </div>
    </header>

    <div v-if="showSettings" class="modalBackdrop" @click.self="showSettings = false">
      <div class="modal">
        <div class="modalTop">
          <div class="modalTitle">Settings</div>
          <button class="button" @click="showSettings = false">Close</button>
        </div>

        <div class="settingsRow">
          <div>
            <div class="label">PoE trade connection</div>
            <div class="statusLine">
              <span
                class="statusBadge"
                :class="tradeConnected === true ? 'ok' : tradeConnected === false ? 'bad' : 'unknown'"
              >
                {{
                  tradeConnected === true
                    ? 'Connected'
                    : tradeConnected === false
                      ? 'Not connected'
                      : 'Unknown'
                }}
              </span>
              <span class="muted" v-if="tradeConnected === true">
                (Cloudflare cookies present)
              </span>
              <span class="muted" v-else-if="tradeConnected === false">
                (search may 403 until connected)
              </span>
            </div>
          </div>
          <div class="settingsButtons">
            <button class="button" :disabled="connecting" @click="onConnect">
              {{ connecting ? 'Opening…' : 'Connect to PoE Trade' }}
            </button>
            <button class="button" @click="refreshTradeStatus">Refresh status</button>
          </div>
        </div>

        <details class="cookieDetails">
          <summary>Show cookie names (debug)</summary>
          <pre class="cookiePre">{{ tradeCookies.join('\n') }}</pre>
        </details>

        <div class="settingsGrid">
          <label class="field">
            <div class="label">League</div>
            <select v-model="leagueSelectValue" class="input">
              <option v-for="l in (KNOWN_LEAGUES as readonly KnownLeague[])" :key="l" :value="l">
                {{ l }}
              </option>
              <option value="__custom__">Custom…</option>
            </select>
          </label>

          <label class="field" v-if="leagueSelectValue === '__custom__'">
            <div class="label">Custom league</div>
            <input v-model="customLeague" class="input" placeholder="e.g. Standard" />
          </label>

          <label class="field">
            <div class="label">Trade base URL</div>
            <input v-model="baseUrl" class="input" placeholder="https://www.pathofexile.com" />
          </label>

          <label class="field checkboxField">
            <div class="label">Results hover</div>
            <label class="checkboxRow">
              <input type="checkbox" v-model="showItemStatsOnHover" />
              <span>Show item stats on hover</span>
            </label>
          </label>
        </div>
      </div>
    </div>

    <section class="card">
      <label class="field">
        <div class="label">Item text</div>
        <textarea
          v-model="itemText"
          class="textarea"
          placeholder="Paste the item text copied from the game here…"
          spellcheck="false"
        />
      </label>

      <div class="row actions">
        <button class="button" :disabled="parsing || itemText.trim().length === 0" @click="onConvert">
          {{ parsing ? 'Converting…' : 'Convert to trade filters' }}
        </button>
        <button class="button primary" :disabled="searching || selectedFilters.length === 0" @click="onSearch">
          {{ searching ? 'Searching…' : 'Search' }}
        </button>
      </div>

      <div v-if="error" class="error">{{ error }}</div>
    </section>

    <section class="grid">
      <div class="card">
        <div class="sectionTitle">Filters</div>
        <div v-if="!parseResult" class="muted">
          Click “Convert to trade filters” to generate selectable filters from the pasted item text.
        </div>
        <div v-else class="filters">
          <div class="muted" v-if="filters.length === 0">No filters detected.</div>
          <label v-for="f in filters" :key="f.id" class="filter">
            <input
              type="checkbox"
              :checked="selectedIds.has(f.id)"
              @change="toggleSelected(f.id, ($event.target as HTMLInputElement).checked)"
            />
            <span class="filterLabel">{{ f.label }}</span>
            <span class="filterGroup">{{ f.group }}</span>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="sectionTitle">Results</div>
        <div v-if="!results" class="muted">Run a search to see matching listings.</div>
        <div v-else>
          <div class="muted" v-if="results.total !== undefined">
            Total matches: {{ results.total }} (showing {{ results.results.length }})
          </div>
          <div class="results">
            <div v-for="r in results.results" :key="r.id" class="result">
              <div class="resultTop">
                <div class="resultTitle">
                  {{ (r.name && r.name.length ? r.name + ' ' : '') + (r.typeLine ?? '') }}
                </div>
                <div class="resultPrice">{{ r.price ?? '' }}</div>
              </div>
              <div class="resultMeta">
                <span v-if="r.seller">Seller: {{ r.seller }}</span>
                <span v-if="r.ilvl !== undefined">iLvl: {{ r.ilvl }}</span>
                <span v-if="r.corrupted">Corrupted</span>
                <span v-if="r.note">Note: {{ r.note }}</span>
              </div>

              <div v-if="showItemStatsOnHover && r.stats" class="hoverCard">
                <div v-if="r.stats.properties?.length" class="hoverSection">
                  <div class="hoverTitle">Properties</div>
                  <div v-for="(line, i) in r.stats.properties" :key="'p' + i" class="hoverLine">{{ line }}</div>
                </div>
                <div v-if="r.stats.requirements?.length" class="hoverSection">
                  <div class="hoverTitle">Requirements</div>
                  <div v-for="(line, i) in r.stats.requirements" :key="'r' + i" class="hoverLine">{{ line }}</div>
                </div>
                <div v-if="r.stats.implicitMods?.length" class="hoverSection">
                  <div class="hoverTitle">Implicit</div>
                  <div v-for="(line, i) in r.stats.implicitMods" :key="'im' + i" class="hoverLine mod implicit">
                    {{ line }}
                  </div>
                </div>
                <div v-if="r.stats.explicitMods?.length" class="hoverSection">
                  <div class="hoverTitle">Explicit</div>
                  <div v-for="(line, i) in r.stats.explicitMods" :key="'em' + i" class="hoverLine mod explicit">
                    {{ line }}
                  </div>
                </div>
                <div v-if="r.stats.enchantMods?.length" class="hoverSection">
                  <div class="hoverTitle">Enchant</div>
                  <div v-for="(line, i) in r.stats.enchantMods" :key="'en' + i" class="hoverLine mod enchant">
                    {{ line }}
                  </div>
                </div>
                <div v-if="r.stats.fracturedMods?.length" class="hoverSection">
                  <div class="hoverTitle">Fractured</div>
                  <div v-for="(line, i) in r.stats.fracturedMods" :key="'fr' + i" class="hoverLine mod fractured">
                    {{ line }}
                  </div>
                </div>
                <div v-if="r.stats.craftedMods?.length" class="hoverSection">
                  <div class="hoverTitle">Crafted</div>
                  <div v-for="(line, i) in r.stats.craftedMods" :key="'cr' + i" class="hoverLine mod crafted">
                    {{ line }}
                  </div>
                </div>
              </div>

              <details v-if="r.whisper" class="whisper">
                <summary>Whisper</summary>
                <pre class="whisperText">{{ r.whisper }}</pre>
              </details>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.headerActions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.title {
  font-size: 22px;
  font-weight: 700;
}
.subtitle {
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.card {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 14px;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}
.input,
.textarea {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 10px 12px;
  color: rgba(255, 255, 255, 0.9);
  outline: none;
}
.textarea {
  min-height: 180px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 12px;
  line-height: 1.4;
}
.actions {
  margin-top: 10px;
}
.button {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.9);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
}
.button.primary {
  background: rgba(84, 153, 255, 0.25);
  border-color: rgba(84, 153, 255, 0.45);
}
.button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.modalBackdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 48px 16px;
  z-index: 50;
}
.modal {
  width: min(920px, 100%);
  background: rgba(20, 22, 30, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  padding: 14px;
}
.modalTop {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.modalTitle {
  font-size: 16px;
  font-weight: 700;
}
.settingsRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.18);
}
.settingsButtons {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.settingsGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}
.statusLine {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}
.statusBadge {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
}
.statusBadge.ok {
  border-color: rgba(90, 255, 173, 0.35);
  background: rgba(90, 255, 173, 0.12);
}
.statusBadge.bad {
  border-color: rgba(255, 122, 122, 0.35);
  background: rgba(255, 122, 122, 0.12);
}
.statusBadge.unknown {
  border-color: rgba(255, 255, 255, 0.18);
}
.cookieDetails {
  margin-top: 12px;
}
.cookiePre {
  margin: 8px 0 0;
  padding: 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.08);
  white-space: pre-wrap;
  font-size: 12px;
}
.error {
  margin-top: 10px;
  color: #ff8a8a;
  font-size: 13px;
  white-space: pre-wrap;
}
.sectionTitle {
  font-weight: 700;
  margin-bottom: 8px;
}
.muted {
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
}
.filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  max-height: 520px;
  overflow: auto;
  padding-right: 4px;
}
.filter {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.18);
}
.filterLabel {
  font-size: 13px;
}
.filterGroup {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.results {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  max-height: 520px;
  overflow: auto;
  padding-right: 4px;
}
.result {
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.18);
  position: relative;
}
.resultTop {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.resultTitle {
  font-weight: 600;
  font-size: 13px;
}
.resultPrice {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
}
.resultMeta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}
.whisper {
  margin-top: 8px;
}
.whisperText {
  margin: 8px 0 0;
  padding: 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.08);
  white-space: pre-wrap;
  font-size: 12px;
}

.checkboxField {
  grid-column: 1 / -1;
}
.checkboxRow {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
}

.hoverCard {
  display: none;
  position: absolute;
  left: 10px;
  right: 10px;
  top: calc(100% + 8px);
  z-index: 20;
  padding: 10px;
  border-radius: 12px;
  background: rgba(20, 22, 30, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}
.result:hover .hoverCard {
  display: block;
}
.hoverSection + .hoverSection {
  margin-top: 10px;
}
.hoverTitle {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 6px;
}
.hoverLine {
  font-size: 12px;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.88);
}
.hoverLine.mod {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}
.hoverLine.mod.implicit {
  color: rgba(140, 200, 255, 0.92);
}
.hoverLine.mod.crafted {
  color: rgba(130, 255, 170, 0.92);
}
.hoverLine.mod.fractured {
  color: rgba(255, 210, 140, 0.92);
}
.hoverLine.mod.enchant {
  color: rgba(255, 170, 255, 0.92);
}
@media (max-width: 980px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .row {
    grid-template-columns: 1fr;
  }
  .settingsGrid {
    grid-template-columns: 1fr;
  }
}
</style>
