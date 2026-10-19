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

// The text is on the clipboard for a fraction of a second, and the restored content
// was recorded when the user copied it: both are marked so clipboard history
// (Win+V), cloud sync and clipboard managers don't log every dictation or a duplicate.
const transient = (): Record<string, Blob> =>
  Object.fromEntries(
    platform.transientFormats.map((f) => [`electron application/osclipboard;format="${f}"`, new Blob([new Uint8Array(4)])])
  )

async function writeTransientText(text: string): Promise<void> {
  try {
    await clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), ...transient() })])
  } catch (err) {
    console.warn('transient clipboard write failed', err)
    await clipboard.writeText(text)
  }
}

// OLE's bookkeeping for the copy we replaced: it points at a data object that is gone,
// and makes OLE readers list only the original formats (not our transient marks).
const STALE = /format="(DataObject|Ole Private Data)"/

async function restore(snap: Snapshot): Promise<void> {
  const entries = snap
    .map((e) => Object.fromEntries(Object.entries(e).filter(([type]) => !STALE.test(type))))
    .filter((e) => Object.keys(e).length)
  if (!entries.length) return clipboard.clear()
  try {
    await clipboard.write(entries.map((e, i) => new ClipboardItem({ ...(i ? {} : transient()), ...(e as Record<string, Blob>) })))
  } catch {
    await clipboard.write(entries.map((e) => new ClipboardItem(e as Record<string, Blob>)))
  }
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
  await writeTransientText(text)
  await sleep(30)
  platform.pressPaste()
  // Give the target app time to read the clipboard before restoring it.
  await sleep(300)
  const ok = landed ? await landed().catch(() => null) : null
  if ((await clipboard.readText()) !== text) return ok // user copied something meanwhile; keep theirs
  await restore(backup).catch((err) => console.warn('clipboard restore failed', err))
  return ok
}
