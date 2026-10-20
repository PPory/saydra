// IPC for the hub window: stats, history, dictionary, shortcut recording.
import { app, clipboard, dialog, ipcMain, session, shell } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { cpus, freemem, totalmem } from 'node:os'
import { join } from 'node:path'
import { HUB, type AppInfo, type DictSource, type HistoryTab, type HubChange, type ShortcutTarget } from '../shared/hub'
import type { AsrEngine } from '../shared/types'
import { localAsrFailed } from './asr'
import { toItem } from './db'
import { bundledNotes } from './bundled-notes'
import { formatDiagnostics } from './diagnostics'
import { refineTargets } from './providers'
import { getApiKey, getAsrEngine } from './settings'
import type { ShortcutCapture } from './shortcut-capture'
import { deleteFiles, getDb } from './store'
import { getHub, showAnswerCard } from './windows'

const MAX_CSV_BYTES = 5 * 1024 * 1024

export function notifyHub(change: HubChange): void {
  getHub()?.webContents.send(HUB.changed, change)
}

const WORD_ERRORS = {
  empty: '请输入一个词',
  'too-long': '名称超过了长度限制。',
  exists: '这个词已经在词典里了'
} as const

const ASR_NAMES: Record<AsrEngine, string> = {
  local: '本地 SenseVoice',
  siliconflow: '硅基流动 SenseVoice',
  groq: 'Groq Whisper'
}
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`

// 关于 → 诊断信息: the machine, the network route and the services in use (names
// and model ids, never keys or full addresses), then the recent perf.log.
export async function diagnostics(): Promise<string> {
  const dir = app.getPath('userData')
  const read = (name: string) => readFile(join(dir, name), 'utf8').catch(() => '')
  const cpu = cpus()
  const appMb = app.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024
  const proxy = await session.defaultSession.resolveProxy('https://api.groq.com').catch(() => '?')
  const engine = getAsrEngine()
  const failed = engine === 'local' ? localAsrFailed() : null
  const refine = refineTargets(0).map((t) => `${t.endpoint.name} ${t.model}`)
  const about = [
    `Saydra ${app.getVersion()} · ${process.platform === 'darwin' ? 'macOS' : 'Windows'} ${process.getSystemVersion()} · ${process.arch}`,
    `CPU：${cpu[0]?.model.trim() ?? '?'} ×${cpu.length} · 内存 ${gb(totalmem())}（空闲 ${gb(freemem())}）· Saydra 占用 ${Math.round(appMb)} MB`,
    `网络：连 Groq 走 ${proxy}`,
    // A load error may name a file under the user's home folder: leave the path out.
    `识别：${ASR_NAMES[engine]}${failed ? `（本地模型加载失败：${failed.message.replace(/[A-Za-z]:\\\S*|\/Users\/\S*/g, '<路径>')}）` : ''}` +
      (engine !== 'groq' && getApiKey() ? ' · 有 Groq key，英文会让 Whisper 再听一遍' : ''),
    `润色：${refine.length ? refine.join(' → 备用 ') : '未配置'}`
  ]
  return formatDiagnostics({ about, perfLog: await read('perf.log'), barLog: await read('bar.log') })
}

// One word per line; the first column of a CSV row.
function parseWordList(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.split(',')[0].trim().replace(/^"(.*)"$/, '$1').trim())
    .filter(Boolean)
}

export function registerHubIpc(deps: { retry: (id: string) => Promise<string | null>; capture: ShortcutCapture }): void {
  const db = getDb

  ipcMain.handle(HUB.stats, () => db().stats())
  ipcMain.handle(HUB.historyList, (_e, tab: HistoryTab, offset: number, limit: number) =>
    db().listHistory(tab, offset, limit).map(toItem)
  )
  ipcMain.handle(HUB.historyDelete, async (_e, id: string) => {
    await deleteFiles(db().deleteHistory(id))
    notifyHub('history')
  })
  ipcMain.handle(HUB.historyDeleteAll, async () => {
    await deleteFiles(db().deleteAllHistory())
    notifyHub('history')
  })
  ipcMain.handle(HUB.historyRetry, (_e, id: string) => deps.retry(id))
  ipcMain.handle(HUB.historyAnswer, (_e, id: string) => {
    const row = db().getHistory(id)
    if (row?.askResult === 'answer')
      showAnswerCard({ prompt: row.rawText, selectedText: row.selectedText ?? null, answer: row.refinedText })
  })
  ipcMain.handle(HUB.historySaveAudio, async (_e, id: string) => {
    const row = db().getHistory(id)
    if (!row?.audioPath) return { ok: false, message: '这条记录的音频已过期（保留 30 天）' }
    const win = getHub()
    const opts = { defaultPath: `${id}.webm`, filters: [{ name: '音频', extensions: ['webm'] }] }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { ok: false, message: '' }
    await writeFile(res.filePath, await readFile(row.audioPath))
    return { ok: true, message: '音频已保存' }
  })

  ipcMain.handle(HUB.dictList, (_e, query: string, source: DictSource | null) => db().listWords(query, source))
  ipcMain.handle(HUB.dictAdd, (_e, term: string, heardAs: string[] = []) => {
    const res = db().addWord(term, 'manual', Date.now(), heardAs)
    if (res !== 'added') return { ok: false, message: WORD_ERRORS[res] }
    notifyHub('dictionary')
    return { ok: true, message: `'${term.trim()}' 添加成功` }
  })
  ipcMain.handle(HUB.dictUpdate, (_e, id: number, term: string, heardAs: string[] = []) => {
    const res = db().updateWord(id, term, heardAs)
    if (res !== 'ok') return { ok: false, message: WORD_ERRORS[res] }
    notifyHub('dictionary')
    return { ok: true, message: `已更新 '${term.trim()}'` }
  })
  ipcMain.handle(HUB.dictDelete, (_e, ids: number[]) => {
    const n = db().deleteWords(ids)
    notifyHub('dictionary')
    return n
  })
  ipcMain.handle(HUB.dictImport, async () => {
    const win = getHub()
    const opts = { properties: ['openFile' as const], filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = res.filePaths[0]
    if (res.canceled || !file) return { ok: false, message: '' }
    if ((await stat(file)).size > MAX_CSV_BYTES) return { ok: false, message: '文件太大。最大大小为 5 MB。' }
    const words = parseWordList(await readFile(file, 'utf8'))
    if (!words.length) return { ok: false, message: '文件里没有找到词。请使用一列的 CSV 文件，每行一个词。' }
    const added = db().addWords(words, 'manual')
    notifyHub('dictionary')
    const skipped = words.length - added
    return { ok: true, message: `${added} 个词已添加${skipped ? `，${skipped} 个已存在` : ''}` }
  })

  ipcMain.handle(HUB.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    whatsNew: bundledNotes(app.getVersion())
  }))
  ipcMain.handle(HUB.openDataDir, () => shell.openPath(app.getPath('userData')))
  ipcMain.handle(HUB.copyDiagnostics, async () => clipboard.writeText(await diagnostics()))
  ipcMain.handle(HUB.captureShortcut, (_e, target: ShortcutTarget) => deps.capture.start(target))
  ipcMain.handle(HUB.cancelCapture, () => deps.capture.cancel())
}
