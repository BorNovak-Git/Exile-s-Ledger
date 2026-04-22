<script setup lang="ts">
import { computed, watch } from 'vue'
import type { TradeFilterOption } from '../../shared/trade'

const props = defineProps<{
  filter: TradeFilterOption
  selected: boolean
  bullet: 'gold' | 'muted' | 'purple'
  slots: ('min' | 'max')[]
  /** Threshold slider like Awakened PoE Trade; plain inputs for edge cases */
  numericUi: 'slider' | 'inputs'
}>()

const emit = defineEmits<{
  toggle: [id: string, checked: boolean]
  numericPatch: [id: string, patch: { min?: number; max?: number }]
}>()

const bulletClass = computed(() => {
  if (props.bullet === 'gold') return 'efBullet efBulletGold'
  if (props.bullet === 'muted') return 'efBullet efBulletMuted'
  return 'efBullet efBulletPurple'
})

const num = computed(() => (props.filter.value?.kind === 'number' ? props.filter.value : null))

const modChip = computed((): 'Rune' | 'Desecrated' | null => {
  const t = props.filter.modTag
  if (t === 'rune') return 'Rune'
  if (t === 'desecrated') return 'Desecrated'
  return null
})

/** Slider endpoints: tier span from clipboard, or 0 … item roll */
const sliderBounds = computed(() => {
  const b = props.filter.modRollBounds
  if (b && Number.isFinite(b.min) && Number.isFinite(b.max) && b.max >= b.min)
    return { min: b.min, max: b.max }
  const r = props.filter.modRoll ?? 0
  return { min: 0, max: Math.max(Math.floor(r), 1) }
})

if (props.numericUi === 'slider') {
  watch(
    sliderBounds,
    (b) => {
      console.log(
        '[EditableFilterRow] slider bounds',
        props.filter.tradeId ?? props.filter.id,
        `"${props.filter.label}"`,
        b,
        'itemRoll=',
        props.filter.modRoll,
        'rollBounds=',
        props.filter.modRollBounds
      )
    },
    { immediate: true, deep: true }
  )
}

function clamp(n: number): number {
  const { min, max } = sliderBounds.value
  return Math.min(max, Math.max(min, n))
}

const thresholdDisplay = computed(() => {
  const v = props.filter.value
  if (v?.kind !== 'number') return sliderBounds.value.min
  const raw = v.min ?? v.max
  if (raw === undefined) return sliderBounds.value.min
  return clamp(Number(raw))
})

const fillPct = computed(() => {
  const { min, max } = sliderBounds.value
  const t = thresholdDisplay.value
  if (max <= min) return 100
  return ((t - min) / (max - min)) * 100
})

function onToggle(ev: Event): void {
  const t = ev.target as HTMLInputElement
  emit('toggle', props.filter.id, t.checked)
}

/** Snap to tier max when present, otherwise to the item roll (slider top) */
function snapMaxThreshold(): number {
  const cap = props.filter.modRollBounds?.max ?? props.filter.modRoll ?? sliderBounds.value.max
  return clamp(cap)
}

function onMaxClick(ev: MouseEvent): void {
  ev.preventDefault()
  ev.stopPropagation()
  emit('numericPatch', props.filter.id, { min: snapMaxThreshold() })
}

