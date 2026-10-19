// Types and IPC channels for the hub (main window): home, history, dictionary, settings.
import type { DictationMode, Shortcut } from './keys'

export type HistoryStatus = 'ok' | 'error'
// 问任何问题 either rewrote the selected text in place or answered on a card.
export type AskResult = 'edit' | 'answer'
export type HistoryTab = 'all' | 'dictate' | 'ask' // translations count as dictation

export interface HistoryItem {
  id: string
  mode: DictationMode
  status: HistoryStatus
  text: string // refined text, or the raw transcript when refining was skipped; an answer row shows the question
  askResult: AskResult | null
  appName: string | null
  createdAt: number // epoch ms
  durationMs: number
  hasAudio: boolean
}

export type DictSource = 'manual' | 'auto'

export interface DictWord {
  id: number
  term: string
  heardAs: string[] // 常被识别成: replaced with `term` in every transcript
  source: DictSource
  createdAt: number
}

export interface DayActivity {
  day: string // local YYYY-MM-DD
  words: number
}

export interface HomeStats {
  totalWords: number
  totalSeconds: number // recorded audio of successful dictations
  avgWpm: number // words per minute of speech
  savedSeconds: number // vs typing at TYPING_WPM
  activeDays: number
  currentStreak: number
  longestStreak: number
  activity: DayActivity[] // every day of the heatmap window, oldest first
  last7: DayActivity[]
}

// Chinese typing speed used for 「节省时间」.
export const TYPING_WPM = 50

export type HistoryRetention = '24h' | '1w' | '1m' | '1y' | 'forever' | 'never'
export const RETENTION_MS: Record<HistoryRetention, number> = {
  '24h': 24 * 3600_000,
  '1w': 7 * 24 * 3600_000,
  '1m': 30 * 24 * 3600_000,
  '1y': 365 * 24 * 3600_000,
  forever: Infinity,
  never: 0
}
// Audio of old dictations is dropped after this; the text stays.
export const AUDIO_KEEP_MS = 30 * 24 * 3600_000

export type Appearance = 'light' | 'dark' | 'system'

export type ShortcutTarget = 'dictate' | 'translate' | 'ask' | 'pasteLast'
export type CaptureResult = { ok: true; keys: Shortcut } | { ok: false; error: string } | null // null = cancelled

export type HubPage = 'home' | 'history' | 'dictionary'
// welcome: first-run guide; permissions: macOS only, when one was lost after setup
export type HubRoute = HubPage | 'settings' | 'models' | 'about' | 'welcome' | 'permissions'

// macOS permissions the app needs; fnKey is 「按下 🌐 键时：不执行任何操作」.
export type MacPermission = 'microphone' | 'accessibility' | 'inputMonitoring' | 'fnKey'
export interface MacPermissions {
  microphone: boolean
  accessibility: boolean
  inputMonitoring: boolean
  fnKey: boolean | null // null: no shortcut uses fn
  hookActive: boolean // the key hook is running (it may need a restart after granting)
}

export interface AppInfo {
  version: string
  dataDir: string
}

// In-app update. 'available' is macOS only: there is a new release but it can't be installed in place.
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; version: string; notes: string[] }
  | { kind: 'downloading'; version: string; notes: string[]; percent: number }
  | { kind: 'ready'; version: string; notes: string[] }
  | { kind: 'error'; message: string }

export const HUB = {
  stats: 'hub:stats',
  historyList: 'hub:history-list',
  historyDelete: 'hub:history-delete',
  historyDeleteAll: 'hub:history-delete-all',
  historyRetry: 'hub:history-retry',
  historySaveAudio: 'hub:history-save-audio',
  historyAnswer: 'hub:history-answer', // reopen the answer card of a 问任何问题 row
  dictList: 'hub:dict-list',
  dictAdd: 'hub:dict-add',
  dictUpdate: 'hub:dict-update',
  dictDelete: 'hub:dict-delete',
  dictImport: 'hub:dict-import',
  appInfo: 'hub:app-info',
  openDataDir: 'hub:open-data-dir',
  captureShortcut: 'hub:capture-shortcut',
  cancelCapture: 'hub:cancel-capture',
  permissions: 'hub:permissions', // macOS; null elsewhere
  grantPermission: 'hub:grant-permission',
  relaunch: 'hub:relaunch',
  updateState: 'hub:update-state',
  updateCheck: 'hub:update-check',
  updateInstall: 'hub:update-install',
  // main -> hub
  changed: 'hub:changed',
  navigate: 'hub:navigate',
  updateChanged: 'hub:update-changed'
} as const

export type HubChange = 'history' | 'dictionary' | 'settings'
