import {
  app,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  session,
  shell,
  systemPreferences,
  Tray,
  type BrowserWindow
} from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HUB, type AskResult, type MacPermission, type UpdateState } from '../shared/hub'
import { shortcutLabel, VK, type DictationMode } from '../shared/keys'
import { findLanguage } from '../shared/languages'
import {
  IPC,
  TRY_REFINE_SAMPLE,
  type AsrEngine,
  type BarActionName,
  type BarAlert,
  type BarView,
  type AnswerPayload,
  type FocusContext,
  type RefineProvider,
  type Scene,
  type TryRefineResult,
  type VoiceStats
} from '../shared/types'
import { localAsrFailed, preloadLocalAsr, transcribeLocal } from './asr'
import { finishTracking, learnFrom, trackPaste } from './auto-learn'
import { getFocusContext } from './context'
import { checkKey, LONG_TEXT_CHARS, transcribe } from './groq'
import { createDictationKeyMachine, type DictationKeyHandlers } from './hotkey'
import { notifyHub, registerHubIpc } from './hub'
import { checkForUpdates, getUpdateState, installUpdate, startUpdater } from './updater'
import { runHubShots } from './hub-shots'
import { ApiError, chatWithFallback, listModels, setFetch } from './llm'
import { copySelection, pasteText } from './paste'
import { pasteLanded, PASTE_CHECK_CHARS } from './paste-check'
import { fixEnglishCase } from './english-case'
import { isStockPhrase } from './hallucination'
import {
  askUserMessage,
  buildAskPrompt,
  buildAskSelectionPrompt,
  buildRefineSystemPrompt,
  buildTranslatePrompt,
  buildWhisperPrompt,
  needsRefine,
  parseAskReply
} from './prompts'
import { customEndpoint, refineTarget, refineTargets, setupProblem, warmUpConnections } from './providers'
import {
  getApiKey,
  getAppearance,
  getAsrEngine,
  getHistoryRetention,
  getInteractionSounds,
  getMicrophoneId,
  getMutedByApp,
  getMuteWhileDictating,
  getPublicSettings,
  getSaveRecordings,
  getShortcuts,
  getShowIdleBar,
  getSiliconflowKey,
  getAutoUpdate,
  getRefineNotes,
  getTranslateTarget,
  isHiddenLaunch,
  saveSettings,
  setMutedByApp,
  setTranslationActive
} from './settings'
import { createShortcutCapture } from './shortcut-capture'
import { applyReplacements } from './replace'
import { checkSiliconflowKey, transcribeSiliconFlow } from './siliconflow'
import { isFillerOnly, tidyRefined } from './text-tidy'
import { dictionaryText, getDb, openStore, pruneHistory, saveBenchRecording, saveRecording } from './store'
import {
  closeAnswerCard,
  createFloatingBar,
  getCard,
  getHub,
  isCardVisible,
  openHub,
  placeBar,
  raiseBar,
  registerCardIpc,
  resizeCard,
  setBarInteractive,
  showAnswerCard
} from './windows'
import { isMac, platform } from './platform'
import { grantMacPermission, macPermissions } from './platform/mac'
import { focusInfo, isMuted, setMuted, startHelper, type FocusInfo } from './platform/helper'

// The app was called REATypeless before: an existing install keeps its data
// folder (settings, encrypted keys, history, dictionary) instead of starting empty.
const LEGACY_DATA_DIR = join(app.getPath('appData'), 'REATypeless')
if (existsSync(LEGACY_DATA_DIR)) app.setPath('userData', LEGACY_DATA_DIR)

// Self-test: REA_SELFTEST_WAV=<file.wav> runs one full dictation with the wav as
// a fake microphone, prints the result instead of pasting, then exits.
// REA_ASR=local|groq and REA_REFINE=groq|custom force the services under test.
// REA_SELFTEST_ASR_ONLY=1 runs without any refine service (CI has no key): the raw transcript comes out.
const SELFTEST_WAV = process.env.REA_SELFTEST_WAV
const SELFTEST_ASR_ONLY = Boolean(SELFTEST_WAV && process.env.REA_SELFTEST_ASR_ONLY)
if (SELFTEST_WAV) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', SELFTEST_WAV)
  // macOS sandboxes the audio service, which then cannot open the wav. Self-test only.
  app.commandLine.appendSwitch('disable-features', 'AudioServiceSandbox')
  // Own profile: no clash with an installed instance or the user's settings.
  app.setPath('userData', join(tmpdir(), 'saydra-selftest'))
}

// REA_SELFTEST_LEARN=1: run auto-learn on a sample correction, print what it learned, exit.
const LEARN_TEST = process.env.REA_SELFTEST_LEARN
if (LEARN_TEST) app.setPath('userData', join(tmpdir(), `saydra-learntest-${Date.now()}`))

// REA_HUB_SHOTS=<dir>: screenshot every hub page on sample data (see hub-shots.ts).
const HUB_SHOTS = process.env.REA_HUB_SHOTS
if (HUB_SHOTS) app.setPath('userData', join(tmpdir(), `saydra-hubshots-${Date.now()}`))

// REA_UPDATE_URL=<url>: update from a local folder instead of GitHub (see updater.ts), on a
// throwaway profile. With REA_UPDATE_SHOTS=<dir> it screenshots the hub's 关于 page and the
// bar once the update is downloaded, then exits without installing.
const UPDATE_TEST = process.env.REA_UPDATE_URL
const UPDATE_SHOTS = process.env.REA_UPDATE_SHOTS
if (UPDATE_TEST) app.setPath('userData', join(tmpdir(), `saydra-updatetest-${Date.now()}`))

// REA_ALERT_SHOTS=<dir>: show each kind of alert card on the bar, screenshot, exit.
const ALERT_SHOTS = process.env.REA_ALERT_SHOTS
if (ALERT_SHOTS) app.setPath('userData', join(tmpdir(), `saydra-alertshots-${Date.now()}`))

if (!app.requestSingleInstanceLock()) app.quit()

// Below this much detected voice the clip is silence; sending it would only
// invite Whisper to hallucinate (e.g. 「请不吝点赞…明镜与点点栏目」).
const MIN_VOICED_MS = 250
// Cancelling a recording shorter than this was a slip or someone else's
// Alt shortcut; longer ones get an 「撤销」 card.
const UNDO_CANCEL_AFTER_MS = 1500
const PRUNE_EVERY_MS = 3600_000
const MUTE_AFTER_MS = 500 // after the start cue has played
const STOP_CUE_WAIT_MS = 150 // the stop cue waits this long at most for the sound to come back
const INPUT_CONTEXT_CHARS = 500

const modelsRoot = () =>
  app.isPackaged ? join(process.resourcesPath, 'models') : join(app.getAppPath(), 'data/models')

