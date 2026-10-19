// In-app updates from the public GitHub releases (latest.yml next to the installer).
// Windows downloads in the background and installs on restart or quit. The macOS build
// is only ad-hoc signed, which the updater can't swap in, so there it links to the release.
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/hub'

const { autoUpdater } = electronUpdater

export const RELEASES_URL = 'https://github.com/PPory/saydra/releases/latest'
const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const RETRY_AFTER_ERROR_MS = 30 * 60 * 1000
const canInstall = process.platform === 'win32'

let state: UpdateState = { kind: 'idle' }
let started = false
let onChange: (s: UpdateState) => void = () => {}
let retryTimer: ReturnType<typeof setTimeout> | undefined

function set(next: UpdateState): void {
  if (process.env.REA_UPDATE_URL) console.log('update:', JSON.stringify(next))
  state = next
  onChange(next)
}

export const getUpdateState = (): UpdateState => state

// REA_UPDATE_URL points a packaged build at a local folder holding latest.yml, for testing.
export function startUpdater(opts: {
  enabled: () => boolean
  onChange: (s: UpdateState) => void
  log: (line: string) => void
}): void {
  const testUrl = process.env.REA_UPDATE_URL
  if (!app.isPackaged && !testUrl) return
  started = true
  onChange = opts.onChange
  if (testUrl) autoUpdater.setFeedURL({ provider: 'generic', url: testUrl })
  autoUpdater.autoDownload = canInstall
  // A test run must never install its build over the real one.
  autoUpdater.autoInstallOnAppQuit = canInstall && !testUrl
  autoUpdater.logger = null

  autoUpdater.on('update-available', (info) =>
    set(canInstall ? { kind: 'downloading', version: info.version, percent: 0 } : { kind: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', () => set({ kind: 'latest' }))
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.floor(p.percent)
    if (state.kind === 'downloading' && percent !== state.percent) set({ ...state, percent })
  })
  autoUpdater.on('update-downloaded', (info) => set({ kind: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => {
    opts.log(`${state.kind}: ${String(err?.message ?? err).split('\n')[0].slice(0, 300)}`)
    set({ kind: 'error', message: errorMessage(err, state.kind === 'downloading') })
    // Often a passing network hiccup, or a release still being uploaded: try again soon.
    clearTimeout(retryTimer)
    retryTimer = setTimeout(scheduled, RETRY_AFTER_ERROR_MS)
  })

  const scheduled = () => opts.enabled() && void checkForUpdates()
  setTimeout(scheduled, FIRST_CHECK_MS)
  setInterval(scheduled, CHECK_EVERY_MS)
}

// Only a failed connection is a network problem; a 404 or a release without
// latest.yml (still uploading, or published by hand) is not the user's to fix.
function errorMessage(err: unknown, downloading: boolean): string {
  const text = String((err as Error)?.message ?? err)
  if (/net::ERR_|ETIMEDOUT|ECONNRESET|ENOTFOUND|socket hang up/i.test(text))
    return downloading ? '下载中断了，网络连不上 GitHub，稍后会自动再试' : '连不上 GitHub，检查网络或代理后点「重试」'
  return downloading ? '下载没有完成，稍后会自动再试' : '暂时查不到新版本信息，稍后会自动再查'
}

export async function checkForUpdates(): Promise<void> {
  if (!started || ['checking', 'downloading', 'ready'].includes(state.kind)) return
  set({ kind: 'checking' })
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // reported through the 'error' event
  }
}

// Silent install, then start the new version. Goes through app.quit, so the
// before-quit handler still gives the speakers back first.
export function installUpdate(): void {
  if (state.kind === 'ready') autoUpdater.quitAndInstall(true, true)
}
