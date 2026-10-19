// Simulated key timelines for the dictation shortcut state machine.
// Windows key bindings on every OS; the Fn defaults are in test-mac-keys.ts.
// Usage: npm run test:hotkey
import { WIN_BINDINGS, shortcutError, VK, type ShortcutBindings } from '../src/shared/keys'
import { createDictationKeyMachine } from '../src/main/hotkey'
import { createShortcutCapture } from '../src/main/shortcut-capture'

type Step = ['down' | 'up', number, number] // [event, virtual key, at ms]

function run(steps: Step[], opts: { busy?: boolean; bindings?: ShortcutBindings } = {}) {
  const log: string[] = []
  const eaten: string[] = []
  let t = 0
  const m = createDictationKeyMachine(
    () => opts.bindings ?? WIN_BINDINGS,
    {
      onStart: (mode) => log.push(`start:${mode}`),
      onModeChange: (mode) => log.push(`mode:${mode}`),
      onHandsFree: () => log.push('handsFree'),
      onStop: () => log.push('stop'),
      onCancel: () => log.push('cancel'),
      onPasteLast: () => log.push('pasteLast'),
      onCancelProcessing: () => !!opts.busy && log.push('cancelProcessing') > 0,
      isBusy: () => !!opts.busy
    },
    () => t
  )
  for (const [ev, key, at] of steps) {
    t = at
    if (m.key(key, ev === 'down')) eaten.push(`${ev}:${key.toString(16)}`)
  }
  return { log, eaten }
}

const A = VK.RAlt
const S = VK.RShift
const SP = VK.Space
const ESC = VK.Escape
const C = 0x43
const TAB = VK.Tab

type Case = [string, Step[], string[], { busy?: boolean; bindings?: ShortcutBindings; eaten?: string[] }?]
const cases: Case[] = [
  ['hold to talk', [['down', A, 0], ['down', A, 50], ['down', A, 100], ['up', A, 2000]], ['start:dictate', 'stop'], { eaten: ['down:a5', 'down:a5', 'down:a5', 'up:a5'] }],
  ['tap, talk, tap to stop', [['down', A, 0], ['up', A, 120], ['down', A, 4000], ['up', A, 4100]], ['start:dictate', 'handsFree', 'stop']],
  ['tap then Esc cancels', [['down', A, 0], ['up', A, 120], ['down', ESC, 3000], ['up', ESC, 3050]], ['start:dictate', 'handsFree', 'cancel'], { eaten: ['down:a5', 'up:a5', 'down:1b', 'up:1b'] }],
  ['accidental double tap is dropped', [['down', A, 0], ['up', A, 80], ['down', A, 250], ['up', A, 300]], ['start:dictate', 'handsFree', 'cancel']],
  ['Alt+Tab passes through and cancels', [['down', A, 0], ['down', TAB, 150], ['up', TAB, 200], ['up', A, 260]], ['start:dictate', 'cancel'], { eaten: ['down:a5', 'up:a5'] }],
  ['typing during hands-free is ignored', [['down', A, 0], ['up', A, 100], ['down', C, 900], ['up', C, 950], ['down', A, 3000], ['up', A, 3080]], ['start:dictate', 'handsFree', 'stop']],
  ['busy blocks a new start but still eats Alt', [['down', A, 0], ['up', A, 100]], [], { busy: true, eaten: ['down:a5', 'up:a5'] }],
  ['next dictation after stop works', [['down', A, 0], ['up', A, 900], ['down', A, 2000], ['up', A, 2100], ['down', A, 5000], ['up', A, 5100]], ['start:dictate', 'stop', 'start:dictate', 'handsFree', 'stop']],
  ['hold Alt+Shift translates', [['down', A, 0], ['down', S, 120], ['up', S, 2500], ['up', A, 2600]], ['start:dictate', 'mode:translate', 'stop'], { eaten: ['down:a5', 'down:a1', 'up:a1', 'up:a5'] }],
  ['tap Alt+Space starts hands-free ask', [['down', A, 0], ['down', SP, 80], ['up', SP, 250], ['up', A, 300], ['down', A, 5000], ['up', A, 5100]], ['start:dictate', 'mode:ask', 'handsFree', 'stop'], { eaten: ['down:a5', 'down:20', 'up:20', 'up:a5', 'down:a5', 'up:a5'] }],
  ['stopping with the whole chord does not restart', [['down', A, 0], ['down', S, 60], ['up', S, 200], ['up', A, 250], ['down', A, 4000], ['down', S, 4050], ['up', S, 4150], ['up', A, 4200]], ['start:dictate', 'mode:translate', 'handsFree', 'stop']],
  ['Esc while holding cancels', [['down', A, 0], ['down', ESC, 1500], ['up', ESC, 1550], ['up', A, 1700]], ['start:dictate', 'cancel']],
  ['Esc while processing cancels it and is swallowed', [['down', ESC, 0], ['up', ESC, 50]], ['cancelProcessing'], { busy: true, eaten: ['down:1b', 'up:1b'] }],
  ['plain Shift and Esc are untouched when idle', [['down', S, 0], ['up', S, 50], ['down', ESC, 100], ['up', ESC, 150]], [], { eaten: [] }],
  ['Right Ctrl binding is not swallowed', [['down', VK.RCtrl, 0], ['up', VK.RCtrl, 2000]], ['start:dictate', 'stop'], { bindings: { ...WIN_BINDINGS, dictate: [VK.RCtrl] }, eaten: [] }],
  ['paste-last shortcut', [['down', VK.LCtrl, 0], ['down', 0x56, 50], ['up', 0x56, 100], ['up', VK.LCtrl, 120]], ['pasteLast'], { bindings: { ...WIN_BINDINGS, pasteLast: [VK.LCtrl, 0x56] } }]
]

