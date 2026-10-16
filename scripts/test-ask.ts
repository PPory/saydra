// 问任何问题 helpers: reply parsing and the answer card's Markdown (which must escape HTML).
// Usage: npm run test:ask
import { askUserMessage, parseAskReply } from '../src/main/prompts'
import { renderMarkdown } from '../src/renderer/answer-card/markdown'

const cases: [string, boolean, string?][] = []
const check = (name: string, ok: boolean, detail?: unknown) => cases.push([name, ok, detail === undefined ? undefined : String(detail)])

let r = parseAskReply('<edit>改好的文字</edit>')
check('edit tag', r.kind === 'edit' && r.text === '改好的文字', JSON.stringify(r))
r = parseAskReply('<answer>\n**结论**：可以\n</answer>')
check('answer tag', r.kind === 'answer' && r.text === '**结论**：可以', JSON.stringify(r))
r = parseAskReply('<edit>没写完的结尾')
check('unclosed edit still edits', r.kind === 'edit' && r.text === '没写完的结尾', JSON.stringify(r))
r = parseAskReply('模型忘了加标签')
check('no tag is an answer', r.kind === 'answer' && r.text === '模型忘了加标签')
r = parseAskReply('<edit>  </edit>')
check('empty edit is not an edit', r.kind === 'answer')
check('selection goes in tags', askUserMessage('改正式一点', '嗨').includes('<选中文字>\n嗨\n</选中文字>'))
check('no selection sends the question as is', askUserMessage('今天几号', null) === '今天几号')

const md = (s: string) => renderMarkdown(s)
check('html is escaped', !md('<img src=x onerror=alert(1)>').includes('<img'), md('<img src=x onerror=alert(1)>'))
check('code is escaped', md('`<b>`').includes('<code>&lt;b&gt;</code>'), md('`<b>`'))
check('bold and italic', md('**粗** 和 *斜*') === '<p><strong>粗</strong> 和 <em>斜</em></p>', md('**粗** 和 *斜*'))
check('ordered list', md('1. 一\n2. 二') === '<ol><li>一</li><li>二</li></ol>', md('1. 一\n2. 二'))
check('bullet list then paragraph', md('- a\n- b\n\n结束') === '<ul><li>a</li><li>b</li></ul><p>结束</p>', md('- a\n- b\n\n结束'))
check('heading', md('## 标题') === '<h2>标题</h2>')
check('fenced code keeps lines', md('```js\nconst a = 1 < 2\n```') === '<pre><code>const a = 1 &lt; 2</code></pre>', md('```js\nconst a = 1 < 2\n```'))
check('table', md('| a | b |\n|---|---|\n| 1 | 2 |').includes('<td>1</td><td>2</td>'))
check('links show text only', md('[官网](https://x.com)') === '<p><u>官网</u></p>', md('[官网](https://x.com)'))
check('quote', md('> 引用').startsWith('<blockquote><p>引用'), md('> 引用'))

let failed = 0
for (const [name, ok, detail] of cases) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed ? 1 : 0)
