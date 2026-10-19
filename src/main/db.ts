// Local SQLite store for history and the dictionary (Node's built-in node:sqlite,
// so nothing has to be rebuilt for Electron). No Electron imports: tests open it
// with a temp file.
import { DatabaseSync } from 'node:sqlite'
import type { DictationMode } from '../shared/keys'
import type { AskResult, DayActivity, DictSource, DictWord, HistoryItem, HistoryStatus, HistoryTab, HomeStats } from '../shared/hub'
import { TYPING_WPM } from '../shared/hub'
import { countWords, dayKey } from '../shared/text'
import type { Replacement } from './replace'

export interface HistoryRow {
  id: string
  mode: DictationMode
  status: HistoryStatus
  rawText: string
  refinedText: string
  appName: string | null
  title: string | null
  scene: string | null
  asrEngine: string | null
  model: string | null
  durationMs: number
  voicedMs: number | null
  peakRms: number | null
  transcribeMs: number | null
  refineMs: number | null
  audioPath: string | null
  error: string | null
  createdAt: number
  selectedText?: string | null // 问任何问题: the text that was selected when asking
  askResult?: AskResult | null
}

// Heatmap window: 34 week columns.
export const HEATMAP_WEEKS = 34
const MAX_TERM_CHARS = 60

const SCHEMA = `
create table if not exists history (
  id text primary key,
  mode text not null default 'dictate',
  status text not null default 'ok',
  raw_text text not null default '',
  refined_text text not null default '',
  edited_text text,
  app text,
  title text,
  scene text,
  asr_engine text,
  model text,
  duration_ms integer not null default 0,
  voiced_ms integer,
  peak_rms real,
  transcribe_ms integer,
  refine_ms integer,
  words integer not null default 0,
  audio_path text,
  error text,
  created_at integer not null
);
create index if not exists history_created on history (created_at desc);
create table if not exists dictionary (
  id integer primary key autoincrement,
  term text not null unique collate nocase,
  source text not null default 'manual',
  created_at integer not null
);
create table if not exists meta (key text primary key, value text);
`

// Columns added after the first release, as [table, name, definition]. Additive
// only: older rows keep null, nothing is rewritten.
const ADDED_COLUMNS: Array<[string, string, string]> = [
  ['history', 'selected_text', 'text'],
  ['history', 'ask_result', 'text'],
  ['dictionary', 'heard_as', 'text'] // 常被识别成: wrong forms, one per line
]

type Row = Record<string, any>

const toRow = (r: Row): HistoryRow => ({
  id: r.id,
  mode: r.mode,
  status: r.status,
  rawText: r.raw_text,
  refinedText: r.refined_text,
  appName: r.app,
  title: r.title,
  scene: r.scene,
  asrEngine: r.asr_engine,
  model: r.model,
  durationMs: r.duration_ms,
  voicedMs: r.voiced_ms,
  peakRms: r.peak_rms,
  transcribeMs: r.transcribe_ms,
  refineMs: r.refine_ms,
  audioPath: r.audio_path,
  error: r.error,
  createdAt: r.created_at,
  selectedText: r.selected_text ?? null,
  askResult: r.ask_result ?? null
})

export const toItem = (r: HistoryRow): HistoryItem => ({
  id: r.id,
  mode: r.mode,
  status: r.status,
  text: r.askResult === 'answer' ? r.rawText : r.refinedText || r.rawText,
  askResult: r.askResult ?? null,
  appName: r.appName,
  createdAt: r.createdAt,
  durationMs: r.durationMs,
  hasAudio: Boolean(r.audioPath)
})

const forms = (r: Row): string[] => (r.heard_as ? String(r.heard_as).split('\n') : [])
const toWord = (r: Row): DictWord => ({ id: r.id, term: r.term, heardAs: forms(r), source: r.source, createdAt: r.created_at })

