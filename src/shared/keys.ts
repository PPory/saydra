// Windows virtual-key codes for shortcuts, shared by the key hook and the settings UI.

export const VK = {
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  Escape: 0x1b,
  Space: 0x20,
  LWin: 0x5b,
  RWin: 0x5c,
  LShift: 0xa0,
  RShift: 0xa1,
  LCtrl: 0xa2,
  RCtrl: 0xa3,
  LAlt: 0xa4,
  RAlt: 0xa5,
  F24: 0x87
} as const

export type DictationMode = 'dictate' | 'translate' | 'ask'

// A shortcut is a chord of virtual keys; the first one is held to talk.
export type Shortcut = number[]

export interface ShortcutBindings {
  dictate: Shortcut
  translate: Shortcut
  ask: Shortcut
  pasteLast: Shortcut // empty = unbound
}

// Defaults on Windows.
export const DEFAULT_BINDINGS: ShortcutBindings = {
  dictate: [VK.RAlt],
  translate: [VK.RAlt, VK.RShift],
  ask: [VK.RAlt, VK.Space],
  pasteLast: []
}

const NAMES: Record<number, string> = {
  [VK.Backspace]: 'Backspace',
  [VK.Tab]: 'Tab',
  [VK.Enter]: 'Enter',
  [VK.Escape]: 'Esc',
  [VK.Space]: 'Space',
  [VK.LWin]: '左 Win',
  [VK.RWin]: '右 Win',
  [VK.LShift]: '左 Shift',
  [VK.RShift]: '右 Shift',
  [VK.LCtrl]: '左 Ctrl',
  [VK.RCtrl]: '右 Ctrl',
  [VK.LAlt]: '左 Alt',
  [VK.RAlt]: '右 Alt',
  0x14: 'CapsLock',
  0x2d: 'Insert',
  0x2e: 'Delete',
  0x24: 'Home',
  0x23: 'End',
  0x21: 'PageUp',
  0x22: 'PageDown',
  0x25: '←',
  0x26: '↑',
  0x27: '→',
  0x28: '↓'
}

export function keyName(vk: number): string {
  if (NAMES[vk]) return NAMES[vk]
  if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk)
  if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`
  if (vk >= 0x60 && vk <= 0x69) return `Num ${vk - 0x60}`
  return `键 ${vk}`
}

export const shortcutLabel = (s: Shortcut): string => (s.length ? s.map(keyName).join(' + ') : '未设置')

// Keys that type text. A shortcut made only of these would fire while typing.
const isTypingKey = (vk: number) =>
  (vk >= 0x30 && vk <= 0x39) || // 0-9
  (vk >= 0x41 && vk <= 0x5a) || // A-Z
  (vk >= 0x60 && vk <= 0x6f) || // numpad
  (vk >= 0xba && vk <= 0xe2) || // ; = , - . / ` [ \ ] '
  vk === VK.Space ||
  vk === VK.Enter ||
  vk === VK.Tab ||
  vk === VK.Backspace

export const MAX_SHORTCUT_KEYS = 3

// Rules for a recorded shortcut; returns the error to show, or null if usable.
export function shortcutError(keys: Shortcut, target: keyof ShortcutBindings, bindings: ShortcutBindings): string | null {
  if (keys.length > MAX_SHORTCUT_KEYS) return '快捷键必须包含3个或更少的键'
  if (keys.includes(VK.Escape)) return '此快捷键已保留供系统使用'
  if (keys.every(isTypingKey)) return '快捷键不能只包含字母和数字'
  const same = (a: Shortcut) => a.length === keys.length && a.every((k) => keys.includes(k))
  const clash = (Object.keys(bindings) as (keyof ShortcutBindings)[]).some((k) => k !== target && same(bindings[k]))
  return clash ? '此快捷键已在使用中' : null
}
