import { ElectronAPI } from '@electron-toolkit/preload'
import type { ParseItemTextResponse, TradeSearchRequest, TradeSearchResponse, ApiErrorShape } from '../shared/trade'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      app: {
        minimizeMainWindow(): Promise<void>
        closeMainWindow(): Promise<void>
        readClipboardText(): Promise<string>
      }
      trade: {
        parseItemText(text: string): Promise<ParseItemTextResponse>
        search(req: TradeSearchRequest): Promise<TradeSearchResponse | ApiErrorShape>
        connect(baseUrl?: string): Promise<{ ok: true } | ApiErrorShape>
        status(baseUrl?: string): Promise<{ connected: boolean; cookies: string[] } | ApiErrorShape>
        listLeagues(baseUrl?: string): Promise<{ leagues: string[] } | ApiErrorShape>
      }
      overlay: {
        registerHotkey(accelerator: string): Promise<{ ok: true } | { message: string }>
        onItemFromHotkey(cb: (payload: { text: string; error?: string }) => void): () => void
      }
    }
  }
}