// Wrong forms as stored: trimmed, no repeats, never the word itself.
function cleanForms(term: string, heardAs: string[]): string[] | 'too-long' {
  const out: string[] = []
  for (const raw of heardAs) {
    const f = raw.trim()
    if (!f || f.toLowerCase() === term.toLowerCase() || out.some((o) => o.toLowerCase() === f.toLowerCase())) continue
    if (f.length > MAX_TERM_CHARS) return 'too-long'
    out.push(f)
  }
  return out
}
const storeForms = (list: string[]) => (list.length ? list.join('\n') : null)

// Consecutive-day runs over sorted day keys.
function streaks(days: string[], today: string): { current: number; longest: number } {
  const set = new Set(days)
  let longest = 0
  for (const d of days) {
    if (set.has(shiftDay(d, -1))) continue // not the start of a run
    let n = 1
    while (set.has(shiftDay(d, n))) n++
    longest = Math.max(longest, n)
  }
  // A streak is still alive if the last active day is today or yesterday.
  let end = set.has(today) ? today : set.has(shiftDay(today, -1)) ? shiftDay(today, -1) : null
  let current = 0
  while (end && set.has(end)) {
    current++
    end = shiftDay(end, -1)
  }
  return { current, longest }
}

function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + delta))
}

export function openDb(file: string) {
  const db = new DatabaseSync(file)
  db.exec('pragma journal_mode = wal')
  db.exec(SCHEMA)
  for (const [table, name, def] of ADDED_COLUMNS) {
    const have = (db.prepare(`pragma table_info(${table})`).all() as Row[]).some((c) => c.name === name)
    if (!have) db.exec(`alter table ${table} add column ${name} ${def}`)
  }

  const upsert = db.prepare(`
    insert into history (id, mode, status, raw_text, refined_text, app, title, scene, asr_engine, model,
      duration_ms, voiced_ms, peak_rms, transcribe_ms, refine_ms, words, audio_path, error, created_at,
      selected_text, ask_result)
    values (:id, :mode, :status, :raw, :refined, :app, :title, :scene, :engine, :model,
      :duration, :voiced, :peak, :transcribe, :refine, :words, :audio, :error, :created, :selected, :askResult)
    on conflict(id) do update set mode = excluded.mode, status = excluded.status, raw_text = excluded.raw_text,
      refined_text = excluded.refined_text, asr_engine = excluded.asr_engine, model = excluded.model,
      transcribe_ms = excluded.transcribe_ms, refine_ms = excluded.refine_ms, words = excluded.words,
      audio_path = coalesce(excluded.audio_path, history.audio_path), error = excluded.error,
      selected_text = excluded.selected_text, ask_result = excluded.ask_result`)

  function saveHistory(r: HistoryRow): void {
    upsert.run({
      id: r.id,
      mode: r.mode,
      status: r.status,
      raw: r.rawText,
      refined: r.refinedText,
      app: r.appName,
      title: r.title,
      scene: r.scene,
      engine: r.asrEngine,
      model: r.model,
      duration: Math.round(r.durationMs),
      voiced: r.voicedMs,
      peak: r.peakRms,
      transcribe: r.transcribeMs,
      refine: r.refineMs,
      // Words the user spoke: the cleaned dictation, but the transcript for a
      // translation or a question, whose output is not their own words.
      words: r.status === 'ok' ? countWords(r.mode === 'dictate' ? r.refinedText || r.rawText : r.rawText) : 0,
      audio: r.audioPath,
      error: r.error,
      created: r.createdAt,
      selected: r.selectedText ?? null,
      askResult: r.askResult ?? null
    })
  }

  const meta = {
    get: (key: string): string | null => (db.prepare('select value from meta where key = ?').get(key) as Row)?.value ?? null,
    set: (key: string, value: string) =>
      db.prepare('insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, value)
  }

  function transaction<T>(fn: () => T): T {
    db.exec('begin')
    try {
      const out = fn()
      db.exec('commit')
      return out
    } catch (err) {
      db.exec('rollback')
      throw err
    }
  }

  // Rows matching `where`, with their audio files, so the caller can delete both.
  function removeHistory(where: string, ...params: any[]): string[] {
    const audio = (db.prepare(`select audio_path from history where ${where}`).all(...params) as Row[])
      .map((r) => r.audio_path)
      .filter(Boolean)
    db.prepare(`delete from history where ${where}`).run(...params)
    return audio
  }

  function addWord(
    raw: string,
    source: DictSource = 'manual',
    now = Date.now(),
    heardAs: string[] = []
  ): 'added' | 'exists' | 'empty' | 'too-long' {
    const term = raw.trim()
    if (!term) return 'empty'
    if (term.length > MAX_TERM_CHARS) return 'too-long'
    const list = cleanForms(term, heardAs)
    if (list === 'too-long') return 'too-long'
    const res = db
      .prepare('insert or ignore into dictionary (term, source, created_at, heard_as) values (?, ?, ?, ?)')
      .run(term, source, now, storeForms(list))
    return res.changes ? 'added' : 'exists'
  }

  return {
    close: () => db.close(),
    meta,
    transaction,
    saveHistory,

    getHistory(id: string): HistoryRow | null {
      const r = db.prepare('select * from history where id = ?').get(id) as Row | undefined
      return r ? toRow(r) : null
    },

    listHistory(tab: HistoryTab, offset: number, limit: number): HistoryRow[] {
      const where = tab === 'ask' ? "where mode = 'ask'" : tab === 'dictate' ? "where mode != 'ask'" : ''
      return (db.prepare(`select * from history ${where} order by created_at desc limit ? offset ?`).all(limit, offset) as Row[]).map(toRow)
    },

    latestOk(): HistoryRow | null {
      // An answer card is not something to paste.
      const r = db
        .prepare("select * from history where status = 'ok' and ask_result is not 'answer' order by created_at desc limit 1")
        .get() as Row | undefined
      return r ? toRow(r) : null
    },

    deleteHistory: (id: string) => removeHistory('id = ?', id),
    deleteAllHistory: () => removeHistory('1 = 1'),
    deleteHistoryBefore: (ts: number) => removeHistory('created_at < ?', ts),

    // Drop audio older than `ts` but keep the text; returns the files to delete.
    expireAudioBefore(ts: number): string[] {
      const files = (db.prepare('select audio_path from history where audio_path is not null and created_at < ?').all(ts) as Row[]).map((r) => r.audio_path)
      db.prepare('update history set audio_path = null where audio_path is not null and created_at < ?').run(ts)
      return files
    },

    stats(now = new Date()): HomeStats {
      const t = db.prepare("select coalesce(sum(words), 0) w, coalesce(sum(duration_ms), 0) ms from history where status = 'ok'").get() as Row
      const daily = db
        .prepare("select date(created_at / 1000, 'unixepoch', 'localtime') day, sum(words) words from history where status = 'ok' group by day order by day")
        .all() as Row[]
      const byDay = new Map(daily.map((d) => [d.day as string, Number(d.words)]))
      const today = dayKey(now)
      const { current, longest } = streaks([...byDay.keys()], today)
      const minutes = t.ms / 60_000
      // Heatmap columns are weeks starting on Sunday; the last column holds today.
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - (HEATMAP_WEEKS - 1) * 7)
      const activity: DayActivity[] = []
      for (let d = new Date(start); dayKey(d) <= today; d.setDate(d.getDate() + 1)) {
        activity.push({ day: dayKey(d), words: byDay.get(dayKey(d)) ?? 0 })
      }
      return {
        totalWords: Number(t.w),
        totalSeconds: Math.round(t.ms / 1000),
        avgWpm: minutes > 0 ? Math.round(t.w / minutes) : 0,
        savedSeconds: Math.max(0, Math.round((t.w / TYPING_WPM - minutes) * 60)),
        activeDays: byDay.size,
        currentStreak: current,
        longestStreak: longest,
        activity,
        last7: activity.slice(-7)
      }
    },

    listWords(query: string, source: DictSource | null): DictWord[] {
      const conds: string[] = []
      const params: any[] = []
      if (query.trim()) {
        conds.push('(term like ? or heard_as like ?)')
        params.push(`%${query.trim()}%`, `%${query.trim()}%`)
      }
      if (source) {
        conds.push('source = ?')
        params.push(source)
      }
      const where = conds.length ? `where ${conds.join(' and ')}` : ''
      return (db.prepare(`select * from dictionary ${where} order by created_at desc, id desc`).all(...params) as Row[]).map(toWord)
    },

    addWord,

    addWords(terms: string[], source: DictSource = 'manual'): number {
      return transaction(() => terms.filter((t) => addWord(t, source) === 'added').length)
    },

    updateWord(id: number, raw: string, heardAs: string[] = []): 'ok' | 'exists' | 'empty' | 'too-long' {
      const term = raw.trim()
      if (!term) return 'empty'
      if (term.length > MAX_TERM_CHARS) return 'too-long'
      const list = cleanForms(term, heardAs)
      if (list === 'too-long') return 'too-long'
      const clash = db.prepare('select id from dictionary where term = ? and id != ?').get(term, id)
      if (clash) return 'exists'
      db.prepare('update dictionary set term = ?, heard_as = ? where id = ?').run(term, storeForms(list), id)
      return 'ok'
    },

    // Auto-learn: the user replaced `form` with a dictionary word. False if already known.
    addHeardAs(term: string, form: string): boolean {
      const row = db.prepare('select * from dictionary where term = ?').get(term) as Row | undefined
      if (!row) return false
      const before = forms(row)
      const list = cleanForms(row.term, [...before, form])
      if (list === 'too-long' || list.length === before.length) return false
      db.prepare('update dictionary set heard_as = ? where id = ?').run(storeForms(list), row.id)
      return true
    },

    // Undo of addHeardAs.
    removeHeardAs(term: string, form: string): boolean {
      const row = db.prepare('select * from dictionary where term = ?').get(term) as Row | undefined
      if (!row) return false
      const before = forms(row)
      const list = before.filter((f) => f !== form)
      if (list.length === before.length) return false
      db.prepare('update dictionary set heard_as = ? where id = ?').run(storeForms(list), row.id)
      return true
    },

    // Every 常被识别成 form with its word, oldest word first.
    replacements(): Replacement[] {
      const rows = db.prepare('select term, heard_as from dictionary where heard_as is not null order by created_at').all() as Row[]
      return rows.flatMap((r) => forms(r).map((from) => ({ from, to: r.term })))
    },

    deleteWords(ids: number[]): number {
      if (!ids.length) return 0
      return Number(db.prepare(`delete from dictionary where id in (${ids.map(() => '?').join(',')})`).run(...ids).changes)
    },

    terms(): string[] {
      return (db.prepare('select term from dictionary order by created_at').all() as Row[]).map((r) => r.term)
    }
  }
}

export type Db = ReturnType<typeof openDb>

// v0.1 history.jsonl line -> row. Unknown lines are skipped.
export function rowFromJsonl(line: string): HistoryRow | null {
  try {
    const e = JSON.parse(line)
    if (!e.id || !e.createdAt) return null
    return {
      id: e.id,
      mode: 'dictate',
      status: 'ok',
      rawText: e.raw ?? '',
      refinedText: e.refined ?? '',
      appName: e.appName ?? null,
      title: e.title ?? null,
      scene: e.scene ?? null,
      asrEngine: e.asrEngine ?? 'groq',
      model: e.model ?? null,
      durationMs: e.recordMs ?? 0,
      voicedMs: e.voicedMs ?? null,
      peakRms: e.peakRms ?? null,
      transcribeMs: e.transcribeMs ?? null,
      refineMs: e.refineMs ?? null,
      audioPath: null,
      error: null,
      createdAt: Date.parse(e.createdAt)
    }
  } catch {
    return null
  }
}

// The old settings textarea held 「辛禾Xenho, Claude Code」-style lists.
export const splitDictionary = (text: string): string[] =>
  text
    .split(/[\n,，、;；]+/)
    .map((s) => s.trim())
    .filter(Boolean)
