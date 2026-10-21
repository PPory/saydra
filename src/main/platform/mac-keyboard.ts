// Global key hook on macOS: a CGEventTap on the main run loop, called through koffi.
// Like the Windows hook it runs in this process, so whether a key is swallowed is
// decided on the spot, and the permission belongs to Saydra.app itself. Without the
// Accessibility permission the tap cannot be created and startKeyboardHook throws.
import { powerMonitor } from 'electron'
import { createRequire } from 'node:module'
import type { KeyListener } from '.'
import { createMacKeyDecoder } from './mac-keys'

const require = createRequire(import.meta.url)

const SESSION_TAP = 1 // kCGSessionEventTap
const HID_TAP = 0 // kCGHIDEventTap
const HEAD_INSERT = 0 // kCGHeadInsertEventTap
const TAP_DEFAULT = 0 // kCGEventTapOptionDefault: may drop events
const KEY_DOWN = 10
const KEY_UP = 11
const FLAGS_CHANGED = 12
const DISABLED_BY_TIMEOUT = 0xfffffffe
const DISABLED_BY_USER_INPUT = 0xffffffff
const FIELD_KEYCODE = 9 // kCGKeyboardEventKeycode
const FIELD_USER_DATA = 42 // kCGEventSourceUserData
const FLAG_COMMAND = 0x100000
// Marks the ⌘C / ⌘V we post, so the tap passes them on untouched (LLKHF_INJECTED on Windows).
const OUR_EVENT = 0x534459

type Native = ReturnType<typeof loadNative>
let native: Native | null = null

function loadNative() {
  const koffi = require('koffi')
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
  const TapCallback = koffi.proto('void *CGEventTapCallBack(void *proxy, uint32_t type, void *event, void *refcon)')
  const TimerCallback = koffi.proto('void CFRunLoopTimerCallBack(void *timer, void *info)')
  return {
    koffi,
    TapCallback,
    TimerCallback,
    CGEventTapCreate: cg.func(
      'void *CGEventTapCreate(uint32_t tap, uint32_t place, uint32_t options, uint64_t mask, CGEventTapCallBack *callback, void *refcon)'
    ),
    CGEventTapEnable: cg.func('void CGEventTapEnable(void *tap, bool enable)'),
    CGEventGetIntegerValueField: cg.func('int64_t CGEventGetIntegerValueField(void *event, uint32_t field)'),
    CGEventSetIntegerValueField: cg.func('void CGEventSetIntegerValueField(void *event, uint32_t field, int64_t value)'),
    CGEventGetFlags: cg.func('uint64_t CGEventGetFlags(void *event)'),
    CGEventSetFlags: cg.func('void CGEventSetFlags(void *event, uint64_t flags)'),
    CGEventCreateKeyboardEvent: cg.func('void *CGEventCreateKeyboardEvent(void *source, uint16_t key, bool down)'),
    CGEventPost: cg.func('void CGEventPost(uint32_t tap, void *event)'),
    CGPreflightListenEventAccess: cg.func('bool CGPreflightListenEventAccess()'),
    CGRequestListenEventAccess: cg.func('bool CGRequestListenEventAccess()'),
    CFMachPortCreateRunLoopSource: cf.func('void *CFMachPortCreateRunLoopSource(void *alloc, void *port, long order)'),
    CFMachPortInvalidate: cf.func('void CFMachPortInvalidate(void *port)'),
    CFRunLoopGetMain: cf.func('void *CFRunLoopGetMain()'),
    CFRunLoopAddSource: cf.func('void CFRunLoopAddSource(void *loop, void *source, void *mode)'),
    CFRunLoopRemoveSource: cf.func('void CFRunLoopRemoveSource(void *loop, void *source, void *mode)'),
    CFRelease: cf.func('void CFRelease(void *ref)'),
    CFAbsoluteTimeGetCurrent: cf.func('double CFAbsoluteTimeGetCurrent()'),
    CFRunLoopTimerCreate: cf.func(
      'void *CFRunLoopTimerCreate(void *alloc, double fireDate, double interval, uint64_t flags, long order, CFRunLoopTimerCallBack *callout, void *context)'
    ),
    CFRunLoopAddTimer: cf.func('void CFRunLoopAddTimer(void *loop, void *timer, void *mode)'),
    CFRunLoopTimerInvalidate: cf.func('void CFRunLoopTimerInvalidate(void *timer)'),
    // The global itself, not a string with the same contents: CFRunLoopAddSource tells
    // the common modes apart by pointer, and any other string becomes a mode of its
    // own that the run loop never runs (the tap was created but never called).
    commonModes: koffi.decode(cf.symbol('kCFRunLoopCommonModes'), 'void *')
  }
}

