import type { FocusContext } from '../shared/types'
import { platform } from './platform'
import { detectScene } from './prompts'

// Snapshot of the window the user is dictating into, taken at key press.
export async function getFocusContext(): Promise<FocusContext | null> {
  try {
    const front = await platform.frontApp()
    if (!front) return null
    return { ...front, scene: detectScene(front.appName, front.title) }
  } catch {
    return null
  }
}
