import { BrowserWindow, clipboard, globalShortcut } from 'electron'
import { execFile } from 'child_process'

const IPC_CHANNEL = 'overlay:item-from-hotkey'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function execFileAsync(
  file: string,
  args: string[],
  opts: { timeout?: number; windowsHide?: boolean } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: opts.timeout ?? 8000, windowsHide: opts.windowsHide ?? false }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/** Ask the foreground app to perform a copy (PoE: Ctrl+C / macOS: Cmd+C). */
async function sendForegroundCopyShortcut(): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^c")'
      ],
      { windowsHide: true, timeout: 5000 }
    )
    return
  }
  if (process.platform === 'darwin') {
    // PoE uses Ctrl+C for item data on macOS as well.
    await execFileAsync(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "c" using control down'],
      { timeout: 5000 }
    )
    return
  }
  // Linux / BSD: requires `xdotool` (X11)
  await execFileAsync('xdotool', ['key', 'ctrl+c'], { timeout: 3000 })
}

/**
 * Saves text clipboard, sends copy to the focused game window, reads the new clipboard,
 * then restores the previous text. (Rich / image clipboard is not preserved — text only.)
 */
export async function captureItemTextFromGame(): Promise<{ text: string; error?: string }> {
  const previous = clipboard.readText()
  try {
    await sendForegroundCopyShortcut()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint =
      process.platform === 'linux'
        ? `${msg}\n\nIf xdotool is missing, install it (e.g. sudo apt install xdotool). Wayland may not be supported.`
        : msg
    return { text: '', error: hint }
  }

  await sleep(90)
  let text = clipboard.readText()
  let waited = 0
  while (text === previous && waited < 280) {
    await sleep(35)
    waited += 35
    text = clipboard.readText()
  }

  try {
    clipboard.writeText(previous)
  } catch {
    // ignore restore failures
  }

  return { text }
}

let registeredAccelerator: string | null = null

export function getOverlayIpcChannel(): string {
  return IPC_CHANNEL
}

export function registerOverlayGlobalShortcut(
  accelerator: string | null | undefined,
  getWindow: () => BrowserWindow | null
): { ok: true } | { message: string } {
  if (registeredAccelerator) {
    globalShortcut.unregister(registeredAccelerator)
    registeredAccelerator = null
  }

  const acc = (accelerator ?? '').trim()
  if (!acc) return { ok: true }

  const ok = globalShortcut.register(acc, () => {
    void (async () => {
      const win = getWindow()
      if (!win || win.isDestroyed()) return

      const { text, error } = await captureItemTextFromGame()

      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      }
      win.setAlwaysOnTop(true, 'screen-saver')
      win.show()
      win.focus()

      win.webContents.send(IPC_CHANNEL, { text: text ?? '', error })
    })()
  })

  if (!ok) {
    return {
      message: `Could not register "${acc}". It may be invalid, reserved, or already used by another app. Try a different combination.`
    }
  }

  registeredAccelerator = acc
  return { ok: true }
}

export function unregisterOverlayGlobalShortcut(): void {
  if (registeredAccelerator) {
    globalShortcut.unregister(registeredAccelerator)
    registeredAccelerator = null
  }
}

export function unregisterAllGlobalShortcuts(): void {
  globalShortcut.unregisterAll()
  registeredAccelerator = null
}
