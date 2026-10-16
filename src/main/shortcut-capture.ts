// Records a new shortcut from the key hook. Browsers never see Right Alt
// (our hook swallows it) and cannot tell left/right modifiers apart reliably,
// so the settings page asks main to listen instead.
import { shortcutError, VK, type Shortcut, type ShortcutBindings } from '../shared/keys'
import type { CaptureResult, ShortcutTarget } from '../shared/hub'

const CAPTURE_TIMEOUT_MS = 15_000

export function createShortcutCapture(getBindings: () => ShortcutBindings) {
  let target: ShortcutTarget | null = null
  let resolve: ((r: CaptureResult) => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const pressed = new Set<number>()
  let chord: Shortcut = [] // every key pressed, in order; the first is held to talk

  function finish(result: CaptureResult): void {
    clearTimeout(timer)
    const done = resolve
    target = resolve = null
    pressed.clear()
    chord = []
    done?.(result)
  }

  return {
    get active() {
      return target !== null
    },
    start(t: ShortcutTarget): Promise<CaptureResult> {
      finish(null) // a second request replaces the first
      target = t
      timer = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS)
      return new Promise((r) => (resolve = r))
    },
    cancel: () => finish(null),
    // Fed every key while active; always swallowed so nothing reaches other apps.
    key(vk: number, down: boolean): boolean {
      if (!target) return false
      if (down) {
        if (vk === VK.Escape && !chord.length) {
          finish(null)
          return true
        }
        if (!pressed.has(vk)) {
          pressed.add(vk)
          if (!chord.includes(vk)) chord.push(vk)
        }
        return true
      }
      pressed.delete(vk)
      if (!pressed.size && chord.length) {
        const error = shortcutError(chord, target, getBindings())
        finish(error ? { ok: false, error } : { ok: true, keys: chord })
      }
      return true
    }
  }
}

export type ShortcutCapture = ReturnType<typeof createShortcutCapture>
