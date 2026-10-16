// Just enough Markdown for model answers: headings, paragraphs, lists, quotes,
// fenced code, tables, bold / italic / inline code / links. Everything is
// escaped first, so model output can never inject HTML into the card.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(text: string): string {
  const codes: string[] = []
  let s = esc(text).replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(c) - 1}\u0000`)
  s = s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // Links show their text; the card has no browser to open them in.
    .replace(/\[([^\]]+)\]\((?:[^)\s]+)\)/g, '<u>$1</u>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`)
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`)
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*```(\w*)/.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i])
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = Math.min(heading[1].length, 3)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush()
      out.push('<hr>')
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const quote: string[] = []
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''))
      i--
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`)
      continue
    }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush()
      const head = cells(line)
      const rows: string[][] = []
      for (i += 2; i < lines.length && isTableRow(lines[i]); i++) rows.push(cells(lines[i]))
      i--
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      )
      continue
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      flush()
      const ordered = /\d/.test(item[2])
      const items: string[] = []
      for (; i < lines.length; i++) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (m) items.push(inline(m[3]))
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += `<br>${inline(lines[i].trim())}`
        else break
      }
      i--
      const start = ordered ? Number.parseInt(item[2], 10) : 1
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${items.map((x) => `<li>${x}</li>`).join('')}</${tag}>`)
      continue
    }
    if (!line.trim()) flush()
    else para.push(line)
  }
  flush()
  return out.join('')
}