let bar: BrowserWindow
let tray: Tray
let busy = false
let currentJob: Job | null = null // the dictation being processed
let cancelBeforeJob = false // Esc after stopping, before the audio reached us
let cancelledJob: Job | null = null // for 撤销 on 「转录已取消」 after processing was cancelled
let ctx: FocusContext | null = null
let mode: DictationMode = 'dictate'
let recordStartedAt = 0
let handsFree = false
let view: BarView = { kind: 'idle' }
// 问任何问题: the text selected when the mode began, read while the user talks.
let selection: Promise<string | null> | null = null
// Text before the caret in the input box, as context for refine and translate.
let inputBefore: Promise<string | null> | null = null
let recordingSeq = 0
let mutedByUs = false
let lastLearned: string[] = []

interface Job {
  id: string // history row id; a retry reuses it
  createdAt: number
  audio: ArrayBuffer // webm/opus, for Whisper, retries and saved recordings
  mimeType: string
  pcm: Float32Array | null // 16 kHz mono, for the local engine
  ctx: FocusContext | null
  mode: DictationMode
  recordMs: number
  voice: VoiceStats
  fromHub?: boolean // retried from 历史记录: no paste, no bar alerts, result goes back to the hub
  selection?: Promise<string | null> | null // 问任何问题 only
  inputBefore?: Promise<string | null> | null
  cancelled?: boolean // Esc while processing: the result is dropped
}

// What a mode produced from the transcript, and how to deliver it.
interface Output {
  text: string // pasted, or the answer shown on the card
  prompt: string // the user's words as shown in history: cleaned up where possible
  model: string
  askResult: AskResult | null
  selectedText: string | null
}
// Last failed dictation, kept for the retry button on the alert card.
let pending: Job | null = null

const keepHistory = () => getHistoryRetention() !== 'never'

function setView(next: BarView): void {
  view = next
  bar.webContents.send(IPC.setView, next)
}

function showAlert(alert: Omit<BarAlert, 'id'> & { id?: string }): void {
  if (SELFTEST_WAV && alert.id === 'cancelled') return console.log(`  alert: ${alert.title}`) // REA_SELFTEST_CANCEL
  if (SELFTEST_WAV) {
    console.log(`SELFTEST FAIL: ${alert.title}${alert.description ? `：${alert.description}` : ''}`)
    return app.exit(1)
  }
  bar.webContents.send(IPC.showAlert, { id: alert.id ?? alert.title, ...alert })
}

// Wording for failures, with the next step on a button.
function alertFor(err: unknown): Omit<BarAlert, 'id'> & { retry: boolean } {
  const retry = [{ label: '重试', action: 'retry' as const, primary: true }]
  if (err instanceof ApiError) {
    if (err.kind === 'auth')
      return {
        title: '需要检查设置',
        description: err.message,
        actions: [{ label: '打开设置', action: 'open-settings', primary: true }],
        retry: false
      }
    if (err.kind === 'network' || err.kind === 'timeout')
      return { title: '网络连接不佳', description: '无法完成写作。点击重试继续。', actions: retry, retry: true }
    if (err.kind === 'rate_limit')
      return { title: '当前需求量大', description: `${err.message}。点击重试继续。`, actions: retry, retry: true }
  }
  console.warn('dictation failed', err)
  return { title: '出现问题', description: '无法完成写作。点击重试继续。', actions: retry, retry: true }
}

// Groq Whisper's take on the same audio, for refine to check English words against
// (SenseVoice hears Chinese well and English badly, Whisper the other way round).
// Started alongside recognition rather than after it, and only waited for when the
// transcript has English in it; never holds dictation up for long.
function whisperReference(job: Job): Promise<string | null> {
  const apiKey = getApiKey()
  if (!apiKey) return Promise.resolve(null)
  const heard = transcribe(apiKey, job.audio, { mimeType: job.mimeType, prompt: buildWhisperPrompt(dictionaryText()) })
    // Only there to settle English words: none in it, or a stock outro, and it is no use.
    .then((r) => (/[A-Za-z]/.test(r.text) && !isStockPhrase(r.rawText) ? r.text : null))
    .catch((err) => (console.warn('whisper reference failed', err), null))
  const limit = new Promise<null>((r) => setTimeout(() => r(null), Math.min(8000, 3000 + job.recordMs / 10)))
  return Promise.race([heard, limit])
}

interface Recognized {
  raw: string
  engine: AsrEngine
  heard?: string | null // see whisperReference
}

// 词典 「常被识别成」: the user's fixed replacements.
const applyHeardAs = (text: string): string => applyReplacements(text, getDb().replacements())

// The local model, loaded on demand when it is the fallback for 硅基流动.
async function transcribeOnDevice(job: Job): Promise<string> {
  const pcm = job.pcm ?? (await decodeInBar(job.audio))
  if (!pcm) throw new Error('录音解码失败')
  await preloadLocalAsr(modelsRoot())
  return transcribeLocal(pcm)
}

// SenseVoice, on this machine or in 硅基流动's cloud, with Whisper as reference for
// English; the local model when the cloud fails; Groq Whisper when neither works.
let sfKeyWarned = false

async function recognize(job: Job): Promise<Recognized> {
  const engine = getAsrEngine()
  const cloud = engine === 'siliconflow' && Boolean(getSiliconflowKey())
  if (cloud || (engine === 'local' && !localAsrFailed())) {
    const reference = whisperReference(job)
    const finish = async (said: string, from: AsrEngine): Promise<Recognized> => {
      const heard = /[A-Za-z]/.test(said) && !job.cancelled ? await reference : null
      return { raw: applyHeardAs(fixEnglishCase(said, getDb().terms())), engine: from, heard }
    }
    try {
      if (cloud) return await finish(await transcribeSiliconFlow(getSiliconflowKey(), job.audio, job.mimeType), 'siliconflow')
      return await finish(await transcribeOnDevice(job), 'local')
    } catch (err) {
      if (cloud) {
        console.warn('siliconflow recognition failed, using the local model', err)
        // A bad key won't fix itself: say so once, otherwise every dictation quietly loads the local model.
        if (err instanceof ApiError && err.kind === 'auth' && !sfKeyWarned) {
          sfKeyWarned = true
          showAlert({
            id: 'sf-key',
            title: '硅基流动的 key 用不了',
            description: '这次先用本机识别了。请在设置里重新填写 key。',
            actions: [{ label: '打开设置', action: 'open-settings', primary: true }]
          })
        }
        try {
          return await finish(await transcribeOnDevice(job), 'local')
        } catch (localErr) {
          console.warn('local recognition failed too', localErr)
        }
      }
      if (!getApiKey()) throw err
      console.warn('recognition failed, using Groq Whisper', err)
    }
  }
  const apiKey = getApiKey()
  if (!apiKey) throw new ApiError('还没填 Groq API key，无法使用云端识别', 'auth', 'Groq')
  const { text, rawText } = await transcribe(apiKey, job.audio, {
    mimeType: job.mimeType,
    prompt: buildWhisperPrompt(dictionaryText())
  })
  if (rawText !== text) console.info('dropped hallucinated text:', rawText)
  return { raw: applyHeardAs(text), engine: 'groq' }
}

// The audio file is written once per dictation, alongside recognition.
const savedAudio = new Map<string, Promise<string | null>>()
function audioFileFor(job: Job): Promise<string | null> {
  if (!keepHistory()) return Promise.resolve(null)
  let p = savedAudio.get(job.id)
  if (!p) {
    p = saveRecording(job.id, job.audio).catch((err) => (console.warn('save audio failed', err), null))
    savedAudio.set(job.id, p)
  }
  return p
}

