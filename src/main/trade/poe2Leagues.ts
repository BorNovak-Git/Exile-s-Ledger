import { netRequestJson } from './netHttp'

type LeaguesApiResponse = {
  result?: Array<{ id: string; realm: string; text?: string }>
}

/**
 * League ids for PoE2 trade2 search URLs (`/api/trade2/search/poe2/<id>`).
 * Uses the PoE2-specific trade2 leagues endpoint (not `/api/trade/data/leagues`, which mixes PoE1-style PC/console leagues).
 */
export async function fetchPoe2LeagueIds(baseUrl: string): Promise<string[]> {
  const origin = baseUrl.replace(/\/+$/, '')
  const url = `${origin}/api/trade2/data/leagues?realm=poe2`
  const res = await netRequestJson<LeaguesApiResponse>({ url, method: 'GET' })
  if (res.status < 200 || res.status >= 300 || !res.json?.result) {
    throw new Error(
      `Failed to load PoE2 leagues (${res.status}). ${(res.text ?? '').slice(0, 200)}`
    )
  }
  const ids = res.json.result.filter((e) => e.realm === 'poe2').map((e) => e.id)
  const unique = [...new Set(ids)]
  unique.sort((a, b) => {
    const pri = (s: string): number => {
      if (s === 'Standard') return 0
      if (s === 'Hardcore') return 1
      return 2
    }
    const pa = pri(a)
    const pb = pri(b)
    if (pa !== pb) return pa - pb
    return a.localeCompare(b)
  })
  return unique
}
