import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type BarActionName,
  type BarAlert,
  type AnswerPayload,
  type BarView,
  type PublicSettings,
  type RecordingRequest,
  type SettingsInput,
  type TestResult,
  type TryRefineResult,
  type RefineProvider,
  type VoiceStats
} from '../shared/types'
import {
  HUB,
  type AppInfo,
  type CaptureResult,
  type DictSource,
  type DictWord,
  type HistoryItem,
  type HistoryTab,
  type HomeStats,
  type HubChange,
  type HubRoute,
  type MacPermission,
  type MacPermissions,
  type ShortcutTarget,
  type UpdateState
} from '../shared/hub'

type Result = { ok: boolean; message: string }

const on = (channel: string, cb: (...args: any[]) => void) => {
  ipcRenderer.on(channel, (_e, ...args) => cb(...args))
}

const api = {
  // floating bar
  onStartRecording: (cb: (req: RecordingRequest) => void) => on(IPC.startRecording, cb),
  onStopRecording: (cb: () => void) => on(IPC.stopRecording, cb),
  onCancelRecording: (cb: () => void) => on(IPC.cancelRecording, cb),
  onResendCancelled: (cb: () => void) => on(IPC.resendCancelled, cb),
  onView: (cb: (view: BarView) => void) => on(IPC.setView, cb),
  onAlert: (cb: (alert: BarAlert) => void) => on(IPC.showAlert, cb),
  onClearAlert: (cb: (id: string | null) => void) => on(IPC.clearAlert, cb),
  sendRecording: (audio: ArrayBuffer, mimeType: string, voice: VoiceStats, pcm: Float32Array | null) =>
    ipcRenderer.send(IPC.recordingDone, audio, mimeType, voice, pcm),
  sendRecordingFailed: (message: string) => ipcRenderer.send(IPC.recordingFailed, message),
  sendAction: (action: BarActionName) => ipcRenderer.send(IPC.barAction, action),
  setInteractive: (interactive: boolean) => ipcRenderer.send(IPC.barInteractive, interactive),
  setHitRects: (rects: number[][]) => ipcRenderer.send(IPC.barHitRects, rects),
  onDecodeAudio: (cb: (reqId: string, audio: ArrayBuffer) => void) => on(IPC.decodeAudio, cb),
  sendDecoded: (reqId: string, pcm: Float32Array | null) => ipcRenderer.send(IPC.decodedAudio, reqId, pcm),
  translateTo: (code: string) => ipcRenderer.send(IPC.translateTo, code),
  onShowIdleBar: (cb: (show: boolean) => void) => on(IPC.showIdleBar, cb),
  // answer card
  onCardShow: (cb: (payload: AnswerPayload) => void) => on(IPC.cardShow, cb),
  cardPayload: (): Promise<AnswerPayload | null> => ipcRenderer.invoke(IPC.cardPayload),
  closeCard: () => ipcRenderer.send(IPC.cardClose),
  resizeCard: (height: number) => ipcRenderer.send(IPC.cardResize, height),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke(IPC.copyText, text),
  // settings
  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (input: SettingsInput): Promise<void> => ipcRenderer.invoke(IPC.saveSettings, input),
  testConnection: (apiKey?: string): Promise<TestResult> => ipcRenderer.invoke(IPC.testConnection, apiKey),
  testCustom: (baseUrl: string, apiKey?: string): Promise<TestResult> =>
    ipcRenderer.invoke(IPC.testCustom, baseUrl, apiKey),
  testSiliconflow: (apiKey?: string): Promise<TestResult> => ipcRenderer.invoke(IPC.testSiliconflow, apiKey),
  tryRefine: (provider: RefineProvider): Promise<TryRefineResult> => ipcRenderer.invoke(IPC.tryRefine, provider),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  // hub
  onHubChanged: (cb: (change: HubChange) => void) => on(HUB.changed, cb),
  onNavigate: (cb: (route: HubRoute) => void) => on(HUB.navigate, cb),
  stats: (): Promise<HomeStats> => ipcRenderer.invoke(HUB.stats),
  historyList: (tab: HistoryTab, offset: number, limit: number): Promise<HistoryItem[]> =>
    ipcRenderer.invoke(HUB.historyList, tab, offset, limit),
  historyDelete: (id: string): Promise<void> => ipcRenderer.invoke(HUB.historyDelete, id),
  historyDeleteAll: (): Promise<void> => ipcRenderer.invoke(HUB.historyDeleteAll),
  historyRetry: (id: string): Promise<string | null> => ipcRenderer.invoke(HUB.historyRetry, id),
  historySaveAudio: (id: string): Promise<Result> => ipcRenderer.invoke(HUB.historySaveAudio, id),
  historyAnswer: (id: string): Promise<void> => ipcRenderer.invoke(HUB.historyAnswer, id),
  dictList: (query: string, source: DictSource | null): Promise<DictWord[]> =>
    ipcRenderer.invoke(HUB.dictList, query, source),
  dictAdd: (term: string, heardAs: string[]): Promise<Result> => ipcRenderer.invoke(HUB.dictAdd, term, heardAs),
  dictUpdate: (id: number, term: string, heardAs: string[]): Promise<Result> =>
    ipcRenderer.invoke(HUB.dictUpdate, id, term, heardAs),
  dictDelete: (ids: number[]): Promise<number> => ipcRenderer.invoke(HUB.dictDelete, ids),
  dictImport: (): Promise<Result> => ipcRenderer.invoke(HUB.dictImport),
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(HUB.appInfo),
  openDataDir: (): Promise<void> => ipcRenderer.invoke(HUB.openDataDir),
  captureShortcut: (target: ShortcutTarget): Promise<CaptureResult> => ipcRenderer.invoke(HUB.captureShortcut, target),
  cancelCapture: (): Promise<void> => ipcRenderer.invoke(HUB.cancelCapture),
  permissions: (): Promise<MacPermissions | null> => ipcRenderer.invoke(HUB.permissions),
  grantPermission: (kind: MacPermission): Promise<void> => ipcRenderer.invoke(HUB.grantPermission, kind),
  relaunch: (): Promise<void> => ipcRenderer.invoke(HUB.relaunch),
  updateState: (): Promise<UpdateState> => ipcRenderer.invoke(HUB.updateState),
  updateCheck: (): Promise<void> => ipcRenderer.invoke(HUB.updateCheck),
  updateInstall: (): Promise<void> => ipcRenderer.invoke(HUB.updateInstall),
  onUpdateChanged: (cb: (s: UpdateState) => void) => on(HUB.updateChanged, cb),
}

export type ReaApi = typeof api

contextBridge.exposeInMainWorld('rea', api)
