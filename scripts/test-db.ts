// Checks the SQLite store: word counts, stats and streaks, retention, dictionary, jsonl import.
// Usage: npm run test:db
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDb, rowFromJsonl, splitDictionary, toItem, type HistoryRow } from '../src/main/db'
import { countWords, dayKey } from '../src/shared/text'

let failed = 0
let total = 0
function check(name: string, ok: boolean, detail = ''): void {
  total++
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
}

const dir = mkdtempSync(join(tmpdir(), 'rea-db-'))
const db = openDb(join(dir, 'test.db'))

const DAY = 24 * 3600_000
const now = new Date(2026, 9, 14, 15, 0) // Wed 14 Oct 2026, local time
const row = (id: string, daysAgo: number, text: string, extra: Partial<HistoryRow> = {}): HistoryRow => ({
  id,
  mode: 'dictate',
  status: 'ok',
  rawText: text,
  refinedText: text,
  appName: 'Notepad.exe',
  title: null,
  scene: null,
  asrEngine: 'local',
  model: 'qwen',
  durationMs: 6000,
  voicedMs: 5000,
  peakRms: 0.5,
  transcribeMs: 300,
  refineMs: 600,
  audioPath: null,
  error: null,
  createdAt: now.getTime() - daysAgo * DAY,
  ...extra
})

// --- word counting
check('CJK chars count one each', countWords('你好世界') === 4)
check('mixed text', countWords('我在用 Claude Code 写代码') === 8, String(countWords('我在用 Claude Code 写代码')))
check("apostrophes and dots stay in one word", countWords("it's v1.2 ok") === 3, String(countWords("it's v1.2 ok")))

// --- stats and streaks: active today, yesterday, 2 days ago; then a gap; then a 4-day run
for (const d of [0, 1, 2]) db.saveHistory(row(`a${d}`, d, '这是十个字的一句话吧'))
for (const d of [10, 11, 12, 13]) db.saveHistory(row(`b${d}`, d, '五个字的话'))
db.saveHistory(row('err', 0, '', { status: 'error', error: 'network' }))
const s = db.stats(now)
check('total words only count successes', s.totalWords === 3 * 10 + 4 * 5, String(s.totalWords))
check('current streak', s.currentStreak === 3, String(s.currentStreak))
check('longest streak', s.longestStreak === 4, String(s.longestStreak))
check('active days', s.activeDays === 7, String(s.activeDays))
check('heatmap ends today', s.activity.at(-1)?.day === dayKey(now), s.activity.at(-1)?.day)
check('heatmap starts on a Sunday', new Date(s.activity[0].day + 'T00:00').getDay() === 0, s.activity[0].day)
check('last 7 days', s.last7.length === 7 && s.last7.at(-1)?.words === 10, JSON.stringify(s.last7))
check('avg speed', s.avgWpm === Math.round(50 / (7 * 6 / 60)), String(s.avgWpm))

// A streak survives until the end of the next day.
const tomorrow = new Date(now.getTime() + DAY)
check('streak alive the day after', db.stats(tomorrow).currentStreak === 3)
check('streak broken after a missed day', db.stats(new Date(now.getTime() + 2 * DAY)).currentStreak === 0)

// --- history list and tabs
db.saveHistory(row('ask1', 0, '问题', { mode: 'ask' }))
db.saveHistory(row('tr1', 0, 'hello', { mode: 'translate' }))
check('ask tab', db.listHistory('ask', 0, 50).map((r) => r.id).join() === 'ask1')
check('dictate tab includes translations', db.listHistory('dictate', 0, 50).some((r) => r.id === 'tr1'))
check('all tab newest first', db.listHistory('all', 0, 3).every((r, i, a) => i === 0 || a[i - 1].createdAt >= r.createdAt))

// --- retry keeps the saved audio when the new row has none
db.saveHistory(row('retry', 0, '', { status: 'error', audioPath: 'C:/x/retry.webm' }))
db.saveHistory(row('retry', 0, '重试后的文字'))
const retried = db.getHistory('retry')
check('retry updates text', retried?.status === 'ok' && retried.refinedText === '重试后的文字')
check('retry keeps audio path', retried?.audioPath === 'C:/x/retry.webm')

// --- retention
const before = db.listHistory('all', 0, 100).length
const dropped = db.deleteHistoryBefore(now.getTime() - 7 * DAY)
check('retention deletes old rows', db.listHistory('all', 0, 100).length === before - 4)
check('retention returns audio files', Array.isArray(dropped))
db.saveHistory(row('old-audio', 40, '旧录音', { audioPath: 'C:/x/old.webm' }))
check('audio expiry returns files', db.expireAudioBefore(now.getTime() - 30 * DAY).join() === 'C:/x/old.webm')
check('audio expiry keeps text', db.getHistory('old-audio')?.refinedText === '旧录音' && !db.getHistory('old-audio')?.audioPath)
check('delete returns audio', db.deleteHistory('retry').join() === 'C:/x/retry.webm')