function baseRow(job: Job, audioPath: string | null) {
  return {
    id: job.id,
    mode: job.mode,
    appName: job.ctx?.appName ?? null,
    title: job.ctx?.title ?? null,
    scene: job.ctx?.scene ?? null,
    durationMs: job.recordMs,
    voicedMs: job.voice.voicedMs,
    peakRms: job.voice.peakRms,
    audioPath,
    createdAt: job.createdAt
  }
}

// 口述: clean the transcript up; any failure pastes the transcript itself.
async function refineDictation(job: Job, { raw, engine, heard }: Recognized): Promise<Output> {
  const out: Output = { text: raw, prompt: raw, model: '', askResult: null, selectedText: null }
  if (!needsRefine(raw, engine !== 'local')) return out
  try {
    const system = buildRefineSystemPrompt(job.ctx, dictionaryText(), await job.inputBefore, heard, getRefineNotes())
    const res = await chatWithFallback(refineTargets(raw.length), system, raw, {
      longText: raw.length > LONG_TEXT_CHARS
    })
    for (const e of res.errors) console.warn(`refine via ${e.provider} failed, fell back:`, e.message)
    out.model = res.target.model
    // Cleanup trims fillers, never half the content; a much shorter result
    // means the model summarised, so keep the user's words instead.
    // Again on the result, in case the model put a misheard form back.
    const text = tidyRefined(res.text, job.ctx?.scene ?? 'other')
    if (text && text.length >= raw.length * 0.5) out.text = applyHeardAs(text)
  } catch (err) {
    console.warn('refine failed, pasting raw transcript', err) // degrade, never lose the words
  }
  return out
}

// 翻译: the transcript in the language picked on the bar. Pasting the
// untranslated words would be wrong, so a failure shows the retry card instead.
async function translate(job: Job, { raw, heard }: Recognized): Promise<Output> {
  const lang = findLanguage(getTranslateTarget()?.active ?? '')
  if (!lang) throw new ApiError('未选择目标语言', 'auth')
  const system = buildTranslatePrompt(job.ctx, dictionaryText(), lang, await job.inputBefore, heard)
  const res = await chatWithFallback(refineTargets(raw.length), system, raw, {
    longText: raw.length > LONG_TEXT_CHARS,
    maxTokens: Math.ceil(raw.length * 2) + 300
  })
  if (!res.text) throw new Error('翻译结果为空')
  return { text: res.text, prompt: raw, model: res.target.model, askResult: null, selectedText: null }
}

// 问任何问题: rewrite the selection in place, or answer on the card. SenseVoice's
// transcript (no punctuation when local) is tidied for display meanwhile. With
// English in it the tidy-up also fixes misheard words (「MC C P」), so the question waits for it.
async function askAnything(job: Job, { raw, engine, heard }: Recognized): Promise<Output> {
  const selectedText = (await job.selection) ?? null
  const tidy =
    engine !== 'groq' && needsRefine(raw, engine === 'siliconflow')
      ? chatWithFallback(refineTargets(raw.length), buildRefineSystemPrompt(null, dictionaryText(), null, heard), raw)
          .then((r) => r.text || raw)
          .catch(() => raw)
      : Promise.resolve(raw)
  const res = await chatWithFallback(
    refineTargets(raw.length),
    selectedText ? buildAskSelectionPrompt(job.ctx) : buildAskPrompt(job.ctx),
    askUserMessage(heard ? await tidy : raw, selectedText),
    {
      wrapTag: '',
      temperature: 0.5,
      timeoutMs: 30_000,
      maxTokens: selectedText ? Math.ceil(selectedText.length * 2) + 600 : 2000
    }
  )
  const reply = selectedText ? parseAskReply(res.text) : { kind: 'answer' as const, text: res.text }
  if (!reply.text) throw new Error('回答为空')
  return { text: reply.text, prompt: await tidy, model: res.target.model, askResult: reply.kind, selectedText }
}

// Self-test: let the answer card render, optionally screenshot it.
async function selftestCardShot(): Promise<void> {
  await new Promise((r) => setTimeout(r, 2000))
  const card = getCard()
  const shots = process.env.REA_SELFTEST_SHOTS
  console.log(`  card: ${card?.isVisible() ? `visible ${JSON.stringify(card.getBounds())}` : 'NOT VISIBLE'}`)
  if (card && shots) await writeFile(join(shots, '4-answer-card.png'), (await card.webContents.capturePage()).toPNG())
}

// Self-test: the bar after it settles back to idle (the handle, or nothing when it is turned off).
async function selftestIdleShot(): Promise<void> {
  const shots = process.env.REA_SELFTEST_SHOTS
  if (!shots) return
  setView({ kind: 'done' }) // what a real paste does next
  await new Promise((r) => setTimeout(r, 1500))
  await writeFile(join(shots, '5-idle.png'), (await bar.webContents.capturePage()).toPNG())
}

