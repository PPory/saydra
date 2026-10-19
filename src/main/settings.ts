import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import { DEFAULT_BINDINGS, type ShortcutBindings } from '../shared/keys'
import type { Appearance, HistoryRetention } from '../shared/hub'
import { findLanguage, MAX_TRANSLATE_LANGUAGES } from '../shared/languages'
import type { AsrEngine, PublicSettings, RefineProvider, SettingsInput, TranslateTarget } from '../shared/types'
import { DEFAULT_REFINE_MODEL } from './groq'

// Empty on a fresh install: the model depends on the service the user brings.
export const DEFAULT_CUSTOM_MODEL = ''

interface Schema {
  encryptedApiKey: string // Groq key, base64 of safeStorage ciphertext
  refineModel: string // Groq refine model
  dictionary: string // v0.1 textarea; moved into the database on first M3 start
  saveRecordings: boolean // keep every clip for ASR comparisons
  asrEngine: AsrEngine
  refineProvider: RefineProvider
  customBaseUrl: string // OpenAI-compatible gateway, e.g. CPA
  encryptedCustomKey: string
  customModel: string
  encryptedSiliconflowKey: string // 硅基流动, for cloud recognition
  refineNotes: string // the user's own instructions, appended to the refine prompt
  shortcuts: ShortcutBindings
  interactionSounds: boolean
  appearance: Appearance
  microphoneId: string // '' = system default
  historyRetention: HistoryRetention
  translationLanguages: string[] // up to 3 target language codes
  translationActive: string // the one picked on the bar's 「翻译为」 chip
  muteWhileDictating: boolean
  showIdleBar: boolean // the idle handle stays on screen; off = only while dictating
  autoUpdate: boolean // check GitHub releases on start and every few hours
  lastRunVersion: string // a different version on start means it was just updated
  mutedByApp: boolean // we muted the speakers; undo it after a crash
}

// Created on first use, not at import: the self-test and screenshot modes switch
// userData in index.ts after imports have run, and must not touch real settings.
let instance: Store<Schema> | null = null
const store = () => (instance ??= createStore())
const createStore = () => new Store<Schema>({
  defaults: {
    encryptedApiKey: '',
    refineModel: DEFAULT_REFINE_MODEL,
    dictionary: '',
    saveRecordings: false,
    asrEngine: 'local',
    refineProvider: 'groq',
    customBaseUrl: '',
    encryptedCustomKey: '',
    customModel: DEFAULT_CUSTOM_MODEL,
    encryptedSiliconflowKey: '',
    refineNotes: '',
    shortcuts: DEFAULT_BINDINGS,
    interactionSounds: true,
    appearance: 'system',
    microphoneId: '',
    historyRetention: 'forever',
    translationLanguages: ['en'],
    translationActive: 'en',
    muteWhileDictating: true,
    showIdleBar: true,
    autoUpdate: true,
    lastRunVersion: '',
    mutedByApp: false
  }
})

function decrypt(field: 'encryptedApiKey' | 'encryptedCustomKey' | 'encryptedSiliconflowKey'): string {
  const enc = store().get(field)
  if (!enc || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return ''
  }
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法安全保存 key')
  return safeStorage.encryptString(value).toString('base64')
}

// Saved values win; the env vars are dev-only fallbacks that never touch disk.
// The self-test may force an engine or provider without changing saved settings.
export const getApiKey = (): string => decrypt('encryptedApiKey') || process.env.GROQ_API_KEY || ''
export const getCustomKey = (): string => decrypt('encryptedCustomKey') || process.env.REA_CUSTOM_API_KEY || ''
export const getSiliconflowKey = (): string => decrypt('encryptedSiliconflowKey') || process.env.REA_SF_API_KEY || ''
export const getCustomBaseUrl = (): string => store().get('customBaseUrl') || process.env.REA_CUSTOM_BASE_URL || ''
export const getCustomModel = (): string => store().get('customModel') || process.env.REA_CUSTOM_MODEL || ''
export const getRefineModel = (): string => store().get('refineModel')
export const REFINE_NOTES_MAX = 500
export const getRefineNotes = (): string => store().get('refineNotes')
export const getShortcuts = (): ShortcutBindings => ({ ...DEFAULT_BINDINGS, ...store().get('shortcuts') })
export const getInteractionSounds = (): boolean => store().get('interactionSounds')
export const getLegacyDictionary = (): string => store().get('dictionary')
export const getAppearance = (): Appearance => store().get('appearance')
export const getMicrophoneId = (): string => store().get('microphoneId')
export const getHistoryRetention = (): HistoryRetention => store().get('historyRetention')
export const getTranslationLanguages = (): string[] =>
  store().get('translationLanguages').filter((c) => findLanguage(c)).slice(0, MAX_TRANSLATE_LANGUAGES)

