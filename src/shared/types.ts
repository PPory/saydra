// Types and IPC channel names shared by main, preload and renderer.
import type { Appearance, HistoryRetention } from './hub'
import type { DictationMode, ShortcutBindings } from './keys'

export type Scene = 'chat' | 'email' | 'document' | 'code' | 'ai' | 'other'

export interface FocusContext {
  appName: string // executable name, e.g. "WeChat.exe"
  title: string // window title
  scene: Scene
}

// Translate mode's 「翻译为 …」 chip: the chosen target languages, newest choice first.
export interface TranslateTarget {
  active: string // language code
  languages: string[]
}

// What the floating pill shows. The idle handle stays on screen unless the user turned it off.
export type BarView =
  | { kind: 'idle' }
  | {
      kind: 'recording'
      mode: DictationMode
      handsFree: boolean
      finishKey: string
      startedAt: number
      translate?: TranslateTarget
    }
  | { kind: 'processing'; mode: DictationMode; translate?: TranslateTarget }
  | { kind: 'done' } // progress fills to 100%, then back to idle
  | { kind: 'error' }

export type BarActionName =
  | 'pill-click' // idle pill clicked: start hands-free dictation
  | 'finish'
  | 'cancel'
  | 'retry'
  | 'undo-cancel'
  | 'open-settings'
  | 'add-language' // 翻译为 chip: open settings to pick more target languages
  | 'undo-learn' // remove the words auto-learn just added
  | 'copy-last' // 复制最后的转录: the paste went nowhere, copy it on request
  | 'open-permissions' // macOS: a permission the shortcuts need is missing
  | 'install-update' // a downloaded update: restart into it
  | 'show-update' // what the downloaded update changes, on the hub's 关于 page
  | 'dismiss'

export interface AlertAction {
  label: string
  action: BarActionName
  primary?: boolean
  doneLabel?: string // shown briefly after the click (e.g. 已复制) before the card closes
}

// Dark card above the pill.
export interface BarAlert {
  id: string
  title: string
  description?: string
  quote?: string // one line of quoted text under the title, cut with an ellipsis
  actions?: AlertAction[]
  autoHideMs?: number
}

// 问任何问题: what the answer card shows.
export interface AnswerPayload {
  prompt: string // what the user said
  selectedText: string | null
  answer: string // markdown
}

export interface VoiceStats {
  voicedMs: number // time the mic level was above the voice threshold
  peakRms: number
  micOpenMs?: number // asking for the microphone until it was recording (perf.log)
}

// siliconflow: the same SenseVoice in 硅基流动's cloud, so the local model stays unloaded
export type AsrEngine = 'local' | 'siliconflow' | 'groq'
export type RefineProvider = 'groq' | 'custom'
export type KeySource = 'settings' | 'env' | 'none'

export interface PublicSettings {
  hasApiKey: boolean // Groq
  apiKeySource: KeySource
  refineModel: string // Groq refine model
  saveRecordings: boolean
  asrEngine: AsrEngine
  hasSiliconflowKey: boolean
  siliconflowKeySource: KeySource
  refineProvider: RefineProvider
  customBaseUrl: string
  hasCustomKey: boolean
  customKeySource: KeySource
  customModel: string
  refineNotes: string // the user's own instructions for refine
  shortcuts: ShortcutBindings
  interactionSounds: boolean
  appearance: Appearance
  microphoneId: string
  historyRetention: HistoryRetention
  launchAtLogin: boolean
  translationLanguages: string[]
  muteWhileDictating: boolean
  showIdleBar: boolean
  autoUpdate: boolean
}

export interface SettingsInput {
  apiKey?: string
  refineModel?: string
  saveRecordings?: boolean
  asrEngine?: AsrEngine
  siliconflowKey?: string
  refineProvider?: RefineProvider
  customBaseUrl?: string
  customApiKey?: string // '' clears the saved key
  customModel?: string
  refineNotes?: string
  shortcuts?: ShortcutBindings
  interactionSounds?: boolean
  appearance?: Appearance
  microphoneId?: string
  historyRetention?: HistoryRetention
  launchAtLogin?: boolean
  translationLanguages?: string[]
  muteWhileDictating?: boolean
  showIdleBar?: boolean
  autoUpdate?: boolean
}

// What the bar must capture besides the webm: decoded 16 kHz PCM for the local engine.
export interface RecordingRequest {
  wantPcm: boolean
  sounds: boolean // play the start/stop cues
  deviceId: string // '' = system default microphone
}

export interface TestResult {
  ok: boolean
  message: string
  models?: string[]
}

// 「试一下」 sample: filler, a self-correction and no punctuation, like real speech.
export const TRY_REFINE_SAMPLE = '嗯那个我们明天下午三点不对四点开会吧然后记得带上周的数据'

// 「试一下」: one real refine of a sample sentence with a single service.
export interface TryRefineResult {
  ok: boolean
  message: string // model and timing, or what went wrong
  output?: string
}

// One call to gpt-oss-120b on the Groq free tier fits ~15 min of speech.
export const MAX_RECORD_MS = 15 * 60_000
export const COUNTDOWN_MS = 60_000 // bar counts down over the last minute

export const IPC = {
  // main -> floating bar
  startRecording: 'bar:start-recording',
  stopRecording: 'bar:stop-recording',
  cancelRecording: 'bar:cancel-recording',
  setView: 'bar:set-view',
  showAlert: 'bar:show-alert',
  clearAlert: 'bar:clear-alert',
  // floating bar -> main
  recordingDone: 'bar:recording-done',
  recordingFailed: 'bar:recording-failed',
  barAction: 'bar:action',
  barInteractive: 'bar:interactive', // pointer is over the pill or a card: take clicks
  barHitRects: 'bar:hit-rects', // where the pill and cards are, [left, top, right, bottom] each
  resendCancelled: 'bar:resend-cancelled', // main -> bar: undo a cancel, send the kept audio
  decodeAudio: 'bar:decode-audio', // main -> bar: webm -> 16 kHz PCM for retrying a saved recording
  decodedAudio: 'bar:decoded-audio',
  translateTo: 'bar:translate-to', // bar -> main: pick a target language on the chip
  showIdleBar: 'bar:show-idle', // main -> bar: keep the idle handle on screen or not
  // answer card
  cardShow: 'card:show', // main -> card, for a card that is already open
  cardPayload: 'card:payload', // card -> main on mount: what to show
  cardClose: 'card:close',
  cardResize: 'card:resize',
  copyText: 'app:copy-text',
  // settings window <-> main
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  testConnection: 'settings:test',
  testCustom: 'settings:test-custom',
  testSiliconflow: 'settings:test-siliconflow',
  tryRefine: 'settings:try-refine',
  openExternal: 'app:open-external'
} as const
