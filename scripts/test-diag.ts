// 关于 → 诊断信息: perf.log lines round-trip, the verdict picks the slow stage, nothing else leaks in.
// Usage: npm run test:diag
import { formatDiagnostics, parsePerfLine, perfLine, stageMs, summarize, type PerfEntry } from '../src/main/diagnostics'

let failed = 0
const report = (ok: boolean, name: string, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
}
const at = '2026-10-21T08:00:00.000Z'
const entry = (fields: Record<string, string | number | null>, mode = 'dictate'): PerfEntry =>
  parsePerfLine(`${at} ${perfLine(mode, fields)}`)!

// perfLine / parsePerfLine
const line = perfLine('dictate', { rec: 8200.4, mic: undefined, asr: 'local:640', model: 'qwen 3', fallback: '', result: 'ok' })
report(line === 'dictate rec=8200 mic=- asr=local:640 model=qwen_3 fallback=- result=ok', 'line: rounds, dashes, no spaces', line)
const parsed = parsePerfLine(`${at} ${line}`)
report(parsed?.mode === 'dictate' && parsed.fields.asr === 'local:640', 'parse: mode and fields', JSON.stringify(parsed))
report(parsePerfLine('') === null, 'parse: empty line')
report(parsePerfLine(`${at} rec=1`) === null, 'parse: missing mode')

// stageMs
report(stageMs(parsed!, 'asr') === 640, 'stage: engine prefix stripped')
report(stageMs(parsed!, 'mic') === null, 'stage: dash is unknown')
report(stageMs(parsed!, 'nothing') === null, 'stage: absent field')
report(stageMs(entry({ asr: 'local:' }), 'asr') === null, 'stage: engine without time')

// summarize
const slowWhisper = [1, 2, 3].map((i) =>
  entry({ mic: 100, stop: 300, asr: `local:${600 + i}`, whisper: 3000 + i, refine: 800, paste: 40, wait: 4800, lag: 30, result: 'ok' })
)
const verdict = summarize(slowWhisper)
report(verdict[0].includes('最近 3 次（成功 3 次）') && verdict[0].includes('中位 4.8 秒'), 'summary: counts and wait', verdict[0])
report(verdict[1] === '最慢的环节：等 Whisper 校对英文（中位 3.0 秒）', 'summary: slowest stage', verdict[1])
report(verdict.length === 2, 'summary: no stall or failure lines when fine', JSON.stringify(verdict))

const rough = summarize([
  entry({ refine: 900, wait: 1200, lag: 1800, fallback: 'Groq:rate_limit', result: 'ok' }),
  entry({ lag: 40, result: 'error:network' }),
  entry({ result: 'cancelled' })
])
report(rough.some((l) => l === '程序卡顿：1 次超过 0.5 秒，最长 1.8 秒'), 'summary: stalls', JSON.stringify(rough))
report(rough.some((l) => l === '出错 1 次，首选服务失败、换用备用 1 次'), 'summary: failures and fallbacks', JSON.stringify(rough))
report(rough.some((l) => l.startsWith('最慢的环节：润色')), 'summary: only successful runs ranked', JSON.stringify(rough))
report(summarize([])[0].startsWith('还没有口述记录'), 'summary: nothing yet')

// formatDiagnostics
const log = Array.from({ length: 30 }, (_, i) => `${at} ${perfLine('dictate', { wait: 1000 + i, result: 'ok' })}`).join('\n')
const text = formatDiagnostics({ about: ['Saydra 9.9.9'], perfLog: `${log}\n\nnot a perf line\n`, barLog: '' })
report(text.includes('wait=1029') && !text.includes('wait=1009'), 'format: last 20 lines only')
report(!text.includes('浮条记录'), 'format: no bar section without bar.log')
report(text.includes('not a perf line') && text.includes('最近 19 次'), 'format: odd line kept raw, not counted', text.split('\n')[3])
const withBar = formatDiagnostics({ about: [], perfLog: '', barLog: 'a\nb\nc\nd\ne\nf\n' })
report(withBar.includes('浮条记录：\nb\nc\nd\ne\nf') && !withBar.includes('\na\n'), 'format: last 5 bar lines', withBar)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