let failed = 0
for (const [name, steps, expected, opts = {}] of cases) {
  const { log, eaten } = run(steps, opts)
  const okLog = JSON.stringify(log) === JSON.stringify(expected)
  const okEaten = !opts.eaten || JSON.stringify(eaten) === JSON.stringify(opts.eaten)
  const ok = okLog && okEaten
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!okLog) console.log(`      expected ${expected.join(' → ')}\n      got      ${log.join(' → ')}`)
  if (!okEaten) console.log(`      swallowed expected ${opts.eaten!.join(' ')}\n      swallowed got      ${eaten.join(' ')}`)
}
// Shortcut validation and recording (settings page).
const extra: [string, boolean][] = [
  ['letters only rejected', shortcutError([0x41], 'translate', WIN_BINDINGS) === '快捷键不能只包含字母和数字'],
  ['Space alone rejected', shortcutError([VK.Space], 'ask', WIN_BINDINGS) !== null],
  ['four keys rejected', shortcutError([VK.LCtrl, VK.LShift, VK.LAlt, 0x41], 'ask', WIN_BINDINGS) === '快捷键必须包含3个或更少的键'],
  ['clash rejected', shortcutError([VK.RShift, VK.RAlt], 'ask', WIN_BINDINGS) === '此快捷键已在使用中'],
  ['same binding on itself is fine', shortcutError([VK.RAlt], 'dictate', WIN_BINDINGS) === null],
  ['F-key alone accepted', shortcutError([0x78], 'pasteLast', WIN_BINDINGS) === null],
  ['Ctrl+letter accepted', shortcutError([VK.LCtrl, 0x56], 'pasteLast', WIN_BINDINGS) === null]
]
async function captureCases(): Promise<void> {
  const cap = createShortcutCapture(() => WIN_BINDINGS)
  let p = cap.start('pasteLast')
  const eatsAll = [cap.key(VK.LCtrl, true), cap.key(0x56, true), cap.key(0x56, false), cap.key(VK.LCtrl, false)].every(Boolean)
  let r = await p
  extra.push(['capture records chord in press order', JSON.stringify(r) === JSON.stringify({ ok: true, keys: [VK.LCtrl, 0x56] })])
  extra.push(['capture swallows every key', eatsAll])
  extra.push(['inactive capture passes keys', cap.key(0x41, true) === false])
  p = cap.start('translate')
  cap.key(VK.Escape, true)
  extra.push(['Esc cancels capture', (await p) === null])
  p = cap.start('translate')
  cap.key(0x41, true)
  cap.key(0x41, false)
  r = await p
  extra.push(['capture reports validation error', r !== null && !r.ok])
}
await captureCases()
for (const [name, ok] of extra) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}
const total = cases.length + extra.length
console.log(`\n${total - failed}/${total} passed`)
process.exit(failed ? 1 : 0)