// Returns an error message for the hub when a retry fails; null on success.
async function processRecording(job: Job): Promise<string | null> {
  busy = true
  currentJob = job
  if (!job.fromHub) setView(processingView(job.mode))
  const audioFile = audioFileFor(job)
  try {
    let t = performance.now()
    const rec = await recognize(job)
    const { raw, engine } = rec
    const transcribeMs = performance.now() - t
    if (job.cancelled) return null
    // REA_SELFTEST_CANCEL=refining: Esc while the text is being refined
    if (SELFTEST_WAV && process.env.REA_SELFTEST_CANCEL === 'refining' && !job.fromHub && !selftestCancelled) selftestCancel()
    // What the focused box holds before we paste, to tell afterwards whether it took it.
    const beforePaste = job.fromHub || SELFTEST_WAV ? null : focusInfo(PASTE_CHECK_CHARS)
    if (!raw) {
      if (job.fromHub) return '没有检测到语音'
      setView({ kind: 'idle' })
      showAlert({ title: '没有检测到语音', description: '请靠近麦克风再说一次。', autoHideMs: 3000 })
      return null
    }
    // Only 「嗯」「呃」: nothing to type, so neither the model nor the paste is bothered.
    if (job.mode === 'dictate' && isFillerOnly(raw, job.ctx?.scene ?? 'other')) {
      if (job.fromHub) return '只听到了语气词'
      setView({ kind: 'idle' })
      showAlert({ title: '只听到了语气词', description: '这次没有输入任何内容。', autoHideMs: 3000 })
      return null
    }
    t = performance.now()
    const out =
      job.mode === 'translate'
        ? await translate(job, rec)
        : job.mode === 'ask'
          ? await askAnything(job, rec)
          : await refineDictation(job, rec)
    const refineMs = performance.now() - t
    if (job.cancelled) return null
    if (!job.fromHub) {
      if (out.askResult === 'answer') {
        showAnswerCard({ prompt: out.prompt, selectedText: out.selectedText, answer: out.text })
        setView({ kind: 'done' })
      } else if (!SELFTEST_WAV) {
        const landed = await pasteText(out.text, () => checkPaste(beforePaste, out.text))
        setView({ kind: 'done' })
        if (landed === false) pasteMissedAlert(out.text)
        else trackPaste(out.text, onLearned)
      }
    }
    pending = null
    if (keepHistory()) {
      try {
        getDb().saveHistory({
          ...baseRow(job, await audioFile),
          status: 'ok',
          rawText: job.mode === 'ask' ? out.prompt : raw,
          refinedText: out.text,
          asrEngine: engine,
          model: out.model,
          transcribeMs: Math.round(transcribeMs),
          refineMs: Math.round(refineMs),
          error: null,
          selectedText: out.selectedText,
          askResult: out.askResult
        })
        notifyHub('history')
      } catch (err) {
        console.warn('history write failed', err)
      }
    }
    if (SELFTEST_WAV) {
      // REA_SELFTEST_RETRY=1: then retry the saved recording as 历史记录 → 重试 would.
      const retryNext = process.env.REA_SELFTEST_RETRY && !job.fromHub
      console.log(`SELFTEST ${job.fromHub ? 'RETRY ' : ''}OK
  mode: ${job.mode}${out.askResult ? ` → ${out.askResult}` : ''}${out.selectedText ? ` (selection: ${out.selectedText.slice(0, 40)})` : ''}
  engine: ${engine} ${Math.round(transcribeMs)}ms
  ${job.mode === 'dictate' ? 'refine' : job.mode}: ${out.model || '(skipped)'} ${Math.round(refineMs)}ms
  transcript: ${raw}${rec.heard ? `\n  reference:  ${rec.heard}` : ''}
  output:     ${out.text}
  voice: ${JSON.stringify(job.voice)}
  history: ${getDb().listHistory('all', 0, 1000).length} rows, today ${getDb().stats().last7.at(-1)?.words} words`)
      if (retryNext)
        setTimeout(() => {
          void retryFromHistory(job.id).then((err) => err && (console.log(`SELFTEST FAIL: retry ${err}`), app.exit(1)))
        }, 0)
      else if (out.askResult === 'answer' && !job.fromHub) void selftestCardShot().then(() => app.exit(0))
      else void selftestIdleShot().then(() => app.exit(0))
    }
    return null
  } catch (err) {
    if (job.cancelled) return null
    const { retry, ...alert } = alertFor(err)
    if (keepHistory()) {
      try {
        getDb().saveHistory({
          ...baseRow(job, await audioFile),
          status: 'error',
          rawText: '',
          refinedText: '',
          asrEngine: null,
          model: null,
          transcribeMs: null,
          refineMs: null,
          error: err instanceof Error ? err.message : String(err)
        })
        notifyHub('history')
      } catch (e) {
        console.warn('history write failed', e)
      }
    }
    if (job.fromHub) return alert.description ?? alert.title
    if (retry) pending = job
    setView({ kind: 'error' })
    showAlert({ id: 'dictation-error', ...alert })
    if (err instanceof ApiError && err.kind === 'auth') openHub('models')
    return null
  } finally {
    // A cancelled job already handed the bar back; a newer one may be running.
    if (currentJob === job) {
      currentJob = null
      busy = false
    }
    savedAudio.delete(job.id)
  }
}

// Read the box again after Ctrl+V; a slow app gets one more look before we call it a miss.
async function checkPaste(before: Promise<FocusInfo | null> | null, text: string): Promise<boolean | null> {
  const was = await before
  if (!was) return logPasteCheck(null, null, null), null
  let now = await focusInfo(PASTE_CHECK_CHARS)
  let landed = pasteLanded(was, now, text, platform.notText)
  if (landed === false) {
    await new Promise((r) => setTimeout(r, 400))
    now = await focusInfo(PASTE_CHECK_CHARS)
    landed = pasteLanded(was, now, text, platform.notText)
  }
  logPasteCheck(was, now, landed)
  return landed
}

// userData/paste-check.log: one line per paste with what the check saw (control type,
// window class, whether text was readable), never the text itself. For tuning pasteLanded.
function logPasteCheck(was: FocusInfo | null, now: FocusInfo | null, landed: boolean | null): void {
  const show = (f: FocusInfo | null) =>
    f ? `${f.type ?? '?'}/${f.cls ?? '?'}/${f.text === undefined ? 'no-text' : 'text'}${f.pid === was?.pid ? '' : '/other-app'}` : 'none'
  appendLog('paste-check.log', `${landed === null ? 'unknown' : landed ? 'landed' : 'missed'} before=${show(was)} after=${show(now)}`)
}

// userData/bar.log: times the bar had to be brought back before a dictation, and
// GPU process crashes (a transparent window can stop drawing after one).
const logBar = (what: string) => appendLog('bar.log', what)

// One timestamped line to a log in userData; the file starts over past 64 KB.
function appendLog(name: string, text: string): void {
  const file = join(app.getPath('userData'), name)
  const line = `${new Date().toISOString()} ${text}\n`
  void stat(file)
    .then((st) => (st.size > 64_000 ? writeFile(file, line) : appendFile(file, line)))
    .catch(() => appendFile(file, line))
    .catch((err) => console.warn(`${name} failed`, err))
}

// The 「复制最后的转录」 card: the text in quotes and a 复制 button. It stays
// until closed or the next dictation, and leaves the clipboard alone until asked.
let missedText = ''
function pasteMissedAlert(text: string): void {
  missedText = text
  showAlert({
    id: 'paste-missed',
    title: '复制最后的转录',
    quote: text.replace(/\s+/g, ' ').trim(),
    actions: [{ label: '复制', action: 'copy-last', doneLabel: '已复制' }]
  })
}

// Self-test of Esc while processing (REA_SELFTEST_CANCEL), then 撤销 three seconds later.
let selftestCancelled = false
function selftestCancel(): void {
  selftestCancelled = true
  console.log(`  cancel while processing: ${cancelProcessing() ? 'cancelled' : 'NOT CANCELLED'}`)
  setTimeout(() => (console.log('  undo cancel'), onBarAction('undo-cancel')), 3000)
}

// Esc after stopping: drop the dictation in flight. 撤销 runs it again.
function cancelProcessing(): boolean {
  if (currentJob?.fromHub) return false // a retry from 历史记录 isn't on the bar
  if (currentJob) {
    currentJob.cancelled = true
    cancelledJob = currentJob
    currentJob = null
  } else {
    cancelBeforeJob = true
    cancelledJob = null
  }
  busy = false
  setView({ kind: 'idle' })
  showAlert({ id: 'cancelled', title: '转录已取消', actions: [{ label: '撤销', action: 'undo-cancel' }], autoHideMs: 5000 })
  return true
}

// The floating bar decodes webm for us (the main process has no audio decoder).
const decodeWaiters = new Map<string, (pcm: Float32Array | null) => void>()
function decodeInBar(audio: ArrayBuffer): Promise<Float32Array | null> {
  const reqId = randomUUID()
  return new Promise((resolve) => {
    decodeWaiters.set(reqId, resolve)
    bar.webContents.send(IPC.decodeAudio, reqId, audio)
    setTimeout(() => decodeWaiters.delete(reqId) && resolve(null), 15_000)
  })
}