const lib = (): Native => (native ??= loadNative())

export function startKeyboardHook(listener: KeyListener): () => void {
  const n = lib()
  const decoder = createMacKeyDecoder()
  let tap: unknown = null

  // Runs on the main thread from the run loop. A slow answer makes macOS disable the
  // tap (DISABLED_BY_TIMEOUT); it is switched straight back on.
  const proc = n.koffi.register((_proxy: unknown, type: number, event: unknown) => {
    if (type === DISABLED_BY_TIMEOUT || type === DISABLED_BY_USER_INPUT) {
      if (tap) n.CGEventTapEnable(tap, true)
      return event
    }
    try {
      if (Number(n.CGEventGetIntegerValueField(event, FIELD_USER_DATA)) === OUR_EVENT) return event
      const code = Number(n.CGEventGetIntegerValueField(event, FIELD_KEYCODE))
      const keys =
        type === FLAGS_CHANGED
          ? decoder.flagsChanged(code, Number(n.CGEventGetFlags(event)))
          : decoder.key(code, type === KEY_DOWN)
      let swallow = false
      for (const k of keys) if (listener(k.vk, k.down)) swallow = true
      return swallow ? null : event
    } catch (err) {
      console.error('key listener failed', err) // never let a bug block the keyboard
      return event
    }
  }, n.koffi.pointer(n.TapCallback))

  const mask = (1 << KEY_DOWN) | (1 << KEY_UP) | (1 << FLAGS_CHANGED)
  tap = n.CGEventTapCreate(SESSION_TAP, HEAD_INSERT, TAP_DEFAULT, mask, proc, null)
  if (!tap) {
    n.koffi.unregister(proc)
    throw new Error('CGEventTapCreate failed (no Accessibility permission?)')
  }
  const source = n.CFMachPortCreateRunLoopSource(null, tap, 0)
  n.CFRunLoopAddSource(n.CFRunLoopGetMain(), source, n.commonModes)
  n.CGEventTapEnable(tap, true)

  const reenable = () => tap && n.CGEventTapEnable(tap, true)
  powerMonitor.on('resume', reenable)
  powerMonitor.on('unlock-screen', reenable)

  return () => {
    powerMonitor.off('resume', reenable)
    powerMonitor.off('unlock-screen', reenable)
    n.CGEventTapEnable(tap, false)
    n.CFRunLoopRemoveSource(n.CFRunLoopGetMain(), source, n.commonModes)
    n.CFMachPortInvalidate(tap)
    n.CFRelease(source)
    n.CFRelease(tap)
    tap = null
    n.koffi.unregister(proc)
  }
}

// ⌘ + a key (8 = C, 9 = V), marked as ours so the hook ignores it.
export function pressCommand(keycode: number): void {
  const n = lib()
  for (const down of [true, false]) {
    const ev = n.CGEventCreateKeyboardEvent(null, keycode, down)
    if (!ev) continue
    n.CGEventSetFlags(ev, FLAG_COMMAND)
    n.CGEventSetIntegerValueField(ev, FIELD_USER_DATA, OUR_EVENT)
    n.CGEventPost(HID_TAP, ev)
    n.CFRelease(ev)
  }
}

// Self-test: a timer on the main run loop in the mode the tap's source is added to.
// It needs no permission, so the build machine can show the tap would be called.
export function probeRunLoop(waitMs = 1000): Promise<boolean> {
  const n = lib()
  return new Promise((resolve) => {
    let timer: unknown = null
    let settled = false
    const finish = (fired: boolean) => {
      if (settled) return
      settled = true
      resolve(fired)
      // Not from inside the callback that is still running.
      setImmediate(() => {
        n.CFRunLoopTimerInvalidate(timer)
        n.CFRelease(timer)
        n.koffi.unregister(callback)
      })
    }
    const callback = n.koffi.register(() => finish(true), n.koffi.pointer(n.TimerCallback))
    timer = n.CFRunLoopTimerCreate(null, n.CFAbsoluteTimeGetCurrent() + 0.05, 0, 0, 0, callback, null)
    n.CFRunLoopAddTimer(n.CFRunLoopGetMain(), timer, n.commonModes)
    setTimeout(() => finish(false), waitMs)
  })
}

// Input Monitoring: some macOS versions ask for it separately before a key tap sees keys.
export const hasInputMonitoring = (): boolean => Boolean(lib().CGPreflightListenEventAccess())
// Adds Saydra to the list in System Settings (and asks once).
export const requestInputMonitoring = (): boolean => Boolean(lib().CGRequestListenEventAccess())
