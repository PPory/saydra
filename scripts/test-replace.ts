// 词典 「常被识别成」: fixed replacements on transcripts.
// Usage: npm run test:replace
import { applyReplacements, type Replacement } from '../src/main/replace'

const cases: [string, string, Replacement[], string][] = [
  ['CJK form', '我们在开花新功能', [{ from: '开花', to: '开发' }], '我们在开发新功能'],
  ['every occurrence', '开花，再开花', [{ from: '开花', to: '开发' }], '开发，再开发'],
  ['several forms of one word', '广布和广部', [{ from: '广布', to: '场布' }, { from: '广部', to: '场布' }], '场布和场布'],
  ['Latin whole word', 'get push, then get pull', [{ from: 'get', to: 'git' }], 'git push, then git pull'],
  ['Latin inside a word untouched', 'together getting target', [{ from: 'get', to: 'git' }], 'together getting target'],
  ['Latin ignores case', 'GET status', [{ from: 'get', to: 'git' }], 'git status'],
  ['Latin next to CJK', '用get提交', [{ from: 'get', to: 'git' }], '用git提交'],
  ['mixed form', '打开利浦tv看看', [{ from: '利浦tv', to: 'libtv' }], '打开libtv看看'],
  ['digits form', '按f二保存', [{ from: 'f二', to: 'F2' }], '按F2保存'],
  ['one pass: no chains', 'tape8', [{ from: 'tape8', to: 'tape吧' }, { from: 'tape吧', to: 'tabbar' }], 'tape吧'],
  ['longest form first', 'cloud code 和 cloud', [{ from: 'cloud', to: 'Claude' }, { from: 'cloud code', to: 'Claude Code' }], 'Claude Code 和 Claude'],
  ['form inside the right word left alone', 'Claude Code 和 Code', [{ from: 'Code', to: 'Claude Code' }], 'Claude Code 和 Claude Code'],
  ['regex characters are literal', 'a+b 和 c.d', [{ from: 'a+b', to: 'x+y' }, { from: 'c.d', to: 'CD' }], 'x+y 和 CD'],
  ['empty rules', '原样', [], '原样'],
  ['blank or same-word rules ignored', '原样 git', [{ from: ' ', to: 'x' }, { from: 'GIT', to: 'git' }], '原样 git'],
  ['first word wins a shared form', '开花', [{ from: '开花', to: '开发' }, { from: '开花', to: '开化' }], '开发']
]

let failed = 0
for (const [name, input, rules, want] of cases) {
  const got = applyReplacements(input, rules)
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed ? 1 : 0)
