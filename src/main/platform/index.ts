// What differs between Windows and macOS sits behind this one interface; the rest
// of the app talks to it and never checks the OS itself. The system helper
// (input box reading, speaker mute) shares one protocol on both, see helper.ts.
import type { FocusInfo } from './helper'
import { mac } from './mac'
import { win } from './win'

// Gets Windows virtual-key codes on both systems (see shared/keys.ts).
// Return true to swallow the event.
export type KeyListener = (vk: number, down: boolean) => boolean

export interface FrontApp {
  appName: string // WeChat.exe on Windows, WeChat.app on macOS
  title: string
}

export interface Platform {
  // Global key hook that can swallow keys. Throws when it cannot be installed.
  startKeyboardHook(listener: KeyListener): () => void
  // Ctrl+C / Ctrl+V on Windows, ⌘C / ⌘V on macOS, to the app in front.
  pressCopy(): void
  pressPaste(): void
  // Copying there with nothing selected interrupts the running program (terminals).
  copyInterrupts(appName: string): boolean
  // Editors that copy the caret's whole line when nothing is selected.
  copiesLine(appName: string): boolean
  // Focus is on something text cannot go into (see paste-check.ts).
  notText(f: FocusInfo): boolean
  frontApp(): Promise<FrontApp | null>
  // Clipboard formats that tell clipboard history, cloud sync and clipboard managers
  // to skip this content (see paste.ts).
  transientFormats: string[]
  // Whether the window really lets clicks through right now, read from the system
  // (see watchBarPointer); null where that can't be read.
  clicksPassThrough(handle: Buffer): boolean | null
}

export const isMac = process.platform === 'darwin'
export const platform: Platform = isMac ? mac : win
