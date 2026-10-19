/// <reference types="vite/client" />
// Each version's release notes (docs/release/notes-<version>.md), built into the app so
// the 关于 page can say what the running version changed, however it got installed.
import { markdownNoteLines } from './release-notes'

const files = import.meta.glob('../../docs/release/notes-*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

export function bundledNotes(version: string): string[] {
  const md = files[`../../docs/release/notes-${version}.md`]
  return md ? markdownNoteLines(md) : []
}
