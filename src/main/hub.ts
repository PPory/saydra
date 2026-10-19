// IPC for the hub window: stats, history, dictionary, shortcut recording.
import { app, dialog, ipcMain, shell } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { HUB, type AppInfo, type DictSource, type HistoryTab, type HubChange, type ShortcutTarget } from '../shared/hub'
import { toItem } from './db'
import { bundledNotes } from './bundled-notes'
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
  ipcMain.handle(HUB.captureShortcut, (_e, target: ShortcutTarget) => deps.capture.start(target))
  ipcMain.handle(HUB.cancelCapture, () => deps.capture.cancel())
}
