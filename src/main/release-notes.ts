// What a new version changes, as plain lines for the hub. The updater hands over the
// release body as HTML (one string, or one per version when several are skipped).
// Only list items are kept: the paragraph after them is download instructions,
// which mean nothing inside the app. No Electron imports.

type Notes = string | { version: string; note: string | null }[] | null | undefined

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }

const toText = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim()

function lines(html: string): string[] {
  const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => toText(m[1]))
  if (items.length) return items.filter(Boolean)
  return html
    .split(/<\/p>|<br\s*\/?>|\n/i)
    .map(toText)
    .filter(Boolean)
}

// The same from our own markdown notes: the "- " items, without bold, links or code marks.
export function markdownNoteLines(md: string, max = 8): string[] {
  return md
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*] /.test(l))
    .map((l) =>
      l
        .replace(/^\s*[-*] /, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim()
    )
    .filter(Boolean)
    .slice(0, max)
}

export function releaseNoteLines(notes: Notes, max = 8): string[] {
  if (!notes) return []
  const all = typeof notes === 'string' ? lines(notes) : notes.flatMap((n) => (n.note ? lines(n.note) : []))
  return all.slice(0, max)
}
