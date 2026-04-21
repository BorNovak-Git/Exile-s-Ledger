import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { parseItemText } from './trade/parseItemText'
import { fetchPoe2LeagueIds } from './trade/poe2Leagues'
import { searchTrade } from './trade/searchTrade'
import type { ApiErrorShape, ParseItemTextResponse, TradeSearchRequest, TradeSearchResponse } from '../shared/trade'

let connectWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('trade:parseItemText', async (_evt, text: string): Promise<ParseItemTextResponse> => {
    console.log('[trade:parseItemText] input chars:', text?.length ?? 0)
    const res = parseItemText(text)
    console.log('[trade:parseItemText] parsed:', {
      itemName: res.itemName,
      itemType: res.itemType,
      filters: res.filters.length
    })
    return res
  })

  ipcMain.handle('trade:connect', async (_evt, baseUrl?: string): Promise<{ ok: true } | ApiErrorShape> => {
    try {
      const url = `${(baseUrl ?? 'https://www.pathofexile.com').replace(/\/+$/, '')}/trade2`
      if (connectWindow && !connectWindow.isDestroyed()) {
        connectWindow.focus()
        connectWindow.loadURL(url)
        return { ok: true }
      }

      connectWindow = new BrowserWindow({
        width: 1100,
        height: 800,
        show: true,
        autoHideMenuBar: false
      })
      connectWindow.on('closed', () => {
        connectWindow = null
      })
      console.log('[trade:connect] opening:', url)
      await connectWindow.loadURL(url)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { message }
    }
  })

  ipcMain.handle(
    'trade:status',
    async (_evt, baseUrl?: string): Promise<{ connected: boolean; cookies: string[] } | ApiErrorShape> => {
      try {
        const origin = (baseUrl ?? 'https://www.pathofexile.com').replace(/\/+$/, '')
        const url = origin.startsWith('http') ? origin : `https://${origin}`

        // Prefer domain-based lookup (cookie scope can vary by path/subdomain).
        const host = new URL(url).hostname
        const apexDomain = host.split('.').slice(-2).join('.')
        const cookies = await session.defaultSession.cookies.get({ domain: apexDomain })
        const names = cookies.map((c) => c.name)

        // Consider "connected" if we have either Cloudflare clearance cookies OR a PoE session cookie.
        const connected =
          names.includes('cf_clearance') ||
          names.includes('__cf_bm') ||
          names.includes('POESESSID')

        console.log('[trade:status]', { url, apexDomain, connected, cookies: names })
        return { connected, cookies: names }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return { message }
      }
    }
  )

  ipcMain.handle(
    'trade:listLeagues',
    async (_evt, baseUrl?: string): Promise<{ leagues: string[] } | ApiErrorShape> => {
      try {
        const origin = (baseUrl ?? 'https://www.pathofexile.com').replace(/\/+$/, '')
        const leagues = await fetchPoe2LeagueIds(origin)
        return { leagues }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return { message }
      }
    }
  )

  ipcMain.handle(
    'trade:search',
    async (_evt, req: TradeSearchRequest): Promise<TradeSearchResponse | ApiErrorShape> => {
      try {
        console.log('[trade:search] request:', {
          league: req.league,
          baseUrl: req.baseUrl,
          selectedFilters: req.selectedFilters?.map((f) => ({
            id: f.id,
            tradeId: f.tradeId,
            value: f.value
          }))
        })
        return await searchTrade(req)
      } catch (err) {
        console.log('[trade:search] error thrown (pre-serialization):', {
          typeof: typeof err,
          isError: err instanceof Error,
          name: err instanceof Error ? err.name : undefined,
          message: err instanceof Error ? err.message : undefined
        })
        console.log(
          '[trade:search] NOTE: "object could not be cloned" happens when IPC tries to return a non-structured-cloneable value (like Error/Response). We serialize errors to plain objects below.'
        )
        // IMPORTANT: IPC return values must be structured-cloneable.
        // Returning raw Error / Response objects can trigger "object could not be cloned".
        const message = err instanceof Error ? err.message : 'Unknown error'
        const details =
          err instanceof Error
            ? {
                name: err.name,
                message: err.message,
                stack: err.stack
              }
            : typeof err === 'object'
              ? { type: Object.prototype.toString.call(err) }
              : { value: err }
        return { message, details }
      }
    }
  )

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
