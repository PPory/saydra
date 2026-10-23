import { app, BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { HUB, type HubRoute } from '../shared/hub'
import { IPC, type AnswerPayload } from '../shared/types'
import { join } from 'node:path'
import { platform } from './platform'

const preload = join(import.meta.dirname, '../preload/index.cjs')
const isMac = process.platform === 'darwin'

// macOS: a non-activating panel that also shows over full-screen apps and on every
// Space; without this the bar disappears as soon as the user goes full screen.
function floatEverywhere(win: BrowserWindow): void {
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
}

function load(win: BrowserWindow, page: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) win.loadURL(`${devUrl}/${page}.html`)
  else win.loadFile(join(import.meta.dirname, `../renderer/${page}.html`))
}

// Room for two alert cards and tooltips above the pill.
export const BAR_WIDTH = 400
export const BAR_HEIGHT = 300

// Transparent always-on-top area at the bottom of the screen. The idle pill is
// always visible. Clicks pass through to the app underneath
// except over the pill or a card. It must never take focus, otherwise the
// paste would land in the bar instead of the user's input box.
export function createFloatingBar(log: (line: string) => void): BrowserWindow {
  const win = new BrowserWindow({
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    ...(isMac && { type: 'panel', acceptFirstMouse: true }),
    webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  floatEverywhere(win)
  try {
    platform.clickWithoutFocus(win.getNativeWindowHandle())
  } catch (err) {
    log(`first click fix not installed: ${err instanceof Error ? err.message : err}`)
  }
  setBarInteractive(win, false)
  watchBarPointer(win, log)
  load(win, 'floating-bar')
  win.once('ready-to-show', () => {
    placeBar(win)
    win.showInactive()
  })
  return win
}

// forward: the page still gets mouse-move events, so it can tell when the
// pointer reaches the pill and ask for clicks.
let barIgnoresMouse = true
let barHitRects: number[][] = []

export function setBarInteractive(win: BrowserWindow, interactive: boolean): void {
  barIgnoresMouse = !interactive
  if (interactive) win.setIgnoreMouseEvents(false)
  else win.setIgnoreMouseEvents(true, { forward: true })
}

export function setBarHitRects(rects: number[][]): void {
  barHitRects = rects
}

export const barTakesClicks = (): boolean => !barIgnoresMouse

// On Windows those forwarded moves come from a low-level mouse hook, which Windows
// drops without a word when the main thread stalls for a moment (finishing a big
// update download did it), and from then on no card takes a click. So the pointer
// is also checked from here: on the pill or a card, the bar takes clicks, and the
// page gets ordinary mouse events again. Taking clicks also sets the hook up anew.
// The window's real state is read from the system rather than trusted from our flag:
// a bar that lets clicks through while the flag says it takes them gets no forwarded
// moves either, and no card can be clicked or closed until a restart. (A 0.2.12 bar
// got stuck like that or with this check failing some other way; bar.log tells.)
// It also hands clicks back when the pill or card goes away under a pointer that
// doesn't move: the page gets no mouseleave then, and the bar would keep taking the
// clicks meant for the app underneath.
const POINTER_CHECK_MS = 100
const DESYNC_LOG_EVERY_MS = 60_000

function watchBarPointer(win: BrowserWindow, log: (line: string) => void): void {
  let loggedAt = 0
  const timer = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(timer)
    if (!win.isVisible()) return
    const cursor = screen.getCursorScreenPoint()
    const { x: left, y: top } = win.getBounds()
    const x = cursor.x - left
    const y = cursor.y - top
    if (!barHitRects.some(([l, t, r, b]) => x >= l && x < r && y >= t && y < b)) {
      if (!barIgnoresMouse) setBarInteractive(win, false)
      return
    }
    const passesThrough = platform.clicksPassThrough(win.getNativeWindowHandle()) ?? barIgnoresMouse
    if (!passesThrough) return
    if (!barIgnoresMouse && Date.now() - loggedAt > DESYNC_LOG_EVERY_MS) {
      loggedAt = Date.now()
      log('bar let clicks through while set to take them, fixed')
    }
    setBarInteractive(win, true)
  }, POINTER_CHECK_MS)
}

// Before each dictation: other always-on-top windows (shell flyouts, screenshot
// tools, video players) can end up above the bar, and Show Desktop can hide it.
// Puts it back on top without taking focus; returns what was wrong, for the log.
export function raiseBar(win: BrowserWindow): string[] {
  const wrong: string[] = []
  if (win.isMinimized()) wrong.push('minimized')
  if (!win.isVisible()) wrong.push('hidden')
  if (!win.isAlwaysOnTop()) wrong.push('not-on-top')
  if (wrong.length) win.showInactive()
  win.setAlwaysOnTop(true, 'screen-saver')
  win.moveTop()
  return wrong
}

