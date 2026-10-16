// Dictation shortcut state machine. Pure (no hook, injectable clock) so it can be tested.
import { VK, type DictationMode, type ShortcutBindings } from '../shared/keys'
import { MAX_RECORD_MS } from '../shared/types'

const TAP_MS = 300 // a single key released faster than this = tap -> hands-free
const CHORD_TAP_MS = 450 // two-key chords take longer to press and release
const MIN_RECORD_MS = 500 // anything shorter is an accidental double tap

export interface DictationKeyHandlers {
  onStart: (mode: DictationMode) => void
  onModeChange: (mode: DictationMode) => void // e.g. Right Shift added while holding Right Alt
  onHandsFree: () => void // a tap turned the recording into hands-free mode
  onStop: () => void
  onCancel: () => void
  onPasteLast?: () => void
  // Esc while a finished dictation is still being processed: true if it was cancelled
  // (then Esc is swallowed); false lets Esc through to the app as usual.
  onCancelProcessing?: () => boolean
  isBusy: () => boolean // a previous dictation is still being processed
}

type Phase = 'idle' | 'holding' | 'handsFree'
const MODES: DictationMode[] = ['dictate', 'translate', 'ask']

// Ctrl and Shift are harmless on their own; Alt and Win would open menus, so swallow those.
const passesThrough = (vk: number) => vk === VK.LCtrl || vk === VK.RCtrl || vk === VK.LShift || vk === VK.RShift

// Gestures:
//  - hold the shortcut to talk, release to stop
//  - tap it to start hands-free, tap again to stop; Esc cancels
//  - Esc after stopping, while the text is still being processed, cancels that too
//  - while holding Right Alt, adding Right Shift / Space switches to translate / ask
//  - Right Alt + any other key is someone else's shortcut: cancel and let it through
// key() returns true when the event must be swallowed so other apps never see it.
export function createDictationKeyMachine(
  getBindings: () => ShortcutBindings,
  h: DictationKeyHandlers,
  now: () => number = Date.now
) {
  let phase: Phase = 'idle'
  let mode: DictationMode = 'dictate'
  let pressedAt = 0
  let startedAt = 0
  let settling = false // after a stop/cancel, ignore the rest of that chord until all keys are up
  const pressed = new Set<number>()
  const swallowed = new Set<number>() // keys whose key-down we ate; eat their key-up too

  const matches = (keys: number[]) => keys.length === pressed.size && keys.every((k) => pressed.has(k))
  const modeForPressed = (): DictationMode | null => MODES.find((m) => matches(getBindings()[m])) ?? null
  const isBaseKey = (vk: number) => MODES.some((m) => getBindings()[m][0] === vk)

  const swallow = (vk: number, force = false) => {
    if (!force && passesThrough(vk)) return false
    swallowed.add(vk)
    return true
  }

  const end = (stop: boolean) => {
    const recorded = now() - startedAt
    phase = 'idle'
    settling = pressed.size > 0
    if (stop && recorded >= MIN_RECORD_MS) h.onStop()
    else h.onCancel()
  }

  function keydown(vk: number): boolean {
    if (pressed.has(vk)) return swallowed.has(vk) // auto-repeat follows the first decision
    pressed.add(vk)

    if (settling) return MODES.some((m) => getBindings()[m].includes(vk)) ? swallow(vk) : false

    if (phase === 'idle') {
      if (vk === VK.Escape && h.isBusy() && h.onCancelProcessing?.()) return swallow(vk, true)
      const paste = getBindings().pasteLast
      if (paste.length && matches(paste)) {
        h.onPasteLast?.()
        return swallow(vk, true)
      }
      const m = modeForPressed()
      if (!m) return isBaseKey(vk) && pressed.size === 1 ? swallow(vk) : false
      if (h.isBusy()) return swallow(vk)
      phase = 'holding'
      mode = m
      pressedAt = startedAt = now()
      h.onStart(m)
      return swallow(vk)
    }

    if (phase === 'holding') {
      const m = modeForPressed()
      if (m && m !== mode) {
        mode = m
        h.onModeChange(m)
        return swallow(vk, true)
      }
      if (vk === VK.Escape) {
        end(false)
        return swallow(vk, true)
      }
      end(false) // someone else's Alt+<key> shortcut
      return false
    }

    // hands-free: the shortcut stops, Esc cancels, typing is left alone
    if (isBaseKey(vk)) {
      end(true)
      return swallow(vk)
    }
    if (vk === VK.Escape) {
      end(false)
      return swallow(vk, true)
    }
    return false
  }

  function keyup(vk: number): boolean {
    pressed.delete(vk)
    const eaten = swallowed.delete(vk)
    if (!pressed.size) settling = false
    if (phase !== 'holding' || vk !== getBindings()[mode][0]) return eaten
    const chord = getBindings()[mode].length > 1
    if (now() - pressedAt < (chord ? CHORD_TAP_MS : TAP_MS)) {
      phase = 'handsFree'
      h.onHandsFree()
    } else {
      end(true)
    }
    return eaten
  }

  return {
    get phase() {
      return phase
    },
    get mode() {
      return mode
    },
    key(vk: number, down: boolean): boolean {
      return down ? keydown(vk) : keyup(vk)
    },
    // A click on the bar's finish/cancel buttons, or the hover pill starting hands-free.
    click(action: 'start' | 'finish' | 'cancel') {
      if (action === 'start' && phase === 'idle' && !h.isBusy()) {
        phase = 'handsFree'
        mode = 'dictate'
        startedAt = now()
        h.onStart('dictate')
        h.onHandsFree()
      } else if (action === 'finish' && phase !== 'idle') end(true)
      else if (action === 'cancel' && phase !== 'idle') end(false)
    },
    // Safety stop for a forgotten hands-free recording.
    timeout() {
      if (phase !== 'idle' && now() - startedAt >= MAX_RECORD_MS) end(true)
    }
  }
}

export type DictationKeyMachine = ReturnType<typeof createDictationKeyMachine>
