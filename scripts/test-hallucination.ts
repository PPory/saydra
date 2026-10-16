// Usage: npm run test:hallucination
import { keepSpokenText } from '../src/main/hallucination'

const seg = (text: string, no_speech_prob: number, avg_logprob = -0.2) => ({ text, no_speech_prob, avg_logprob })
const cases: Array<[string, ReturnType<typeof seg>[], string]> = [
  ['silence hallucination (real capture)', [seg('请不吝点赞 订阅 转发 打赏支持明镜与点点栏目', 0.61, -0.16)], ''],
  ['room-noise hallucination (real capture)', [seg('请不吝点赞 订阅 转发 打赏支持明镜与点点栏目', 0.23, -0.16)], ''],
  ['subtitle credit on noise', [seg('字幕由Amara.org社区提供', 0.3)], ''],
  ['unsure + low confidence dropped', [seg('嗯嗯', 0.7, -1.2)], ''],
  ['user really dictates 点赞关注', [seg('视频结尾记得提醒大家点赞关注。', 0.01)], '视频结尾记得提醒大家点赞关注。'],
  ['user says 谢谢', [seg('谢谢。', 0.02)], '谢谢。'],
  ['speech then trailing hallucination', [seg('今天先到这里。', 0.0), seg('谢谢观看', 0.45)], '今天先到这里。']
]
let failed = 0
for (const [name, segs, expected] of cases) {
  const got = keepSpokenText(segs)
  const ok = got === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  expected「${expected}」got「${got}」`}`)
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed ? 1 : 0)
