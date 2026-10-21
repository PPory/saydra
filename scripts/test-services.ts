// 其他 AI 服务: which known service an address is, and the model chosen by itself.
// Usage: npm run test:services
import { AI_SERVICES, pickModel, serviceOf } from '../src/shared/ai-services'

const by = (id: string) => AI_SERVICES.find((s) => s.id === id)!
const deepseek = by('deepseek')
const kimi = by('kimi')
const glm = by('glm')

const cases: [string, unknown, unknown][] = [
  ['preset address', serviceOf('https://api.deepseek.com/v1')?.id, 'deepseek'],
  ['typed with http, no /v1', serviceOf('http://api.deepseek.com')?.id, 'deepseek'],
  ['unknown host', serviceOf('https://cpa.example.com/v1'), null],
  ['no address', serviceOf(''), null],
  ['not a URL', serviceOf('api.deepseek.com'), null],
  ['preferred first', pickModel(deepseek, ['deepseek-chat', 'deepseek-flash', 'deepseek-reasoner']), 'deepseek-flash'],
  ['next preferred', pickModel(deepseek, ['deepseek-reasoner', 'deepseek-chat']), 'deepseek-chat'],
  ['pattern', pickModel(kimi, ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'moonshot-v1-8k']), 'kimi-k2.6'],
  ['pattern takes the newest', pickModel(kimi, ['kimi-k2.6', 'kimi-k2.10', 'kimi-k2.7']), 'kimi-k2.10'],
  ['pattern skips thinking variants', pickModel(glm, ['glm-4.7-flashx-thinking', 'glm-4.7-flash']), 'glm-4.7-flash'],
  ['nothing fits: user picks', pickModel(deepseek, ['deepseek-reasoner', 'deepseek-v4-pro']), ''],
  ['only one on offer', pickModel(null, ['my-model']), 'my-model'],
  ['no list from a known service', pickModel(deepseek, []), 'deepseek-chat'],
  ['no list from an unknown service', pickModel(null, []), ''],
  ['list not fetched yet', pickModel(deepseek, null), '']
]

let failed = 0
for (const [name, got, want] of cases) {
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed ? 1 : 0)
