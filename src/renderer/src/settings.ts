export type AppSettings = {
  league: string
  baseUrl: string
  showItemStatsOnHover: boolean
}

const SETTINGS_KEY = 'poe-app.settings.v1'

const DEFAULT_SETTINGS: AppSettings = {
  league: 'Standard',
  baseUrl: 'https://www.pathofexile.com',
  showItemStatsOnHover: true
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

    return { league, baseUrl, showItemStatsOnHover }
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
      showItemStatsOnHover: next.showItemStatsOnHover
    } satisfies AppSettings)
  )
}

