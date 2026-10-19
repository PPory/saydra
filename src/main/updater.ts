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
const canInstall = process.platform === 'win32'

let state: UpdateState = { kind: 'idle' }
let started = false
let onChange: (s: UpdateState) => void = () => {}

function set(next: UpdateState): void {
  if (process.env.REA_UPDATE_URL) console.log('update:', JSON.stringify(next))
  state = next
  onChange(next)
}

export const getUpdateState = (): UpdateState => state

// REA_UPDATE_URL points a packaged build at a local folder holding latest.yml, for testing.
export function startUpdater(opts: { enabled: () => boolean; onChange: (s: UpdateState) => void }): void {
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
    console.warn('update failed', err)
    // GitHub is often unreachable without a proxy here; say so and offer the download page.
    set({
      kind: 'error',
      message: state.kind === 'downloading' ? '自动下载失败，可能是网络连不上 GitHub' : '检查更新失败，可能是网络连不上 GitHub'
    })
  })

  const scheduled = () => opts.enabled() && void checkForUpdates()
  setTimeout(scheduled, FIRST_CHECK_MS)
  setInterval(scheduled, CHECK_EVERY_MS)
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
