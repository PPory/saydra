// Global keyboard hook via Win32 SetWindowsHookEx(WH_KEYBOARD_LL), called
// through koffi. Unlike uiohook it can swallow keys, so Right Alt never opens
// an app's menu bar and Right Alt+Space never opens the window menu.
import { powerMonitor } from 'electron'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const WH_KEYBOARD_LL = 13
const WM_KEYDOWN = 0x100
const WM_SYSKEYDOWN = 0x104
const LLKHF_INJECTED = 0x10
const VK_LCONTROL = 0xa2
const ALTGR_FAKE_CTRL_SCAN = 0x21d // AltGr layouts send a fake Left Ctrl before Right Alt

// Return true to swallow the event.
export type KeyListener = (vk: number, down: boolean) => boolean

export function startKeyboardHook(listener: KeyListener): () => void {
  const koffi = require('koffi')
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const KBD = koffi.struct('KBDLLHOOKSTRUCT', {
    vkCode: 'uint32',
    scanCode: 'uint32',
    flags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr'
  })
  const HOOKPROC = koffi.proto('intptr_t __stdcall HOOKPROC(int nCode, uintptr_t wParam, void *lParam)')
  const SetWindowsHookExW = user32.func(
    'intptr_t __stdcall SetWindowsHookExW(int idHook, HOOKPROC *lpfn, intptr_t hmod, uint32_t dwThreadId)'
  )
  const CallNextHookEx = user32.func(
    'intptr_t __stdcall CallNextHookEx(intptr_t hhk, int nCode, uintptr_t wParam, void *lParam)'
  )
  const UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(intptr_t hhk)')
  const GetModuleHandleW = kernel32.func('intptr_t __stdcall GetModuleHandleW(str16 name)')

  let hook = 0
  // Runs on the main thread inside Windows' message loop: must stay fast, or
  // Windows times the hook out (~1 s) and silently removes it.
  const proc = koffi.register((nCode: number, wParam: number | bigint, lParam: unknown) => {
    if (nCode >= 0) {
      const info = koffi.decode(lParam, KBD)
      const injected = (info.flags & LLKHF_INJECTED) !== 0 // our own Ctrl+V, or other tools
      const fakeCtrl = info.vkCode === VK_LCONTROL && info.scanCode === ALTGR_FAKE_CTRL_SCAN
      if (!injected && !fakeCtrl) {
        const msg = Number(wParam)
        try {
          if (listener(info.vkCode, msg === WM_KEYDOWN || msg === WM_SYSKEYDOWN)) return 1
        } catch (err) {
          console.error('key listener failed', err) // never let a bug block the keyboard
        }
      }
    }
    return CallNextHookEx(hook, nCode, wParam, lParam)
  }, koffi.pointer(HOOKPROC))

  const install = () => {
    if (hook) UnhookWindowsHookEx(hook)
    hook = SetWindowsHookExW(WH_KEYBOARD_LL, proc, GetModuleHandleW(null), 0)
    if (!hook) throw new Error('SetWindowsHookEx failed')
  }
  install()
  // Windows may drop a low-level hook across sleep or a locked session; put it back.
  const reinstall = () => {
    try {
      install()
    } catch (err) {
      console.error('keyboard hook reinstall failed', err)
    }
  }
  powerMonitor.on('resume', reinstall)
  powerMonitor.on('unlock-screen', reinstall)

  return () => {
    powerMonitor.off('resume', reinstall)
    powerMonitor.off('unlock-screen', reinstall)
    if (hook) UnhookWindowsHookEx(hook)
    hook = 0
    koffi.unregister(proc)
  }
}
