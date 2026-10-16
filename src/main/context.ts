import { basename } from 'node:path'
import { activeWindow } from 'get-windows'
import type { FocusContext } from '../shared/types'
import { detectScene } from './prompts'

// Snapshot of the window the user is dictating into, taken at key press.
export async function getFocusContext(): Promise<FocusContext | null> {
  try {
    const win = await activeWindow()
    if (!win) return null
    const appName = basename(win.owner.path || win.owner.name || '')
    return { appName, title: win.title, scene: detectScene(appName, win.title) }
  } catch {
    return null
  }
}