// 历史记录 → 重试: run a saved recording through recognition again, update the row.
async function retryFromHistory(id: string): Promise<string | null> {
  if (busy) return '仍在处理您的上一个转录'
  const row = getDb().getHistory(id)
  if (!row?.audioPath) return '这条记录的音频已过期（保留 30 天），无法重试'
  const buf = await readFile(row.audioPath).catch(() => null)
  if (!buf) return '找不到这条记录的音频文件'
  const audio = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const pcm = getAsrEngine() === 'local' ? await decodeInBar(audio) : null
  return processRecording({
    id,
    createdAt: row.createdAt,
    audio,
    mimeType: 'audio/webm;codecs=opus',
    pcm,
    ctx: row.appName ? { appName: row.appName, title: row.title ?? '', scene: (row.scene as Scene) ?? 'other' } : null,
    mode: row.mode,
    recordMs: row.durationMs,
    voice: { voicedMs: row.voicedMs ?? 0, peakRms: row.peakRms ?? 0 },
    fromHub: true,
    selection: Promise.resolve(row.selectedText ?? null)
  })
}

const translateChip = (m: DictationMode) => (m === 'translate' ? (getTranslateTarget() ?? undefined) : undefined)

function recordingView(): BarView {
  return {
    kind: 'recording',
    mode,
    handsFree,
    finishKey: shortcutLabel(getShortcuts()[mode]),
    startedAt: recordStartedAt,
    translate: translateChip(mode)
  }
}

const processingView = (m: DictationMode): BarView => ({ kind: 'processing', mode: m, translate: translateChip(m) })

// The card for when translate mode has nowhere to translate to.
function noLanguageAlert(): void {
  showAlert({
    id: 'no-language',
    title: '未选择目标语言',
    description: '在设置中选择目标语言以启用翻译。',
    actions: [{ label: '打开设置', action: 'add-language', primary: true }],
    autoHideMs: 3000
  })
}

// 「"辛禾" 已添加到您的词典」, with 撤销.
function onLearned(words: string[]): void {
  lastLearned = words
  notifyHub('dictionary')
  showAlert({
    id: 'learned',
    title: `"${words.join('、')}" 已添加到您的词典`,
    actions: [{ label: '撤销', action: 'undo-learn' }],
    autoHideMs: 6000
  })
}

function undoLearn(): void {
  const db = getDb()
  db.deleteWords(db.listWords('', 'auto').filter((w) => lastLearned.includes(w.term)).map((w) => w.id))
  lastLearned = []
  notifyHub('dictionary')
}

// 语音输入时静音: mute the speakers once the start cue has played, unless
// they already are muted (then they stay as the user left them).
function scheduleMute(seq: number): void {
  if (!getMuteWhileDictating() || SELFTEST_WAV) return
  const stillRecording = () => seq === recordingSeq && view.kind === 'recording'
  setTimeout(async () => {
    if (!stillRecording() || (await isMuted()) !== false || !stillRecording()) return
    if (!(await setMuted(true))) return
    mutedByUs = true
    setMutedByApp(true) // so a crash cannot leave the speakers muted
    if (!stillRecording()) void restoreAudio() // stopped while we were muting
  }, MUTE_AFTER_MS)
}

async function restoreAudio(): Promise<void> {
  if (!mutedByUs) return
  mutedByUs = false
  setMutedByApp(false)
  await setMuted(false)
}

// The key machine already counts this press as a start: unwind it quietly.
function refuseStart(): void {
  recordStartedAt = Date.now() // short enough that the cancel shows no 「撤销」 card
  setTimeout(() => keys.click('cancel'), 0)
}

// Read the selection while the user starts talking. A card the user clicked
// into would receive the Ctrl+C, so it steps aside first.
function beginAsk(): void {
  if (getCard()?.isFocused()) closeAnswerCard()
  if (SELFTEST_WAV) {
    selection = Promise.resolve(process.env.REA_SELFTEST_SELECTION || null)
    return
  }
  // UI Automation reads the selection without touching the clipboard; apps it
  // cannot read fall back to Ctrl+C.
  selection = focusInfo()
    .then(async (info) => {
      if (info?.selection?.trim()) return info.selection
      const c = await getFocusContext()
      return copySelection(c?.appName ?? null)
    })
    .catch((err) => (console.warn('reading the selection failed', err), null))
}

const keyHandlers: DictationKeyHandlers = {
  isBusy: () => busy,
  onStart: (m) => {
    const problem = SELFTEST_ASR_ONLY ? null : setupProblem()
    if (problem) {
      showAlert({
        id: 'setup',
        title: '还不能开始',
        description: problem,
        actions: [{ label: '打开设置', action: 'open-settings', primary: true }]
      })
      openHub('welcome')
      return refuseStart()
    }
    if (m === 'translate' && !getTranslateTarget()) {
      noLanguageAlert()
      return refuseStart()
    }
    finishTracking(onLearned)
    mode = m
    handsFree = false
    selection = null
    inputBefore = SELFTEST_WAV
      ? Promise.resolve(process.env.REA_SELFTEST_INPUT || null)
      : focusInfo(INPUT_CONTEXT_CHARS).then((info) => info?.before ?? null)
    if (m === 'ask') beginAsk()
    scheduleMute(++recordingSeq)
    recordStartedAt = Date.now()
    warmUpConnections()
    ctx = null
    void getFocusContext().then((c) => (ctx = c))
    bar.webContents.send(IPC.clearAlert, null)
    placeBar(bar)
    const wrong = raiseBar(bar)
    if (wrong.length) logBar(`raised: ${wrong.join(',')}`)
    setView(recordingView())
    bar.webContents.send(IPC.startRecording, {
      wantPcm: getAsrEngine() === 'local',
      sounds: getInteractionSounds(),
      deviceId: getMicrophoneId()
    })
  },
  onModeChange: (m) => {
    if (m === 'translate' && !getTranslateTarget()) {
      noLanguageAlert()
      return keys.click('cancel')
    }
    mode = m
    if (m === 'ask' && !selection) beginAsk()
    setView(recordingView())
  },
  onHandsFree: () => {
    handsFree = true
    setView(recordingView())
  },
  onStop: () => {
    busy = true // until the audio arrives and is processed
    setView(processingView(mode))
    // Sound back on first, so the stop cue is heard.
    const unmuted = Promise.race([restoreAudio(), new Promise((r) => setTimeout(r, STOP_CUE_WAIT_MS))])
    void unmuted.then(() => bar.webContents.send(IPC.stopRecording))
  },
  onCancelProcessing: cancelProcessing,
  onCancel: () => {
    cancelledJob = null
    void restoreAudio()
    bar.webContents.send(IPC.cancelRecording)
    setView({ kind: 'idle' })
    if (Date.now() - recordStartedAt >= UNDO_CANCEL_AFTER_MS)
      showAlert({
        id: 'cancelled',
        title: '转录已取消',
        actions: [{ label: '撤销', action: 'undo-cancel' }],
        autoHideMs: 5000
      })
  },
  onPasteLast: () => {
    const last = getDb().latestOk()
    if (last) void pasteText(last.refinedText || last.rawText)
  }
}
const keys = createDictationKeyMachine(getShortcuts, keyHandlers)
const capture = createShortcutCapture(getShortcuts)

