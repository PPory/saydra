// When a paste counts as failed (then the 复制最后的转录 card offers the text).
// Usage: npm run test:paste
import { pasteLanded } from '../src/main/paste-check'
import type { FocusInfo } from '../src/main/platform/helper'

const said = '明天下午四点开会，记得带上周的数据。'
const box = (text: string | undefined, extra: Partial<FocusInfo> = {}): FocusInfo => ({ pid: 100, type: 'Edit', text, ...extra })

const cases: [string, FocusInfo | null, FocusInfo | null, boolean | null][] = [
  ['text box took the paste', box('你好'), box(`你好${said}`), true],
  ['web page with no input focused', box('页面正文', { type: 'Document' }), box('页面正文', { type: 'Document' }), false],
  ['desktop icon focused', { pid: 7, type: 'ListItem' }, { pid: 7, type: 'ListItem' }, false],
  ['empty desktop (FolderView reports Pane)', { pid: 7, type: 'Pane', cls: 'SysListView32' }, { pid: 7, type: 'Pane', cls: 'SysListView32' }, false],
  ['taskbar focused', { pid: 7, type: 'Pane', cls: 'Shell_TrayWnd' }, { pid: 7, type: 'Pane', cls: 'Shell_TrayWnd' }, false],
  ['WeChat: nothing readable', { pid: 9, type: 'Pane', cls: 'Qt51514QWindowIcon' }, { pid: 9, type: 'Pane', cls: 'Qt51514QWindowIcon' }, null],
  ['focus moved to another app', box('a'), box('a', { pid: 200 }), null],
  ['helper unavailable', null, box('a'), null],
  ['long document past the read cap', box('x'.repeat(20000)), box('x'.repeat(20000), { before: `……前文${said}` }), true],
  ['same text pasted with different spacing', box('x'), box('x', { before: `前文 ${said.slice(0, 5)}\r\n${said.slice(5)}` }), true],
  ['box became unreadable after paste', box('a'), { pid: 100, type: 'Edit' }, null]
]

let failed = 0
for (const [name, before, after, expected] of cases) {
  const got = pasteLanded(before, after, said)
  const ok = got === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` (expected ${expected}, got ${got})`}`)
}
console.log(`${cases.length - failed}/${cases.length} passed`)
process.exit(failed ? 1 : 0)
