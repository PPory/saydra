import { clipboard, ClipboardItem } from 'electron'
import { platform } from './platform'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Snapshot = Array<Record<string, Blob | Electron.ClipboardBookmark>>

// Read every format eagerly: getType() is lazy and would return our text once
// the clipboard has been overwritten.
async function snapshot(): Promise<Snapshot> {
  try {
    const items = await clipboard.read()
    return await Promise.all(
      items.map(async (item) => {
        const entry: Snapshot[number] = {}
        for (const type of item.types) entry[type] = await item.getType(type)
        return entry
      })
    )
  } catch {
    return []
  }
}

async function restore(snap: Snapshot): Promise<void> {
  const items = snap.filter((e) => Object.keys(e).length).map((e) => new ClipboardItem(e as Record<string, Blob>))
  if (items.length) await clipboard.write(items)
  else clipboard.clear()
}

const COPY_WAIT_MS = 400

// The text selected in the app in front, via Ctrl+C and the clipboard (which is
// put back afterwards); null when nothing is selected.
export async function copySelection(appName: string | null): Promise<string | null> {
  if (appName && platform.copyInterrupts(appName)) return null
  const backup = await snapshot()
  clipboard.clear()
  platform.pressCopy()
  let text = ''
  for (let waited = 0; waited < COPY_WAIT_MS && !text; waited += 25) {
    await sleep(25)
    text = await clipboard.readText()
  }
  await restore(backup).catch((err) => console.warn('clipboard restore failed', err))
  if (!text.trim()) return null
  // A single line ending in a line break is an editor copying the caret's line, not a selection.
  if (appName && platform.copiesLine(appName) && /^[^\n]*\r?\n$/.test(text)) return null
  return text
}

// Paste via clipboard + Ctrl+V, then put the user's clipboard back. `landed` checks
// whether the paste went anywhere (null: not checked or can't tell); the caller
// offers 复制 when it didn't. The clipboard is restored either way.
export async function pasteText(text: string, landed?: () => Promise<boolean | null>): Promise<boolean | null> {
  const backup = await snapshot()
  await clipboard.writeText(text)
  await sleep(30)
  platform.pressPaste()
  // Give the target app time to read the clipboard before restoring it.
  await sleep(300)
  const ok = landed ? await landed().catch(() => null) : null
  if ((await clipboard.readText()) !== text) return ok // user copied something meanwhile; keep theirs
  await restore(backup).catch((err) => console.warn('clipboard restore failed', err))
  return ok
}
