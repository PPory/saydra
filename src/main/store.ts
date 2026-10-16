// The app's data on disk: SQLite database, saved recordings, and the one-time
// import of v0.1 data (history.jsonl and the settings dictionary, both kept as they were).
import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AUDIO_KEEP_MS, RETENTION_MS } from '../shared/hub'
import { openDb, rowFromJsonl, splitDictionary, type Db } from './db'
import { getHistoryRetention, getLegacyDictionary } from './settings'

const userData = () => app.getPath('userData')
// Installs from before the rename keep their database file.
export const dbPath = () => {
  const legacy = join(userData(), 'reatypeless.db')
  return existsSync(legacy) ? legacy : join(userData(), 'saydra.db')
}
export const legacyHistoryPath = () => join(userData(), 'history.jsonl')
export const recordingsDir = () => join(userData(), 'recordings')
export const benchRecordingsDir = () => join(recordingsDir(), 'bench')

let db: Db | null = null

export function getDb(): Db {
  if (!db) throw new Error('store not opened')
  return db
}

export function openStore(): Db {
  db = openDb(dbPath())
  migrate(db)
  void pruneHistory()
  return db
}

function migrate(d: Db): void {
  if (!d.meta.get('imported_jsonl')) {
    let n = 0
    if (existsSync(legacyHistoryPath())) {
      const rows = readFileSync(legacyHistoryPath(), 'utf8').split('\n').map(rowFromJsonl)
      d.transaction(() => {
        for (const r of rows) if (r && !d.getHistory(r.id)) (d.saveHistory(r), n++)
      })
    }
    d.meta.set('imported_jsonl', String(n))
  }
  if (!d.meta.get('imported_dictionary')) {
    d.meta.set('imported_dictionary', String(d.addWords(splitDictionary(getLegacyDictionary()))))
  }
}

export const dictionaryText = (): string => getDb().terms().join('、')

export async function deleteFiles(files: string[]): Promise<void> {
  await Promise.all(files.map((f) => rm(f, { force: true }).catch(() => {})))
}

// Apply the 「保存历史」 choice, and drop audio older than 30 days (text stays).
export async function pruneHistory(): Promise<void> {
  const d = getDb()
  const keep = RETENTION_MS[getHistoryRetention()]
  const files: string[] = []
  if (keep === 0) files.push(...d.deleteAllHistory())
  else if (Number.isFinite(keep)) files.push(...d.deleteHistoryBefore(Date.now() - keep))
  files.push(...d.expireAudioBefore(Date.now() - AUDIO_KEEP_MS))
  await deleteFiles(files)
}

// Every dictation's audio, for retry and 「下载音频」 in history.
export async function saveRecording(id: string, audio: ArrayBuffer): Promise<string> {
  await mkdir(recordingsDir(), { recursive: true })
  const file = join(recordingsDir(), `${id}.webm`)
  await writeFile(file, Buffer.from(audio))
  return file
}

// Opt-in: every clip sent for recognition, named so files sort by time.
export async function saveBenchRecording(audio: ArrayBuffer): Promise<void> {
  await mkdir(benchRecordingsDir(), { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  await writeFile(join(benchRecordingsDir(), `${stamp}.webm`), Buffer.from(audio))
}
