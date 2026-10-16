// Client for helpers/win-helper.ps1: UI Automation (focused input box text,
// selection, text before the caret) and the system output mute. Best effort:
// every call resolves to null when the helper is missing, slow or failing, so
// dictation never waits on it or breaks because of it.
import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export interface FocusInfo {
  pid?: number
  type?: string // UIA control type, e.g. Edit, Document
  cls?: string // window class name, e.g. SysListView32 for the desktop icons
  password?: boolean
  text?: string // whole content, capped at 20 000 characters
  selection?: string
  before?: string // text before the caret
}

const scriptPath = () =>
  app.isPackaged ? join(process.resourcesPath, 'win-helper.ps1') : join(app.getAppPath(), 'src/main/helpers/win-helper.ps1')

const DEFAULT_TIMEOUT_MS = 1500
const MAX_TIMEOUTS = 2 // then the helper is presumed stuck (e.g. a hung app) and restarted

let proc: ChildProcessWithoutNullStreams | null = null
let ready: Promise<boolean> | null = null
let nextId = 1
let timeouts = 0
const waiting = new Map<number, (res: Record<string, any> | null) => void>()

function start(): Promise<boolean> {
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath()],
    { windowsHide: true }
  )
  proc = child
  child.stdin.setDefaultEncoding('utf8')
  child.stderr.on('data', (d) => console.warn('win-helper:', String(d).trim()))
  const lines = createInterface({ input: child.stdout })
  const isReady = new Promise<boolean>((resolve) => {
    const giveUp = setTimeout(() => resolve(false), 15_000)
    lines.on('line', (line) => {
      let msg: Record<string, any>
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.ready) {
        clearTimeout(giveUp)
        return resolve(true)
      }
      waiting.get(msg.id)?.(msg.ok ? msg : null)
      waiting.delete(msg.id)
    })
    child.on('exit', () => {
      clearTimeout(giveUp)
      resolve(false)
    })
  })
  child.on('exit', (code) => {
    if (proc === child) {
      proc = null
      ready = null
    }
    for (const done of waiting.values()) done(null)
    waiting.clear()
    if (code) console.warn(`win-helper exited with ${code}`)
  })
  child.on('error', (err) => console.warn('win-helper unavailable', err))
  return isReady
}

// Spawning PowerShell and compiling the helper takes ~1.5 s, so do it early.
export function startWinHelper(): void {
  if (process.platform === 'win32' && !ready) ready = start()
}

async function call(cmd: string, args: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Record<string, any> | null> {
  startWinHelper()
  if (!ready || !(await ready) || !proc) return null
  const id = nextId++
  const child = proc
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      resolve(null)
      if (++timeouts >= MAX_TIMEOUTS) {
        timeouts = 0
        console.warn('win-helper stuck, restarting')
        child.kill()
      }
    }, timeoutMs)
    waiting.set(id, (res) => {
      clearTimeout(timer)
      timeouts = 0
      resolve(res)
    })
    child.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`)
  })
}

// Our own windows (hub, answer card) and password boxes are never read.
const usable = (res: Record<string, any> | null): FocusInfo | null =>
  res && !res.password && res.pid !== process.pid ? (res as FocusInfo) : null

// The focused input box. `before`: how much text before the caret to include.
export const focusInfo = async (before = 0): Promise<FocusInfo | null> => usable(await call('focus', { before }))

// Like focusInfo, and remember this box so watchedInfo can read it later.
export const watchFocus = async (): Promise<FocusInfo | null> => usable(await call('watch'))
export const watchedInfo = async (): Promise<FocusInfo | null> => usable(await call('watched'))

export const isMuted = async (): Promise<boolean | null> => {
  const res = await call('muted')
  return res ? Boolean(res.muted) : null
}
export const setMuted = async (mute: boolean): Promise<boolean> => Boolean(await call(mute ? 'mute' : 'unmute'))

export function stopWinHelper(): void {
  proc?.stdin.end()
  proc = null
  ready = null
}