// Bottom-centre of the display the cursor is on, just above the taskbar (or the Dock).
export function placeBar(win: BrowserWindow): void {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - BAR_WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height - BAR_HEIGHT - 4),
    width: BAR_WIDTH,
    height: BAR_HEIGHT
  })
}

// ---------- answer card (问任何问题) ----------
// The card is 744px wide; the window adds room for the page padding.
const CARD_WIDTH = 744 + 16
const CARD_GAP_ABOVE_BAR = 56 // keeps the pill visible below the card

let cardWin: BrowserWindow | null = null
let cardPayload: AnswerPayload | null = null

const liveCard = () => (cardWin && !cardWin.isDestroyed() ? cardWin : null)
export const isCardVisible = (): boolean => Boolean(liveCard()?.isVisible())

// The page measures itself and asks for a height; the card grows upwards from
// just above the pill, on the display the user is working on.
export function resizeCard(height: number): void {
  const win = liveCard()
  if (!win || !cardPayload) return
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const h = Math.min(Math.ceil(height), workArea.height - CARD_GAP_ABOVE_BAR - 16)
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - CARD_WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height - CARD_GAP_ABOVE_BAR - h),
    width: CARD_WIDTH,
    height: h
  })
  if (!win.isVisible()) win.showInactive() // the user's input box keeps focus
}

export function showAnswerCard(payload: AnswerPayload): void {
  cardPayload = payload
  const existing = liveCard()
  if (existing) return existing.webContents.send(IPC.cardShow, payload)
  const win = new BrowserWindow({
    width: CARD_WIDTH,
    height: 440,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: '回答',
    ...(isMac && { type: 'panel' }),
    webPreferences: { preload, sandbox: true, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'pop-up-menu')
  floatEverywhere(win)
  cardWin = win
  win.on('closed', () => (cardWin = null))
  load(win, 'answer-card') // the page asks for the payload once it is listening
}


export function registerCardIpc(): void {
  ipcMain.handle(IPC.cardPayload, () => cardPayload)
}

export function closeAnswerCard(): void {
  cardPayload = null
  liveCard()?.hide()
}

export const getCard = (): BrowserWindow | null => liveCard()

let hubWin: BrowserWindow | null = null

// Window colours per theme, so the native title-bar buttons match the page.
const HUB_COLORS = {
  light: { bg: '#ffffff', symbol: '#111111' },
  dark: { bg: '#242121', symbol: '#f2f1f0' }
}
const hubColors = () => HUB_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']

// The page's --scrim (rgba 17 17 17 / 0.45) can't cover the buttons Windows draws,
// so while a modal is up they get the colours they would have under it.
const SCRIM = { rgb: 17, alpha: 0.45 }
const underScrim = (hex: string) =>
  '#' +
  [1, 3, 5]
    .map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - SCRIM.alpha) + SCRIM.rgb * SCRIM.alpha))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
let hubDimmed = false

function paintTitleBar(win: BrowserWindow): void {
  if (isMac) return
  const c = hubColors()
  const dim = (hex: string) => (hubDimmed ? underScrim(hex) : hex)
  win.setTitleBarOverlay({ color: dim(c.bg), symbolColor: dim(c.symbol), height: 40 })
}

export function dimHubTitleBar(dim: boolean): void {
  hubDimmed = dim
  const win = getHub()
  if (win) paintTitleBar(win)
}

export const getHub = (): BrowserWindow | null => (hubWin && !hubWin.isDestroyed() ? hubWin : null)

// The main window (首页 / 历史记录 / 词典 + settings). Optional route jumps to a page.
export function openHub(route?: HubRoute): void {
  const existing = getHub()
  if (existing) {
    if (route) existing.webContents.send(HUB.navigate, route)
    if (existing.isMinimized()) existing.restore()
    if (isMac) app.focus({ steal: true }) // a menu-bar app is never the active one by itself
    existing.show()
    existing.focus()
    return
  }
  const c = hubColors()
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    title: 'Saydra',
    show: false,
    backgroundColor: c.bg,
    titleBarStyle: 'hidden',
    // Windows draws its buttons over the page; macOS keeps its traffic lights, placed in the sidebar.
    ...(isMac ? { trafficLightPosition: { x: 24, y: 24 } } : { titleBarOverlay: { color: c.bg, symbolColor: c.symbol, height: 40 } }),
    webPreferences: { preload, sandbox: true, contextIsolation: true }
  })
  hubWin = win
  win.once('ready-to-show', () => {
    if (isMac) app.focus({ steal: true })
    win.show()
  })
  win.on('closed', () => ((hubWin = null), (hubDimmed = false)))
  if (route) win.webContents.once('did-finish-load', () => win.webContents.send(HUB.navigate, route))
  load(win, 'hub')
}

nativeTheme.on('updated', () => {
  const win = getHub()
  if (!win) return
  const c = hubColors()
  win.setBackgroundColor(c.bg)
  paintTitleBar(win)
})
