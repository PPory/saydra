import { BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { HUB, type HubRoute } from '../shared/hub'
import { IPC, type AnswerPayload } from '../shared/types'
import { join } from 'node:path'

const preload = join(import.meta.dirname, '../preload/index.cjs')

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
export function createFloatingBar(): BrowserWindow {
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
    webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  setBarInteractive(win, false)
  load(win, 'floating-bar')
  win.once('ready-to-show', () => {
    placeBar(win)
    win.showInactive()
  })
  return win
}

// forward: the page still gets mouse-move events, so it can tell when the
// pointer reaches the pill and ask for clicks.
export function setBarInteractive(win: BrowserWindow, interactive: boolean): void {
  if (interactive) win.setIgnoreMouseEvents(false)
  else win.setIgnoreMouseEvents(true, { forward: true })
}

// Bottom-centre of the display the cursor is on, just above the taskbar.
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
    webPreferences: { preload, sandbox: true, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'pop-up-menu')
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

export const getHub = (): BrowserWindow | null => (hubWin && !hubWin.isDestroyed() ? hubWin : null)

// The main window (首页 / 历史记录 / 词典 + settings). Optional route jumps to a page.
export function openHub(route?: HubRoute): void {
  const existing = getHub()
  if (existing) {
    if (route) existing.webContents.send(HUB.navigate, route)
    if (existing.isMinimized()) existing.restore()
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
    titleBarOverlay: { color: c.bg, symbolColor: c.symbol, height: 40 },
    webPreferences: { preload, sandbox: true, contextIsolation: true }
  })
  hubWin = win
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => (hubWin = null))
  if (route) win.webContents.once('did-finish-load', () => win.webContents.send(HUB.navigate, route))
  load(win, 'hub')
}

nativeTheme.on('updated', () => {
  const win = getHub()
  if (!win) return
  const c = hubColors()
  win.setBackgroundColor(c.bg)
  win.setTitleBarOverlay({ color: c.bg, symbolColor: c.symbol, height: 40 })
})
