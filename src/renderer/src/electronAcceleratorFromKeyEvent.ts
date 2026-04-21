/**
 * Map a browser KeyboardEvent to an Electron globalShortcut accelerator string.
 * @see https://www.electronjs.org/docs/latest/api/accelerator
 */
function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const p = navigator.platform ?? ''
  const ua = navigator.userAgent ?? ''
  return /Mac|iPhone|iPod|iPad/i.test(p) || /Mac OS X/i.test(ua)
}

/** Main key token (no modifiers). Returns null if the key cannot be expressed. */
function electronKeyFromKeyboardEvent(e: KeyboardEvent): string | null {
  const { code, key } = e

  if (code.startsWith('Key')) return code.slice(3).toUpperCase()
  if (code.startsWith('Digit')) return code.slice(5)

  if (/^F(1?\d|2[0-4])$/i.test(code)) return code.toUpperCase()

  const byCode: Record<string, string> = {
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Escape: 'Escape',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Backquote: '`',
    Minus: 'Minus',
    Equal: 'Equal',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    NumpadDecimal: 'numdec',
    NumpadDivide: 'numdiv',
    NumpadMultiply: 'nummult',
    NumpadSubtract: 'numsub',
    NumpadAdd: 'numadd',
    NumpadEnter: 'Enter',
    NumpadEqual: 'Equal'
  }

  if (byCode[code]) return byCode[code]

  if (/^Numpad[0-9]$/.test(code)) {
    return `num${code.slice(6)}`
  }

  if (key.length === 1) {
    const c = key.toUpperCase()
    if (/[A-Z0-9]/.test(c)) return c
  }

  return null
}

/**
 * Build full accelerator. Returns null if only modifiers / unknown key.
 * Uses CommandOrControl when Cmd (mac) or Ctrl (win/linux) is the primary chord.
 */
export function buildElectronAccelerator(e: KeyboardEvent): string | null {
  if (e.repeat) return null
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null

  const mac = isMacOS()
  const parts: string[] = []

  const primaryChord = (mac && e.metaKey) || (!mac && e.ctrlKey)
  if (primaryChord) {
    parts.push('CommandOrControl')
  } else {
    if (e.ctrlKey) parts.push('Control')
    if (e.metaKey) parts.push('Super')
  }

  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const k = electronKeyFromKeyboardEvent(e)
  if (!k) return null

  parts.push(k)
  return parts.join('+')
}