// --- dictionary
check('add word', db.addWord('辛禾Xenho') === 'added')
check('duplicate ignores case', db.addWord('claude code') === 'added' && db.addWord('Claude Code') === 'exists')
check('empty rejected', db.addWord('   ') === 'empty')
check('bulk add counts new words', db.addWords(['Typeless', '辛禾Xenho', 'SenseVoice']) === 2)
check('search', db.listWords('xen', null).map((w) => w.term).join() === '辛禾Xenho')
db.addWord('自动词', 'auto')
check('source filter', db.listWords('', 'auto').map((w) => w.term).join() === '自动词')
const id = db.listWords('Typeless', null)[0].id
check('rename clash', db.updateWord(id, 'SENSEVOICE') === 'exists')
check('rename', db.updateWord(id, 'Typeless 2') === 'ok')
check('batch delete', db.deleteWords(db.listWords('', 'auto').map((w) => w.id)) === 1)
// --- 常被识别成
check('add with heard forms', db.addWord('开发', 'manual', Date.now(), ['开花', ' 开化 ', '开花', '开发']) === 'added')
const dev = db.listWords('开发', null)[0]
check('forms trimmed, no repeats, never the word', dev?.heardAs.join() === '开花,开化', JSON.stringify(dev?.heardAs))
check('search finds a form', db.listWords('开化', null).map((w) => w.term).join() === '开发')
check('words without forms list none', db.listWords('辛禾', null)[0]?.heardAs.length === 0)
check('form too long', db.addWord('长', 'manual', Date.now(), ['x'.repeat(61)]) === 'too-long')
check('edit forms', db.updateWord(dev.id, '开发', ['开化']) === 'ok' && db.listWords('开发', null)[0].heardAs.join() === '开化')
check('learn a form', db.addHeardAs('开发', '开花') && db.listWords('开发', null)[0].heardAs.join() === '开化,开花')
check('learned form already known', !db.addHeardAs('开发', '开花') && !db.addHeardAs('没有这个词', '错'))
check('replacements list', JSON.stringify(db.replacements()) === JSON.stringify([{ from: '开化', to: '开发' }, { from: '开花', to: '开发' }]), JSON.stringify(db.replacements()))
check('clearing forms', db.updateWord(dev.id, '开发', []) === 'ok' && db.replacements().length === 0)
check('split old textarea', splitDictionary('辛禾Xenho, Claude Code，Typeless\nA、B').length === 5)

// --- jsonl import
const r = rowFromJsonl(JSON.stringify({ id: 'j1', createdAt: '2026-10-13T08:00:00.000Z', raw: 'r', refined: '整理', recordMs: 3000, asrEngine: 'groq' }))
check('jsonl row', r?.refinedText === '整理' && r.durationMs === 3000 && r.mode === 'dictate')
check('bad jsonl skipped', rowFromJsonl('{oops') === null)

// --- 问任何问题 and 翻译 rows
db.deleteAllHistory()
db.saveHistory(row('d1', 0, '普通口述', { createdAt: now.getTime() - 3000 }))
db.saveHistory(
  row('q1', 0, '', {
    mode: 'ask',
    rawText: '这段话什么意思',
    refinedText: '这是一段很长很长的回答，包含了许多许多字',
    selectedText: 'hello world',
    askResult: 'answer',
    createdAt: now.getTime() - 1000
  })
)
const q = db.getHistory('q1')
check('ask row keeps selection and result', q?.selectedText === 'hello world' && q.askResult === 'answer')
check('answer row lists the question', toItem(q!).text === '这段话什么意思' && toItem(q!).askResult === 'answer')
check('paste-last skips answers', db.latestOk()?.id === 'd1', db.latestOk()?.id)
db.saveHistory(row('t1', 0, '你好', { mode: 'translate', refinedText: 'Hello there my good friend', createdAt: now.getTime() }))
check('translation counts spoken words', db.stats(now).totalWords === countWords('普通口述') + countWords('这段话什么意思') + 2)
check('ask tab', db.listHistory('ask', 0, 10).map((h) => h.id).join() === 'q1')

// --- a database from before the ask columns gets them added, rows intact
const oldFile = join(dir, 'old.db')
const old = new DatabaseSync(oldFile)
old.exec(`create table history (id text primary key, mode text not null default 'dictate', status text not null default 'ok',
  raw_text text not null default '', refined_text text not null default '', edited_text text, app text, title text, scene text,
  asr_engine text, model text, duration_ms integer not null default 0, voiced_ms integer, peak_rms real, transcribe_ms integer,
  refine_ms integer, words integer not null default 0, audio_path text, error text, created_at integer not null)`)
old.exec("insert into history (id, raw_text, refined_text, words, created_at) values ('old1', '旧', '旧记录', 3, 1)")
old.exec(`create table dictionary (id integer primary key autoincrement, term text not null unique collate nocase,
  source text not null default 'manual', created_at integer not null)`)
old.exec("insert into dictionary (term, created_at) values ('旧词', 1)")
old.close()
const upgraded = openDb(oldFile)
const o = upgraded.getHistory('old1')
check('old database upgraded in place', o?.refinedText === '旧记录' && o.askResult === null && o.selectedText === null)
check('old dictionary gets 常被识别成', upgraded.listWords('', null)[0]?.heardAs.length === 0 && upgraded.addHeardAs('旧词', '久词'))
upgraded.close()
check('upgrade runs once', (openDb(oldFile).close(), true))

db.close()
rmSync(dir, { recursive: true, force: true })
console.log(`\n${total - failed}/${total} passed`)
process.exit(failed ? 1 : 0)
