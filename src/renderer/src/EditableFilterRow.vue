<script setup lang="ts">
import { computed } from 'vue'
import type { TradeFilterOption } from '../../shared/trade'

const props = defineProps<{
  filter: TradeFilterOption
  selected: boolean
  bullet: 'gold' | 'muted' | 'purple'
  slots: ('min' | 'max')[]
}>()

const emit = defineEmits<{
  toggle: [id: string, checked: boolean]
  numInput: [id: string, field: 'min' | 'max', raw: string]
}>()

const bulletClass = computed(() => {
  if (props.bullet === 'gold') return 'efBullet efBulletGold'
  if (props.bullet === 'muted') return 'efBullet efBulletMuted'
  return 'efBullet efBulletPurple'
})

const num = computed(() => (props.filter.value?.kind === 'number' ? props.filter.value : null))

function onToggle(ev: Event): void {
  const t = ev.target as HTMLInputElement
  emit('toggle', props.filter.id, t.checked)
}

function onNum(field: 'min' | 'max', ev: Event): void {
  emit('numInput', props.filter.id, field, (ev.target as HTMLInputElement).value)
}

function valueFor(slot: 'min' | 'max'): string {
  const v = num.value
  if (!v) return ''
  const n = slot === 'min' ? v.min : v.max
  return n === undefined ? '' : String(n)
}
</script>

<template>
  <li>
    <label class="efRow" :class="{ efRowOn: selected }">
      <input type="checkbox" :checked="selected" class="efCheck" @change="onToggle" />
      <span :class="bulletClass"></span>
      <div class="efBody">
        <span class="efLabel">{{ filter.label }}</span>
        <div v-if="num && slots.length" class="efNums" @click.stop.prevent>
          <label v-if="slots.includes('min')" class="efNumField">
            <span class="efNumLab">Min</span>
            <input
              type="number"
              class="efNumInp"
              step="any"
              :value="valueFor('min')"
              @input="onNum('min', $event)"
            />
          </label>
          <label v-if="slots.includes('max')" class="efNumField">
            <span class="efNumLab">Max</span>
            <input
              type="number"
              class="efNumInp"
              step="any"
              :value="valueFor('max')"
              @input="onNum('max', $event)"
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
  gap: 6px;
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
