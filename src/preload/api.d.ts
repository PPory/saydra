import type {
  AppInfo,
  CaptureResult,
  DictSource,
  DictWord,
  HistoryItem,
  HistoryTab,
  HomeStats,
  HubChange,
  HubRoute,
  MacPermission,
  MacPermissions,
  ShortcutTarget
} from '../shared/hub'
import type {
  AnswerPayload,
  BarActionName,
  RefineProvider,
  TryRefineResult,
  BarAlert,
  BarView,
  PublicSettings,
  RecordingRequest,
  SettingsInput,
  TestResult,
  VoiceStats
} from '../shared/types'

type Result = { ok: boolean; message: string }

declare global {
  interface Window {
    rea: {
      // floating bar
      onStartRecording(cb: (req: RecordingRequest) => void): void
      onStopRecording(cb: () => void): void
      onCancelRecording(cb: () => void): void
      onResendCancelled(cb: () => void): void
      onView(cb: (view: BarView) => void): void
      onAlert(cb: (alert: BarAlert) => void): void
      onClearAlert(cb: (id: string | null) => void): void
      onShowIdleBar(cb: (show: boolean) => void): void
      sendRecording(audio: ArrayBuffer, mimeType: string, voice: VoiceStats, pcm: Float32Array | null): void
      sendRecordingFailed(message: string): void
      sendAction(action: BarActionName): void
      setInteractive(interactive: boolean): void
      onDecodeAudio(cb: (reqId: string, audio: ArrayBuffer) => void): void
      sendDecoded(reqId: string, pcm: Float32Array | null): void
      translateTo(code: string): void
      // answer card
      onCardShow(cb: (payload: AnswerPayload) => void): void
      cardPayload(): Promise<AnswerPayload | null>
      closeCard(): void
      resizeCard(height: number): void
      copyText(text: string): Promise<void>
      // settings
      getSettings(): Promise<PublicSettings>
      saveSettings(input: SettingsInput): Promise<void>
      testConnection(apiKey?: string): Promise<TestResult>
      testCustom(baseUrl: string, apiKey?: string): Promise<TestResult>
      tryRefine(provider: RefineProvider): Promise<TryRefineResult>
      openExternal(url: string): Promise<void>
      // hub
      onHubChanged(cb: (change: HubChange) => void): void
      onNavigate(cb: (route: HubRoute) => void): void
      stats(): Promise<HomeStats>
      historyList(tab: HistoryTab, offset: number, limit: number): Promise<HistoryItem[]>
      historyDelete(id: string): Promise<void>
      historyDeleteAll(): Promise<void>
      historyRetry(id: string): Promise<string | null>
      historySaveAudio(id: string): Promise<Result>
      historyAnswer(id: string): Promise<void>
      dictList(query: string, source: DictSource | null): Promise<DictWord[]>
      dictAdd(term: string, heardAs: string[]): Promise<Result>
      dictUpdate(id: number, term: string, heardAs: string[]): Promise<Result>
      dictDelete(ids: number[]): Promise<number>
      dictImport(): Promise<Result>
      appInfo(): Promise<AppInfo>
      openDataDir(): Promise<void>
      captureShortcut(target: ShortcutTarget): Promise<CaptureResult>
      cancelCapture(): Promise<void>
      permissions(): Promise<MacPermissions | null>
      grantPermission(kind: MacPermission): Promise<void>
      relaunch(): Promise<void>
    }
  }
}

export {}