function onBarAction(action: BarActionName): void {
  switch (action) {
    case 'pill-click':
      return keys.click('start')
    case 'finish':
      return keys.click('finish')
    case 'cancel':
      return keys.click('cancel')
    case 'retry':
      if (pending && !busy) void processRecording(pending)
      return
    case 'undo-cancel':
      if (busy) return
      if (cancelledJob) {
        // cancelled while processing: run that dictation again
        const job = { ...cancelledJob, cancelled: false }
        cancelledJob = null
        return void processRecording(job)
      }
      busy = true
      setView(processingView(mode))
      bar.webContents.send(IPC.resendCancelled)
      return
    case 'open-settings':
      return openHub(setupProblem() ? 'welcome' : 'models')
    case 'add-language':
      return openHub('settings')
    case 'undo-learn':
      return undoLearn()
    case 'copy-last':
      return void clipboard.writeText(missedText)
    case 'install-update':
      return installUpdate()
    case 'show-update':
      return openHub('about')
    case 'open-permissions':
      return openHub(setupProblem() ? 'welcome' : 'permissions')
  }
}

function wireIpc(): void {
  ipcMain.on(
    IPC.recordingDone,
    (_e, audio: ArrayBuffer, mimeType: string, voice: VoiceStats, pcm: Float32Array | null) => {
      // Esc came between stopping and the audio arriving: keep it for 撤销, don't process.
      const cancelled = cancelBeforeJob
      cancelBeforeJob = false
      if (cancelled && (!audio.byteLength || voice.voicedMs < MIN_VOICED_MS)) return
      // Empty means the mic never started; its error is already on the bar.
      if (!audio.byteLength) {
        busy = false
        return setView({ kind: 'idle' })
      }
      if (voice.voicedMs < MIN_VOICED_MS) {
        busy = false
        console.info('skipped silent recording', voice)
        setView({ kind: 'idle' })
        return showAlert({ title: '没有检测到语音', description: '未输入任何内容。', autoHideMs: 2500 })
      }
      if (getSaveRecordings()) void saveBenchRecording(audio).catch((err) => console.warn('save recording failed', err))
      const job: Job = {
        id: randomUUID(),
        createdAt: Date.now(),
        audio,
        mimeType,
        pcm,
        ctx,
        mode,
        recordMs: Date.now() - recordStartedAt,
        voice,
        selection: mode === 'ask' ? selection : null,
        inputBefore
      }
      if (cancelled) cancelledJob = job
      else void processRecording(job)
    }
  )
  ipcMain.on(IPC.recordingFailed, (_e, message: string) => {
    void restoreAudio()
    busy = false
    keys.click('cancel')
    setView({ kind: 'error' })
    showAlert({
      id: 'mic',
      title: '麦克风不可用',
      description: `无法访问您的麦克风。可能是其他应用正在使用它，或者访问被系统或安全设置阻止。（${message}）`,
      actions: [{ label: '选择麦克风', action: 'open-settings' }],
      autoHideMs: 8000
    })
  })
  ipcMain.on(IPC.decodedAudio, (_e, reqId: string, pcm: Float32Array | null) => {
    decodeWaiters.get(reqId)?.(pcm)
    decodeWaiters.delete(reqId)
  })
  ipcMain.on(IPC.barAction, (_e, action: BarActionName) => onBarAction(action))
  // 翻译为 chip: switch language, mid-recording or while processing.
  ipcMain.on(IPC.translateTo, (_e, code: string) => {
    setTranslationActive(code)
    if (view.kind === 'recording') setView(recordingView())
    else if (view.kind === 'processing') setView(processingView(view.mode))
  })
  registerCardIpc()
  ipcMain.on(IPC.cardClose, () => closeAnswerCard())
  ipcMain.on(IPC.cardResize, (_e, height: number) => resizeCard(height))
  ipcMain.handle(IPC.copyText, (_e, text: string) => clipboard.writeText(text))
  ipcMain.on(IPC.barInteractive, (_e, interactive: boolean) => setBarInteractive(bar, interactive))
  ipcMain.handle(IPC.getSettings, () => getPublicSettings())
  ipcMain.handle(IPC.saveSettings, async (_e, input) => {
    const retention = getHistoryRetention()
    saveSettings(input)
    nativeTheme.themeSource = getAppearance()
    bar.webContents.send(IPC.showIdleBar, getShowIdleBar())
    if (getAsrEngine() === 'local') void preloadLocalAsr(modelsRoot()).catch(() => {})
    if (getHistoryRetention() !== retention) {
      await pruneHistory()
      notifyHub('history')
    }
    refreshTray()
    notifyHub('settings')
  })
  ipcMain.handle(IPC.testConnection, async (_e, apiKey?: string) => {
    try {
      await checkKey(apiKey?.trim() || getApiKey())
      return { ok: true, message: '连接成功，可以开始使用了' }
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : String(err) }
    }
  })
  ipcMain.handle(IPC.testSiliconflow, async (_e, apiKey?: string) => {
    try {
      await checkSiliconflowKey(apiKey?.trim() || getSiliconflowKey())
      return { ok: true, message: '连接成功，可以开始使用了' }
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : String(err) }
    }
  })
  ipcMain.handle(IPC.testCustom, async (_e, baseUrl: string, apiKey?: string) => {
    const ep = customEndpoint(baseUrl.trim() || undefined, apiKey?.trim() || undefined)
    if (!ep) return { ok: false, message: '请填写服务地址和 API key' }
    try {
      const models = await listModels(ep)
      if (!models) return { ok: true, message: '连接成功。这个服务不提供模型列表，请手动填写模型名', models: [] }
      return { ok: true, message: `连接成功，共 ${models.length} 个模型`, models }
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : String(err) }
    }
  })
  ipcMain.handle(IPC.tryRefine, async (_e, provider: RefineProvider): Promise<TryRefineResult> => {
    const target = refineTarget(provider, TRY_REFINE_SAMPLE.length)
    if (!target) return { ok: false, message: provider === 'custom' ? '先填好服务地址、API key 和模型' : '先填好 Groq API key' }
    const t0 = performance.now()
    try {
      const res = await chatWithFallback([target], buildRefineSystemPrompt(null, '', null, null, getRefineNotes()), TRY_REFINE_SAMPLE, { timeoutMs: 30_000 })
      return { ok: true, message: `${target.model} · ${((performance.now() - t0) / 1000).toFixed(1)} 秒`, output: res.text }
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      // A wrong model name comes back as a 400/404 with the service's own JSON; say it plainly.
      if ((err.status === 400 || err.status === 404) && /model/i.test(err.message))
        return { ok: false, message: `这个服务没有模型「${target.model}」，换一个试试` }
      return { ok: false, message: err.message }
    }
  })
  // Only web links: the page must not be able to launch local files or other protocols.
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
  registerHubIpc({ retry: retryFromHistory, capture })
  ipcMain.handle(HUB.updateState, () => getUpdateState())
  ipcMain.handle(HUB.updateCheck, () => checkForUpdates())
  ipcMain.handle(HUB.updateInstall, () => installUpdate())
  ipcMain.handle(HUB.permissions, () => (isMac ? macPermissions(usesFn(), Boolean(stopKeyHook)) : null))
  ipcMain.handle(HUB.grantPermission, (_e, kind: MacPermission) => isMac && grantMacPermission(kind))
  ipcMain.handle(HUB.relaunch, () => {
    app.relaunch()
    app.quit()
  })
}

