import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ParseItemTextResponse, TradeSearchRequest, TradeSearchResponse, ApiErrorShape } from '../shared/trade'

// Custom APIs for renderer
const api = {
  app: {
    minimizeMainWindow: (): Promise<void> => ipcRenderer.invoke('app:minimizeMainWindow'),
    closeMainWindow: (): Promise<void> => ipcRenderer.invoke('app:closeMainWindow'),
    readClipboardText: (): Promise<string> => ipcRenderer.invoke('clipboard:readText')
  },
  trade: {
    parseItemText: (text: string): Promise<ParseItemTextResponse> => {
      console.log('[preload] invoke trade:parseItemText', { chars: text?.length ?? 0 })
      return ipcRenderer.invoke('trade:parseItemText', text)
    },
    search: (req: TradeSearchRequest): Promise<TradeSearchResponse | ApiErrorShape> => {
      console.log('[preload] invoke trade:search', {
        league: req.league,
        baseUrl: req.baseUrl,
        selectedFilters: req.selectedFilters?.length ?? 0
      })
      return ipcRenderer.invoke('trade:search', req)
    },
    connect: (baseUrl?: string): Promise<{ ok: true } | ApiErrorShape> => {
      console.log('[preload] invoke trade:connect', { baseUrl })
      return ipcRenderer.invoke('trade:connect', baseUrl)
    },
    status: (baseUrl?: string): Promise<{ connected: boolean; cookies: string[] } | ApiErrorShape> => {
      console.log('[preload] invoke trade:status', { baseUrl })
      return ipcRenderer.invoke('trade:status', baseUrl)
    },
    listLeagues: (baseUrl?: string): Promise<{ leagues: string[] } | ApiErrorShape> => {
      console.log('[preload] invoke trade:listLeagues', { baseUrl })
      return ipcRenderer.invoke('trade:listLeagues', baseUrl)
    }
  },
  overlay: {
    registerHotkey: (accelerator: string): Promise<{ ok: true } | { message: string }> => {
      return ipcRenderer.invoke('overlay:registerHotkey', accelerator ?? '')
    },
    onItemFromHotkey: (cb: (payload: { text: string; error?: string }) => void): (() => void) => {
      const channel = 'overlay:item-from-hotkey'
      const listener = (_e: unknown, payload: { text: string; error?: string }): void => cb(payload)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
