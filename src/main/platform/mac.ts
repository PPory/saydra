// macOS: CGEventTap key hook, ⌘C / ⌘V posted through CoreGraphics, apps told apart
// by bundle name, the front app read by the helper. Plus the permissions macOS asks
// the user for, which the welcome guide walks through.
import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { shell, systemPreferences } from 'electron'
import type { Platform } from '.'
import type { MacPermission, MacPermissions } from '../../shared/hub'
import { call } from './helper'
import { hasInputMonitoring, pressCommand, requestInputMonitoring, startKeyboardHook } from './mac-keyboard'

const KEY_C = 8
const KEY_V = 9

// These copy the whole current line when nothing is selected.
const LINE_COPIERS = /^(visual studio code|code|cursor|windsurf|sublime text|intellij idea.*|pycharm.*|webstorm.*|zed)\.app$/i

export const mac: Platform = {
  startKeyboardHook,
  pressCopy: () => pressCommand(KEY_C),
  pressPaste: () => pressCommand(KEY_V),
  // Copying is ⌘C, which never interrupts a program: terminals need no exception.
  copyInterrupts: () => false,
  copiesLine: (appName) => LINE_COPIERS.test(appName),
  // No rules yet: only an unchanged box counts as a missed paste (see paste-check.ts).
  notText: () => false,
  // From the helper rather than get-windows, which would ask for Screen Recording
  // to read window titles (the helper reads them through Accessibility).
  async frontApp() {
    const res = await call('front')
    if (!res?.path && !res?.name) return null
    return { appName: res.path ? basename(res.path) : `${res.name}.app`, title: res.title ?? '' }
  }
}

// ---------- permissions ----------

const SETTINGS_URL: Record<MacPermission, string> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  inputMonitoring: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  fnKey: 'x-apple.systempreferences:com.apple.preference.keyboard'
}

const run = promisify(execFile)

// 「按下 🌐 键时」 in Keyboard settings: 0 is 「不执行任何操作」. Unset means the system
// default, which does something (emoji picker or input source), so it counts as not set.
async function fnKeyFree(): Promise<boolean> {
  try {
    const { stdout } = await run('defaults', ['read', 'com.apple.HIToolbox', 'AppleFnUsageType'])
    return stdout.trim() === '0'
  } catch {
    return false
  }
}

const safe = (read: () => boolean): boolean => {
  try {
    return read()
  } catch (err) {
    console.warn('permission check failed', err)
    return false
  }
}

export async function macPermissions(usesFn: boolean, hookActive: boolean): Promise<MacPermissions> {
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone') === 'granted',
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    inputMonitoring: safe(hasInputMonitoring),
    fnKey: usesFn ? await fnKeyFree() : null,
    hookActive
  }
}

// Ask where macOS has a prompt of its own (it also puts Saydra in the list), then
// open the page in System Settings where the switch is.
export async function grantMacPermission(kind: MacPermission): Promise<void> {
  if (kind === 'microphone' && systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') {
    if (await systemPreferences.askForMediaAccess('microphone')) return
  }
  if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true)
  if (kind === 'inputMonitoring') safe(requestInputMonitoring)
  await shell.openExternal(SETTINGS_URL[kind])
}
