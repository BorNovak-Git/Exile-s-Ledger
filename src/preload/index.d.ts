import { ElectronAPI } from '@electron-toolkit/preload'
import type { ParseItemTextResponse, TradeSearchRequest, TradeSearchResponse, ApiErrorShape } from '../shared/trade'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      trade: {
        parseItemText(text: string): Promise<ParseItemTextResponse>
        search(req: TradeSearchRequest): Promise<TradeSearchResponse | ApiErrorShape>
        connect(baseUrl?: string): Promise<{ ok: true } | ApiErrorShape>
        status(baseUrl?: string): Promise<{ connected: boolean; cookies: string[] } | ApiErrorShape>
      }
    }
  }
}