const usesFn = () => Object.values(getShortcuts()).some((keys) => keys.includes(VK.Fn))

// ---------- global key hook ----------

let stopKeyHook: (() => void) | null = null
let escClosedCard = false

function onKey(vk: number, down: boolean): boolean {
  // While the settings page records a shortcut, keys go to it instead of dictation.
  if (capture.active) return capture.key(vk, down)
  // Esc closes the answer card (and only that: the app underneath never sees it).
  if (vk === VK.Escape && keys.phase === 'idle') {
    if (down && isCardVisible()) {
      closeAnswerCard()
      return (escClosedCard = true)
    }
    if (!down && escClosedCard) {
      escClosedCard = false
      return true
    }
  }
  return keys.key(vk, down)
}

function installKeyHook(logFailure = true): boolean {
  try {
    stopKeyHook = platform.startKeyboardHook(onKey)
    return true
  } catch (err) {
    if (logFailure) console.error('keyboard hook failed', err)
    return false
  }
}

const NO_ACCESS_ALERT = {
  id: 'permission',
  title: '需要辅助功能权限',
  description: '没有这项权限，快捷键和自动粘贴都用不了。',
  actions: [{ label: '去授权', action: 'open-permissions' as const, primary: true }]
}
const HOOK_STUCK_ALERT = {
  id: 'permission',
  title: '快捷键还没生效',
  description: '辅助功能已开启，还差一步：开启「输入监控」，或重新启动 Saydra。',
  actions: [{ label: '去处理', action: 'open-permissions' as const, primary: true }]
}
const HOOK_STUCK_AFTER = 3 // failed installs (2 s apart) with the permission on

// macOS: the hook needs the Accessibility permission. Install it as soon as that is
// granted, and if it is taken away later (an update can do that) or still won't
// install, say so on the bar instead of the shortcut silently doing nothing.
function watchMacAccess(): void {
  let shown: object | null = null
  let failures = 0
  const warn = (alert: typeof NO_ACCESS_ALERT) => {
    if (shown !== alert) showAlert(alert)
    shown = alert
  }
  const check = () => {
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      stopKeyHook?.()
      stopKeyHook = null
      failures = 0
      return warn(NO_ACCESS_ALERT)
    }
    if (stopKeyHook) return
    if (installKeyHook(failures === 0)) {
      failures = 0
      shown = null
      bar.webContents.send(IPC.clearAlert, NO_ACCESS_ALERT.id)
      notifyHub('settings')
    } else if (++failures >= HOOK_STUCK_AFTER) warn(HOOK_STUCK_ALERT)
  }
  // Starts once the bar can show the card.
  bar.webContents.once('did-finish-load', () => {
    check()
    setInterval(check, 2000)
  })
}

function setUpMacApp(): void {
  app.dock?.hide() // a menu-bar tool (the packaged app also sets LSUIElement)
  // No visible menu bar of our own, but ⌘C / ⌘V / ⌘A in the hub's fields come from these items.
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]))
}

// The bar says so once per run when an update is ready; the hub and the tray always show it.
let updateAnnounced = ''
function onUpdateState(s: UpdateState): void {
  getHub()?.webContents.send(HUB.updateChanged, s)
  refreshTray()
  if (s.kind !== 'ready' || updateAnnounced === s.version) return
  updateAnnounced = s.version
  showAlert({
    id: 'update',
    title: `Saydra ${s.version} 已准备好`,
    description: '重启一下就能用上新版本，设置和历史都会保留。',
    actions: [
      { label: '更新了什么', action: 'show-update' },
      { label: '重启更新', action: 'install-update', primary: true }
    ]
  })
  if (UPDATE_SHOTS) void shootUpdate(UPDATE_SHOTS)
}

async function shootUpdate(dir: string): Promise<void> {
  openHub('about')
  await new Promise((r) => setTimeout(r, 2000))
  const hub = getHub()
  if (hub) await writeFile(join(dir, 'update-about.png'), (await hub.webContents.capturePage()).toPNG())
  await writeFile(join(dir, 'update-bar.png'), (await bar.webContents.capturePage()).toPNG())
  app.exit(0)
}

