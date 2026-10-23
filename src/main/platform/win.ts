// Windows: Win32 key hook, Ctrl+C / Ctrl+V through uiohook, apps told apart by exe name.
import { activeWindow } from 'get-windows'
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import type { Platform } from '.'
import { winNotText } from '../paste-check'
import { startKeyboardHook } from './win-keyboard'

const require = createRequire(import.meta.url)

// In a terminal Ctrl+C with nothing selected interrupts the running program.
const TERMINALS = /^(windowsterminal|wt|cmd|powershell|pwsh|conhost|mintty|alacritty|wezterm-gui|putty|xshell|mobaxterm)\.exe$/i
// These copy the whole current line when nothing is selected.
const LINE_COPIERS = /^(code|cursor|windsurf|idea64|pycharm64|webstorm64|devenv|notepad\+\+|sublime_text)\.exe$/i

function ctrlTap(key: 'C' | 'V'): void {
  const { uIOhook, UiohookKey } = require('uiohook-napi')
  uIOhook.keyTap(UiohookKey[key], [UiohookKey.Ctrl])
}

const GWL_EXSTYLE = -20
const WS_EX_TRANSPARENT = 0x20 // what setIgnoreMouseEvents(true) sets
let getWindowLong: ((hwnd: number, index: number) => number | bigint) | undefined

const hwndOf = (handle: Buffer) => Number(handle.readBigUInt64LE(0))

// Clicking a window of another app first sends it WM_MOUSEACTIVATE. Chromium answers
// that for a window that can't take focus (the bar) with "don't activate, and drop
// the click": the button press never reaches the page, only the release does, so no
// card can be clicked or closed. A fresh bar doesn't always get the message, a bar
// that has been up for a while does (seen on 0.2.14 with the page's own listeners).
// Answering it ourselves with "don't activate" keeps focus in the user's app and
// lets the click through.
const WM_MOUSEACTIVATE = 0x21
const MA_NOACTIVATE = 3
const SUBCLASS_ID = 0x5a1d
const subclassed: unknown[] = [] // registered callbacks must outlive the window

function clickWithoutFocus(handle: Buffer): void {
  const koffi = require('koffi')
  const comctl32 = koffi.load('comctl32.dll')
  const SUBCLASSPROC = koffi.proto(
    'intptr_t __stdcall SUBCLASSPROC(intptr_t hWnd, uint32_t uMsg, uintptr_t wParam, intptr_t lParam, uintptr_t uIdSubclass, uintptr_t dwRefData)'
  )
  const SetWindowSubclass = comctl32.func('bool __stdcall SetWindowSubclass(intptr_t hWnd, SUBCLASSPROC *pfnSubclass, uintptr_t uIdSubclass, uintptr_t dwRefData)')
  const DefSubclassProc = comctl32.func('intptr_t __stdcall DefSubclassProc(intptr_t hWnd, uint32_t uMsg, uintptr_t wParam, intptr_t lParam)')
  const proc = koffi.register(
    (hwnd: number, msg: number, wParam: number | bigint, lParam: number | bigint) =>
      msg === WM_MOUSEACTIVATE ? MA_NOACTIVATE : DefSubclassProc(hwnd, msg, wParam, lParam),
    koffi.pointer(SUBCLASSPROC)
  )
  subclassed.push(proc)
  if (!SetWindowSubclass(hwndOf(handle), proc, SUBCLASS_ID, 0)) throw new Error('SetWindowSubclass failed')
}

export const win: Platform = {
  startKeyboardHook,
  pressCopy: () => ctrlTap('C'),
  pressPaste: () => ctrlTap('V'),
  copyInterrupts: (appName) => TERMINALS.test(appName),
  copiesLine: (appName) => LINE_COPIERS.test(appName),
  notText: winNotText,
  async frontApp() {
    const w = await activeWindow()
    if (!w) return null
    return { appName: basename(w.owner.path || w.owner.name || ''), title: w.title }
  },
  // Win+V history, cloud clipboard and tools like Ditto all honour these.
  transientFormats: ['ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard'],
  clicksPassThrough(handle) {
    getWindowLong ??= require('koffi').load('user32.dll').func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int nIndex)')
    const exStyle = Number(getWindowLong!(hwndOf(handle), GWL_EXSTYLE))
    return (exStyle & WS_EX_TRANSPARENT) !== 0
  },
  clickWithoutFocus
}