// The chip's language, falling back to the first one when it was removed in settings.
export function getTranslateTarget(): TranslateTarget | null {
  const languages = getTranslationLanguages()
  if (!languages.length) return null
  const saved = store().get('translationActive')
  return { active: languages.includes(saved) ? saved : languages[0], languages }
}
export function setTranslationActive(code: string): void {
  if (getTranslationLanguages().includes(code)) store().set('translationActive', code)
}
export const getMuteWhileDictating = (): boolean => store().get('muteWhileDictating')
export const getShowIdleBar = (): boolean => store().get('showIdleBar')
export const getAutoUpdate = (): boolean => store().get('autoUpdate')
export const getLastRunVersion = (): string => store().get('lastRunVersion')
export const setLastRunVersion = (v: string) => store().set('lastRunVersion', v)
export const getMutedByApp = (): boolean => store().get('mutedByApp')
export const setMutedByApp = (on: boolean): void => store().set('mutedByApp', on)
export const getSaveRecordings = (): boolean => store().get('saveRecordings')
export const getAsrEngine = (): AsrEngine => (process.env.REA_ASR as AsrEngine) || store().get('asrEngine')
export const getRefineProvider = (): RefineProvider =>
  (process.env.REA_REFINE as RefineProvider) || store().get('refineProvider')

const source = (saved: boolean, env: string | undefined) => (saved ? 'settings' : env ? 'env' : 'none')

// Launch at login is the OS's setting, not ours, so read it back from there.
const LOGIN_ARGS = ['--hidden']
// macOS passes no arguments to login items; it says whether it opened us instead.
export const isHiddenLaunch = () =>
  process.argv.includes(LOGIN_ARGS[0]) || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)
const getLaunchAtLogin = () => app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin
function setLaunchAtLogin(on: boolean): void {
  // A dev run would register electron.exe; only the installed app may start at login.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on, args: LOGIN_ARGS })
}

export function getPublicSettings(): PublicSettings {
  const groqSaved = Boolean(decrypt('encryptedApiKey'))
  const customSaved = Boolean(decrypt('encryptedCustomKey'))
  return {
    hasApiKey: Boolean(getApiKey()),
    apiKeySource: source(groqSaved, process.env.GROQ_API_KEY),
    refineModel: store().get('refineModel'),
    saveRecordings: store().get('saveRecordings'),
    asrEngine: store().get('asrEngine'),
    hasSiliconflowKey: Boolean(getSiliconflowKey()),
    siliconflowKeySource: source(Boolean(decrypt('encryptedSiliconflowKey')), process.env.REA_SF_API_KEY),
    refineProvider: store().get('refineProvider'),
    customBaseUrl: getCustomBaseUrl(),
    hasCustomKey: Boolean(getCustomKey()),
    customKeySource: source(customSaved, process.env.REA_CUSTOM_API_KEY),
    customModel: store().get('customModel'),
    refineNotes: getRefineNotes(),
    shortcuts: getShortcuts(),
    interactionSounds: store().get('interactionSounds'),
    appearance: store().get('appearance'),
    microphoneId: store().get('microphoneId'),
    historyRetention: store().get('historyRetention'),
    launchAtLogin: getLaunchAtLogin(),
    translationLanguages: getTranslationLanguages(),
    muteWhileDictating: store().get('muteWhileDictating'),
    showIdleBar: store().get('showIdleBar'),
    autoUpdate: store().get('autoUpdate')
  }
}

export function saveSettings(input: SettingsInput): void {
  if (input.apiKey?.trim()) store().set('encryptedApiKey', encrypt(input.apiKey.trim()))
  if (input.customApiKey?.trim()) store().set('encryptedCustomKey', encrypt(input.customApiKey.trim()))
  if (input.siliconflowKey?.trim()) store().set('encryptedSiliconflowKey', encrypt(input.siliconflowKey.trim()))
  if (input.customBaseUrl !== undefined) store().set('customBaseUrl', input.customBaseUrl.trim().replace(/\/$/, ''))
  if (input.customModel !== undefined) store().set('customModel', input.customModel.trim())
  if (input.refineModel) store().set('refineModel', input.refineModel)
  if (input.refineNotes !== undefined) store().set('refineNotes', input.refineNotes.trim().slice(0, REFINE_NOTES_MAX))
  if (input.saveRecordings !== undefined) store().set('saveRecordings', input.saveRecordings)
  if (input.asrEngine) store().set('asrEngine', input.asrEngine)
  if (input.refineProvider) store().set('refineProvider', input.refineProvider)
  if (input.shortcuts) store().set('shortcuts', input.shortcuts)
  if (input.interactionSounds !== undefined) store().set('interactionSounds', input.interactionSounds)
  if (input.appearance) store().set('appearance', input.appearance)
  if (input.microphoneId !== undefined) store().set('microphoneId', input.microphoneId)
  if (input.historyRetention) store().set('historyRetention', input.historyRetention)
  if (input.launchAtLogin !== undefined) setLaunchAtLogin(input.launchAtLogin)
  if (input.muteWhileDictating !== undefined) store().set('muteWhileDictating', input.muteWhileDictating)
  if (input.showIdleBar !== undefined) store().set('showIdleBar', input.showIdleBar)
  if (input.autoUpdate !== undefined) store().set('autoUpdate', input.autoUpdate)
  if (input.translationLanguages) {
    const before = getTranslationLanguages()
    const codes = [...new Set(input.translationLanguages)].filter((c) => findLanguage(c)).slice(0, MAX_TRANSLATE_LANGUAGES)
    store().set('translationLanguages', codes)
    // A newly added language becomes the active one: adding it means wanting it now.
    const added = codes.find((c) => !before.includes(c))
    if (added) store().set('translationActive', added)
  }
}
