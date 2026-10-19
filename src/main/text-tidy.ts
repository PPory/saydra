// Small, deterministic checks around the refine model: things code can decide
// for sure are not left to the prompt.
import type { Scene } from '../shared/types'

// Sounds that carry nothing to type. Hesitations never do; acknowledgements
// (「嗯嗯」「哦」) are a whole reply in a chat app, so there they are kept.
const HESITATION = /^(?:[呃额唔]|um+|uh+|er+|hm+|mm+)+$/i
const INTERJECTION = /^(?:[嗯啊呃哦噢喔唔额诶欸哎唉呀恩昂]|um+|uh+|er+|hm+|mm+|ah+|oh+)+$/i

// The whole transcript is filler (「嗯……啊」), so there is nothing to paste and no
// reason to ask the model. Punctuation and spaces don't count.
export function isFillerOnly(text: string, scene: Scene): boolean {
  const bare = text.replace(/[\s\p{P}\p{S}]/gu, '')
  return bare.length > 0 && (scene === 'chat' ? HESITATION : INTERJECTION).test(bare)
}

const HAN = /\p{Script=Han}/u

// The prompt asks for plain text; models still slip into Markdown now and then.
// Only prose is touched: in code, ** and # mean something.
export function tidyRefined(text: string, scene: Scene): string {
  let out = text.trim()
  // The whole answer fenced as a code block.
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(out)
  if (fenced) out = fenced[1].trim()
  if (scene !== 'code') {
    out = out
      .replace(/\*\*([^*\n]+)\*\*/g, (m, inner: string) => (HAN.test(inner) ? inner : m))
      .replace(/^#{1,6}[ \t]+(?=.*\p{Script=Han})/gmu, '')
  }
  return out
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
}