function onSliderInput(ev: Event): void {
  ev.stopPropagation()
  const raw = Number((ev.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  emit('numericPatch', props.filter.id, { min: clamp(raw) })
}

function onSliderNum(ev: Event): void {
  ev.stopPropagation()
  const t = (ev.target as HTMLInputElement).value.trim()
  const parsed = t === '' || t === '-' ? NaN : Number(t)
  if (!Number.isFinite(parsed)) return
  emit('numericPatch', props.filter.id, { min: clamp(parsed) })
}

function onNumField(slot: 'min' | 'max', ev: Event): void {
  emit('numericPatch', props.filter.id, slotPayload(slot, (ev.target as HTMLInputElement).value))
}

function slotPayload(slot: 'min' | 'max', raw: string): { min?: number; max?: number } {
  const t = raw.trim()
  const parsed: number | undefined = t === '' || t === '-' ? undefined : Number(t)
  if (parsed !== undefined && Number.isNaN(parsed)) return {}
  return slot === 'min' ? { min: parsed } : { max: parsed }
}

function valueFor(slot: 'min' | 'max'): string {
  const v = num.value
  if (!v) return ''
  const n = slot === 'min' ? v.min : v.max
  return n === undefined ? '' : String(n)
}

const showSlider = computed(
  () => props.numericUi === 'slider' && num.value !== null && props.slots.includes('min')
)
</script>

<template>
  <li>
    <label class="efRow" :class="{ efRowOn: selected }">
      <input type="checkbox" :checked="selected" class="efCheck" @change="onToggle" />
      <span :class="bulletClass"></span>
      <div class="efBody">
        <div class="efLabelLine">
          <span v-if="modChip" class="efModChip">{{ modChip }}</span>
          <span class="efLabel">{{ filter.label }}</span>
        </div>

        <!-- Awakened-style slider -->
        <div v-if="showSlider" class="efSliderWrap" @mousedown.stop @click.stop>
          <div class="efSliderTop">
            <input
              type="number"
              class="efSliderNum"
              step="any"
              :value="thresholdDisplay"
              @input="onSliderNum"
              @mousedown.stop
              @click.stop
            />
            <button type="button" class="efMaxBtn" @click="onMaxClick">MAX</button>
          </div>
          <input
            type="range"
            class="efRange"
            :style="{ '--fill': fillPct + '%' }"
            :min="sliderBounds.min"
            :max="sliderBounds.max"
            step="any"
            :value="thresholdDisplay"
            @input="onSliderInput"
            @mousedown.stop
            @click.stop
          />
          <div class="efSliderTicks">
            <span>{{ sliderBounds.min }}</span>
            <span>{{ sliderBounds.max }}</span>
          </div>
        </div>

        <!-- Rare rows: req level ≤, pure ES caps, legacy -->
        <div v-else-if="num && slots.length" class="efNums" @click.stop.prevent>
          <label v-if="slots.includes('min')" class="efNumField">
            <span class="efNumLab">Min</span>
            <input
              type="number"
              class="efNumInp"
              step="any"
              :value="valueFor('min')"
              @input="onNumField('min', $event)"
            />
          </label>
          <label v-if="slots.includes('max')" class="efNumField">
            <span class="efNumLab">Max</span>
            <input
              type="number"
              class="efNumInp"
              step="any"
              :value="valueFor('max')"
              @input="onNumField('max', $event)"
            />
          </label>
        </div>
      </div>
    </label>
  </li>
</template>

<style scoped>
.efRow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  padding: 6px 0;
}
.efCheck {
  appearance: none;
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  border: 1px solid rgba(77, 70, 57, 0.65);
  background: var(--s2, #201f1f);
  flex-shrink: 0;
  margin-top: 3px;
  cursor: pointer;
  border-radius: 1px;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.efCheck:checked {
  background: var(--gold, #e7c178);
  border-color: var(--gold, #e7c178);
}
.efBullet {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 6px;
  opacity: 0.4;
  transition: opacity 0.15s;
}
.efRow:hover .efBullet,
.efRowOn .efBullet {
  opacity: 1;
}
.efBulletGold {
  background: var(--gold, #e7c178);
}
.efBulletMuted {
  background: var(--text-dim, #d1c5b4);
}
.efBulletPurple {
  background: var(--purple, #e5b4ff);
}

.efBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* Same visual language as `.chipCorrupted` on the item card */
.efLabelLine {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 8px;
}
.efModChip {
  flex-shrink: 0;
  padding: 3px 9px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: 2px;
  background: var(--purple-bg);
  color: var(--purple-on);
}
.efLabel {
  font-size: 11px;
  color: var(--text-dim, #d1c5b4);
  line-height: 1.4;
  transition: color 0.15s;
}
.efRow:hover .efLabel,
.efRowOn .efLabel {
  color: var(--text, #e5e2e1);
}

.efSliderWrap {
  cursor: default;
  padding-top: 2px;
}

.efSliderTop {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.efSliderNum {
  width: 72px;
  padding: 5px 7px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--text, #e5e2e1);
  background: rgba(14, 14, 14, 0.9);
  border: 1px solid rgba(77, 70, 57, 0.45);
  border-radius: 2px;
  outline: none;
}

.efSliderNum:focus {
  border-color: rgba(95, 184, 232, 0.55);
}

.efMaxBtn {
  flex-shrink: 0;
  padding: 5px 10px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-dim, #d1c5b4);
  background: rgba(22, 22, 24, 0.95);
  border: 1px solid rgba(77, 70, 57, 0.45);
  border-radius: 2px;
  cursor: pointer;
}
.efMaxBtn:hover {
  color: var(--text, #e5e2e1);
  border-color: rgba(95, 184, 232, 0.35);
}

/* Range — filled segment like Awakened */
.efRange {
  width: 100%;
  margin: 0;
  height: 20px;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  cursor: pointer;
  --fill: 50%;
}

.efRange::-webkit-slider-runnable-track {
  height: 7px;
  border-radius: 3px;
  background: linear-gradient(
    to right,
    rgba(94, 184, 232, 0.95) 0%,
    rgba(94, 184, 232, 0.95) var(--fill),
    rgba(34, 34, 38, 0.95) var(--fill),
    rgba(34, 34, 38, 0.95) 100%
  );
}

.efRange::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 12px;
  height: 14px;
  margin-top: -4px;
  border-radius: 2px;
  background: linear-gradient(180deg, #e8ecf0 0%, #c8cdd4 100%);
  border: 1px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}

.efRange::-moz-range-track {
  height: 7px;
  border-radius: 3px;
  background: rgba(34, 34, 38, 0.95);
}

.efRange::-moz-range-progress {
  height: 7px;
  border-radius: 3px 0 0 3px;
  background: rgba(94, 184, 232, 0.95);
}

.efRange::-moz-range-thumb {
  width: 12px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, #e8ecf0 0%, #c8cdd4 100%);
  border: 1px solid rgba(0, 0, 0, 0.35);
}

.efSliderTicks {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  padding: 0 1px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: rgba(209, 197, 180, 0.42);
}

.efNums {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
}
.efNumField {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: default;
}
.efNumLab {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(209, 197, 180, 0.55);
  flex-shrink: 0;
}
.efNumInp {
  width: 72px;
  padding: 5px 7px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--text, #e5e2e1);
  background: rgba(14, 14, 14, 0.9);
  border: 1px solid rgba(77, 70, 57, 0.45);
  border-radius: 2px;
  outline: none;
}
.efNumInp:focus {
  border-color: rgba(231, 193, 120, 0.45);
  background: rgba(42, 42, 42, 0.95);
}
</style>