function refreshTray(): void {
  const update = getUpdateState()
  const key = shortcutLabel(getShortcuts().dictate)
  tray.setToolTip(`Saydra：按一下 ${key} 开始说话，再按一下结束`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 Saydra 主页', click: () => openHub('home') },
      { label: '显示历史记录', click: () => openHub('history') },
      { label: '将词汇添加到词典', click: () => openHub('dictionary') },
      { type: 'separator' },
      { label: '设置...', click: () => openHub('settings') },
      update.kind === 'ready'
        ? { label: `重启以更新到 ${update.version}`, click: () => installUpdate() }
        : { label: `版本 ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: '退出 Saydra', role: 'quit' }
    ])
  )
}

function createTray(): void {
  // macOS: a black glyph the menu bar tints for light and dark (the @2x file is picked up too).
  const file = isMac ? 'trayTemplate.png' : 'tray.png'
  const iconPath = app.isPackaged ? join(process.resourcesPath, file) : join(import.meta.dirname, '../../resources', file)
  tray = new Tray(nativeImage.createFromPath(iconPath))
  refreshTray()
  tray.on('click', () => openHub())
}

// Screenshots of the alert cards (see ALERT_SHOTS): one with an action, one with a
// description, and the action card again after part of its countdown has run.
async function runAlertShots(dir: string): Promise<void> {
  await new Promise<void>((r) => bar.webContents.once('did-finish-load', () => r()))
  await mkdir(dir, { recursive: true })
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const shoot = async (name: string) => {
    const timer = await bar.webContents.executeJavaScript(
      `[...document.querySelectorAll('.alert-timer')].map((el) => getComputedStyle(el).transform).join(' | ')`
    )
    console.log(`  ${name}: timer ${timer || 'none'}`)
    await writeFile(join(dir, `${name}.png`), (await bar.webContents.capturePage()).toPNG())
  }
  await wait(800)
  // 复制最后的转录: one quoted line, 复制 → 已复制 → closes, text on the clipboard
  const said = '明天下午四点在望京开会，记得把上周的用户访谈数据和报价单都带上，顺便通知一下张总。'
  pasteMissedAlert(said)
  await wait(500)
  await shoot('alert-copy-last')
  await bar.webContents.executeJavaScript(`document.querySelector('.btn.small').click()`)
  await wait(150)
  await shoot('alert-copy-last-done')
  await wait(600)
  const open = await bar.webContents.executeJavaScript(`document.querySelectorAll('.alert').length`)
  console.log(`  copy-last: clipboard ${(await clipboard.readText()) === said ? 'has the text' : 'WRONG'}, cards open after click ${open}`)
  onLearned([process.env.REA_ALERT_LEARNED_WORD || 'GPT']) // the word is settable for promo shots
  await wait(500)
  await shoot('alert-learned')
  await wait(3000)
  await shoot('alert-learned-later')
  noLanguageAlert()
  await wait(500)
  await shoot('alert-two')
  // hovering holds the cards past their timeout; leaving restarts the countdown
  const hover = (type: string) =>
    bar.webContents.executeJavaScript(`document.querySelector('.alerts').dispatchEvent(new MouseEvent('${type}'))`)
  await hover('mouseenter')
  await wait(7000)
  await shoot('alert-hover-held')
  await hover('mouseleave')
  await wait(300)
  await shoot('alert-after-leave')
  await wait(6500)
  const left = await bar.webContents.executeJavaScript(`document.querySelectorAll('.alert').length`)
  console.log(`  alerts left 6.5s after leaving: ${left}`)
  app.exit(0)
}

// Self-test of auto-learn and the system helper (see LEARN_TEST).
async function runLearnTest(): Promise<void> {
  const pasted = '我叫新和，这周四和 cloud code 团队开会。'
  const baseline = `会议记录：${pasted}`
  const current = baseline.replace('新和', '辛禾').replace('cloud code', 'Claude Code').replace('开会', '碰个头')
  let t = performance.now()
  const words = await learnFrom(pasted, baseline, current)
  const learnMs = performance.now() - t
  t = performance.now()
  const info = await focusInfo(40)
  const forms = getDb().replacements()
  const ok =
    words.includes('辛禾') &&
    words.includes('Claude Code') &&
    !words.includes('碰个头') &&
    forms.some((r) => r.from === '新和' && r.to === '辛禾') &&
    forms.some((r) => r.from === 'cloud code' && r.to === 'Claude Code')
  console.log(`LEARN TEST ${ok ? 'OK' : 'FAIL'}
  learned: ${JSON.stringify(words)} in ${Math.round(learnMs)}ms
  dictionary auto: ${JSON.stringify(getDb().listWords('', 'auto').map((w) => w.term))}
  常被识别成: ${forms.map((r) => `${r.from}→${r.to}`).join('、') || 'none'}
  helper: ${info ? `focus ${info.type} pid ${info.pid}, before ${JSON.stringify(info.before?.slice(-20) ?? null)}` : 'no readable focus'} (${Math.round(performance.now() - t)}ms)
  speakers muted: ${await isMuted()}`)
  app.exit(ok ? 0 : 1)
}

app.on('before-quit', (e) => {
  if (!mutedByUs) return
  e.preventDefault() // give the speakers back before leaving
  void restoreAudio().finally(() => app.quit())
})
app.on('second-instance', () => openHub())
app.on('window-all-closed', () => {}) // tray app: stay alive without windows

app.whenReady().then(() => {
  if (isMac) setUpMacApp()
  else app.setAppUserModelId('local.xenho.reatypeless')
  // Route model calls through Chromium's network stack so the system proxy applies.
  setFetch(net.fetch as typeof fetch)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
  nativeTheme.themeSource = getAppearance()
  openStore()
  setInterval(() => void pruneHistory().then(() => notifyHub('history')), PRUNE_EVERY_MS)
  startHelper()
  // A crash mid-dictation may have left the speakers muted by us.
  if (getMutedByApp() && !SELFTEST_WAV && !LEARN_TEST) void setMuted(false).then((ok) => ok && setMutedByApp(false))

  // Load the local model in the background so the first dictation does not wait.
  if (getAsrEngine() === 'local')
    void preloadLocalAsr(modelsRoot()).catch((err) => console.warn('local ASR unavailable', err))
  bar = createFloatingBar()
  app.on('child-process-gone', (_e, d) => d.type === 'GPU' && logBar(`gpu process gone: ${d.reason}`))
  wireIpc()
  createTray()
  if (HUB_SHOTS) return void runHubShots(getDb(), HUB_SHOTS).catch((err) => (console.error(err), app.exit(1)))
  if (LEARN_TEST) return void runLearnTest().catch((err) => (console.error(err), app.exit(1)))
  if (ALERT_SHOTS) return void runAlertShots(ALERT_SHOTS).catch((err) => (console.error(err), app.exit(1)))
  if (!SELFTEST_WAV) startUpdater({ enabled: getAutoUpdate, onChange: onUpdateState, log: (line) => appendLog('update.log', line) })

  if (SELFTEST_WAV) {
    const seconds = Number(process.env.REA_SELFTEST_SECONDS) || 6
    // REA_SELFTEST_SHOTS=<dir> also saves screenshots of the bar for visual checks.
    const shots = process.env.REA_SELFTEST_SHOTS
    const shoot = (name: string) =>
      shots &&
      void bar.webContents
        .capturePage()
        .then((img) => writeFile(join(shots, `${name}.png`), img.toPNG()))
        .catch((err) => console.warn('screenshot failed', err))
    bar.webContents.once('did-finish-load', async () => {
      // The page subscribes to IPC in an effect, a moment after load.
      await new Promise((r) => setTimeout(r, 500))
      // macOS: load every CoreGraphics binding and ask the helper, so a broken
      // native call shows up on the build machine and not first on a tester's Mac.
      if (isMac) {
        console.log(`  mac permissions: ${JSON.stringify(await macPermissions(usesFn(), false))}`)
        console.log(`  mac front app: ${JSON.stringify(await platform.frontApp())}`)
      }
      const m = (process.env.REA_SELFTEST_MODE as DictationMode) || 'dictate'
      keyHandlers.onStart(m)
      setTimeout(() => shoot('1-recording'), 2000)
      setTimeout(() => keyHandlers.onHandsFree(), 3000)
      setTimeout(() => shoot('2-hands-free'), 3600)
      setTimeout(() => {
        keyHandlers.onStop()
        setTimeout(() => shoot('3-refining'), 400)
        // REA_SELFTEST_CANCEL=early: Esc right after stopping, before the audio arrives
        if (process.env.REA_SELFTEST_CANCEL === 'early') selftestCancel()
      }, seconds * 1000)
    })
    setTimeout(() => {
      console.log('SELFTEST FAIL: timed out')
      app.exit(1)
    }, 90_000)
    return
  }

  if (isMac) watchMacAccess()
  else if (!installKeyHook())
    bar.webContents.once('did-finish-load', () =>
      showAlert({ id: 'hook', title: '快捷键不可用', description: '无法安装全局键盘监听，请重启 Saydra。' })
    )
  setInterval(() => keys.timeout(), 1000)
  if (setupProblem()) openHub('welcome')
  else if (isMac && !systemPreferences.isTrustedAccessibilityClient(false)) openHub('permissions')
  else if (!isHiddenLaunch()) openHub()
})
