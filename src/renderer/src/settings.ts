export type AppSettings = {
  league: string
  baseUrl: string
  showItemStatsOnHover: boolean
  /** Electron globalShortcut string. Empty = disabled. @see https://www.electronjs.org/docs/latest/api/accelerator */
  overlayAccelerator: string
}

/** Initial install default only — UI should use `settings.overlayAccelerator`, not this string directly. */
export const DEFAULT_OVERLAY_ACCELERATOR = 'CommandOrControl+Shift+E'

const SETTINGS_KEY = 'poe-app.settings.v1'

const DEFAULT_SETTINGS: AppSettings = {
  league: 'Standard',
  baseUrl: 'https://www.pathofexile.com',
  showItemStatsOnHover: true,
  overlayAccelerator: DEFAULT_OVERLAY_ACCELERATOR
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AppSettings> | null
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS }

    const league = typeof parsed.league === 'string' && parsed.league.trim().length ? parsed.league.trim() : DEFAULT_SETTINGS.league
    const baseUrl =
      typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim().length ? parsed.baseUrl.trim() : DEFAULT_SETTINGS.baseUrl
    const showItemStatsOnHover =
      typeof parsed.showItemStatsOnHover === 'boolean' ? parsed.showItemStatsOnHover : DEFAULT_SETTINGS.showItemStatsOnHover
    const overlayAccelerator =
      typeof parsed.overlayAccelerator === 'string' ? parsed.overlayAccelerator.trim() : DEFAULT_SETTINGS.overlayAccelerator

    return { league, baseUrl, showItemStatsOnHover, overlayAccelerator }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(next: AppSettings): void {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      league: next.league.trim(),
      baseUrl: next.baseUrl.trim(),
      showItemStatsOnHover: next.showItemStatsOnHover,
      overlayAccelerator: next.overlayAccelerator.trim()
    } satisfies AppSettings)
  )
}

