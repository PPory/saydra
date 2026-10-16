// Did a paste land? Compare the focused element before and after Ctrl+V. Pure, so it can
// be tested. Only a clear "no" counts as a failure: a card then offers to copy the
// text instead of it being lost. Anything we cannot read (WeChat, custom-drawn
// boxes, focus moving to another app) is "can't tell" and handled as before.
import type { FocusInfo } from './win-helper'

// How much text before the caret to read for the check (see pasteLanded).
export const PASTE_CHECK_CHARS = 60

// Focus on these is not a place text can go (a desktop icon, a list, a button...).
const NOT_TEXT = new Set([
  'Button', 'CheckBox', 'DataItem', 'Hyperlink', 'Image', 'List', 'ListItem', 'Menu', 'MenuBar', 'MenuItem',
  'RadioButton', 'ScrollBar', 'Slider', 'Tab', 'TabItem', 'Thumb', 'TitleBar', 'ToolBar', 'Tree', 'TreeItem'
])

// The desktop reports itself as a Pane, like WeChat's input box does, so it is told
// apart by window class: desktop icon view, desktop, taskbars.
const NOT_TEXT_CLASSES = new Set(['SysListView32', 'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd'])

const notText = (f: FocusInfo) => (!!f.type && NOT_TEXT.has(f.type)) || (!!f.cls && NOT_TEXT_CLASSES.has(f.cls))

const squash = (s: string) => s.replace(/\s+/g, '')

export function pasteLanded(before: FocusInfo | null, after: FocusInfo | null, text: string): boolean | null {
  if (!before || !after || before.pid !== after.pid) return null
  if (after.text === undefined) return notText(after) && notText(before) ? false : null
  if (before.text === undefined) return null
  if (after.text !== before.text) return true
  // Long documents are read only up to a cap, so a paste past it doesn't change
  // `text`; the text just before the caret then ends with what we pasted.
  const tail = squash(text).slice(-20)
  if (tail && squash(after.before ?? '').endsWith(tail)) return true
  return false
}
