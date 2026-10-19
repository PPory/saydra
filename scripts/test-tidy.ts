// Deterministic checks around the refine model: filler-only transcripts, Markdown cleanup.
// Usage: npm run test:tidy
import { isFillerOnly, tidyRefined } from '../src/main/text-tidy'
import type { Scene } from '../src/shared/types'

const filler: [string, string, Scene, boolean][] = [
  ['hesitation', '呃……', 'other', true],
  ['interjections with punctuation', '嗯，啊。嗯嗯', 'other', true],
  ['English hesitation', 'um, uh', 'other', true],
  ['acknowledgement kept in chat', '嗯嗯', 'chat', false],
  ['oh kept in chat', '哦。', 'chat', false],
  ['hesitation dropped in chat too', '呃', 'chat', true],
  ['laughter is content', '哈哈哈', 'other', false],
  ['a real answer', '好的', 'other', false],
  ['filler around words', '嗯，可以', 'other', false],
  ['empty', '', 'other', false],
  ['punctuation only', '。，', 'other', false]
]

const tidy: [string, string, Scene, string][] = [
  ['plain text untouched', '明天下午开会。', 'other', '明天下午开会。'],
  ['bold around Chinese', '这是**重点**内容', 'other', '这是重点内容'],
  ['bold around ASCII kept', 'use **kwargs here', 'other', 'use **kwargs here'],
  ['heading over Chinese', '## 要点\n1. 第一项', 'document', '要点\n1. 第一项'],
  ['code scene keeps markup', '# 注释\n**加粗**', 'code', '# 注释\n**加粗**'],
  ['hash without Chinese kept', '#123 已经修了', 'other', '#123 已经修了'],
  ['fenced answer unwrapped', '```\n帮我改一下\n```', 'other', '帮我改一下'],
  ['blank lines collapsed', '第一段\n\n\n\n第二段', 'other', '第一段\n\n第二段'],
  ['trailing spaces trimmed', '第一行  \n第二行\t', 'other', '第一行\n第二行'],
  ['list kept', '要做三件事：\n\n1. 写文档\n2. 搭环境', 'ai', '要做三件事：\n\n1. 写文档\n2. 搭环境']
]

let failed = 0
const report = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
}
for (const [name, text, scene, want] of filler) {
  const got = isFillerOnly(text, scene)
  report(got === want, `filler: ${name}`, `-> ${got}, want ${want}`)
}
for (const [name, text, scene, want] of tidy) {
  const got = tidyRefined(text, scene)
  report(got === want, `tidy: ${name}`, `-> ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
