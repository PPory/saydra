// macOS key events → the app's key codes, and the default Fn shortcuts through the
// dictation state machine. Runs on any OS (no macOS API involved).
// Usage: npm run test:mac-keys
import { createDictationKeyMachine } from '../src/main/hotkey'
import { createMacKeyDecoder, FLAG_FN, type KeyEvent } from '../src/main/platform/mac-keys'
import { MAC_BINDINGS, VK } from '../src/shared/keys'

// A raw macOS event: keyDown / keyUp with a key code, or flagsChanged with the flags after it.
type Raw = ['down' | 'up', number] | ['flags', number, number]

const FN = 0x3f
const LSHIFT = 0x38
const ROPTION = 0x3d
const SPACE = 0x31
const ESC = 0x35
const SHIFT_FLAGS = 0x20000 | 0x02 // maskShift + left device bit
const ROPTION_FLAGS = 0x80000 | 0x40

function decode(events: Raw[]): KeyEvent[] {
  const d = createMacKeyDecoder()
  return events.flatMap((e) => (e[0] === 'flags' ? d.flagsChanged(e[1], e[2]) : d.key(e[1], e[0] === 'down')))
}
const show = (keys: KeyEvent[]) => keys.map((k) => `${k.down ? 'down' : 'up'}:${k.vk.toString(16)}`).join(' ')

const decodeCases: [string, Raw[], string][] = [
  ['fn down / up', [['flags', FN, FLAG_FN], ['flags', FN, 0]], 'down:100 up:100'],
  ['🌐 as flag change plus its own key reports once', [['flags', FN, FLAG_FN], ['down', 0xb3], ['up', 0xb3], ['flags', FN, 0]], 'down:100 up:100'],
  ['left shift by device bit', [['flags', LSHIFT, SHIFT_FLAGS], ['flags', LSHIFT, 0]], 'down:a0 up:a0'],
  ['right option is RAlt', [['flags', ROPTION, ROPTION_FLAGS], ['flags', ROPTION, 0]], 'down:a5 up:a5'],
  ['right shift released while left still held', [['flags', 0x3c, 0x20000 | 0x06], ['flags', 0x3c, 0x20000 | 0x02]], 'down:a1 up:a1'],
  ['letters by position', [['down', 0x00], ['down', 0x09], ['down', 0x2e]], 'down:41 down:56 down:4d'],
  ['space, esc, return', [['down', SPACE], ['down', ESC], ['down', 0x24]], 'down:20 down:1b down:d'],
  ['F1 and arrows', [['down', 0x7a], ['down', 0x7b], ['down', 0x7e]], 'down:70 down:25 down:26'],
  ['caps lock toggles as one tap', [['flags', 0x39, 0x10000]], 'down:14 up:14'],
  ['unknown key ignored', [['down', 0x99]], '']
]

// The Fn shortcuts on a timeline: [raw event, at ms].
function machine(events: [Raw, number][]) {
  const d = createMacKeyDecoder()
  const log: string[] = []
  const eaten: string[] = []
  let t = 0
  const m = createDictationKeyMachine(
    () => MAC_BINDINGS,
    {
      onStart: (mode) => log.push(`start:${mode}`),
      onModeChange: (mode) => log.push(`mode:${mode}`),
      onHandsFree: () => log.push('handsFree'),
      onStop: () => log.push('stop'),
      onCancel: () => log.push('cancel'),
      isBusy: () => false
    },
    () => t
  )
  for (const [e, at] of events) {
    t = at
    const keys = e[0] === 'flags' ? d.flagsChanged(e[1], e[2]) : d.key(e[1], e[0] === 'down')
    for (const k of keys) if (m.key(k.vk, k.down)) eaten.push(`${k.down ? 'down' : 'up'}:${k.vk.toString(16)}`)
  }
  return { log: log.join(' '), eaten: eaten.join(' ') }
}

const fnDown: Raw = ['flags', FN, FLAG_FN]
const fnUp: Raw = ['flags', FN, 0]
const machineCases: [string, [Raw, number][], string, string][] = [
  ['hold fn to talk; fn is never swallowed', [[fnDown, 0], [fnUp, 2000]], 'start:dictate stop', ''],
  ['tap fn: hands-free, tap again to stop', [[fnDown, 0], [fnUp, 120], [fnDown, 4000], [fnUp, 4100]], 'start:dictate handsFree stop', ''],
  [
    'fn + space asks, the space never types',
    [[fnDown, 0], [['down', SPACE], 80], [['up', SPACE], 2500], [fnUp, 2600]],
    'start:dictate mode:ask stop',
    'down:20 up:20'
  ],
  [
    'fn + left shift translates',
    [[fnDown, 0], [['flags', LSHIFT, SHIFT_FLAGS | FLAG_FN], 100], [['flags', LSHIFT, FLAG_FN], 2500], [fnUp, 2600]],
    'start:dictate mode:translate stop',
    'down:a0 up:a0'
  ],
  ['fn + arrow is someone else’s: cancel, pass it on', [[fnDown, 0], [['down', 0x7b], 150], [['up', 0x7b], 200], [fnUp, 260]], 'start:dictate cancel', ''],
  ['Esc cancels hands-free and is swallowed', [[fnDown, 0], [fnUp, 120], [['down', ESC], 3000], [['up', ESC], 3050]], 'start:dictate handsFree cancel', 'down:1b up:1b']
]

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
}
for (const [name, events, want] of decodeCases) {
  const got = show(decode(events))
  check(name, got === want, `got "${got}", want "${want}"`)
}
for (const [name, events, want, wantEaten] of machineCases) {
  const got = machine(events)
  check(name, got.log === want && got.eaten === wantEaten, `got "${got.log}" eaten "${got.eaten}"`)
}
check('Fn code sits outside the Windows range', VK.Fn > 0xff)
const total = decodeCases.length + machineCases.length + 1
console.log(`\n${total - failed}/${total} passed`)
process.exit(failed ? 1 : 0)
