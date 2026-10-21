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
    const exStyle = Number(getWindowLong!(Number(handle.readBigUInt64LE(0)), GWL_EXSTYLE))
    return (exStyle & WS_EX_TRANSPARENT) !== 0
  }
}
