// English casing of local (SenseVoice) transcripts, which come out in capitals.
// Usage: npm run test:case
import { fixEnglishCase } from '../src/main/english-case'

const dict = ['达利欧', 'API', 'claude', 'GPT', 'Claude Code', 'ElevenLabs']
const cases: [string, string][] = [
  ['HELLO EVERYONE MY NAME I星河嗯我也不知道这个 WINDOWS 和 MAC 有什么区别', 'Hello everyone my name I星河嗯我也不知道这个 Windows 和 Mac 有什么区别'],
  ['HELLO MY NAME IS X THIS IS MY TEST TO TEST THE APP', 'Hello my name is X this is my test to test the app'],
  ['HELLO 这是一个测试', 'Hello 这是一个测试'],
  ['按一下 U ALT 键之后', '按一下 U Alt 键之后'],
  ['然后我按 CTRL 加 V', '然后我按 Ctrl 加 V'],
  ['有没有什么 PR 或者是 AI 可以提交的', '有没有什么 PR 或者是 AI 可以提交的'],
  ['我想知道 CLAUDE CODE 和 GT 的性能', '我想知道 Claude Code 和 GT 的性能'],
  ['那个 MC C P 是啥意思', '那个 MC C P 是啥意思'],
  ['我怎么没有看到 ELEVEN 的那个 API', '我怎么没有看到 Eleven 的那个 API'],
  ['在 GITHUB 上提一个 ISSUE', '在 GitHub 上提一个 Issue'],
  ['用 CLAUDE 写', '用 claude 写'],
  ['我用 ChatGPT 和 iPhone', '我用 ChatGPT 和 iPhone'],
  ['今天开会', '今天开会'],
  ['导出成 CSV 和 JSON', '导出成 CSV 和 JSON'],
  ['I THINK IT IS OK', 'I think it is OK']
]

let failed = 0
for (const [input, expected] of cases) {
  const got = fixEnglishCase(input, dict)
  const ok = got === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${input}${ok ? '' : `\n      expected ${expected}\n      got      ${got}`}`)
}
console.log(`${cases.length - failed}/${cases.length} passed`)
process.exit(failed ? 1 : 0)
