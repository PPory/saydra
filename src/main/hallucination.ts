// Whisper invents text on silence, usually video outros from its YouTube-heavy
// training data. Drop segments it is unsure about and known stock phrases.

export interface Segment {
  text: string
  no_speech_prob: number
  avg_logprob: number
}

const STOCK_PHRASES = [
  /明镜|点点栏目/,
  /点赞.{0,6}(订阅|转发|打赏|关注)|(订阅|关注).{0,6}(点赞|转发|打赏)/,
  /字幕(由|提供|制作|志愿者)|中文字幕|索兰娅|Amara/i,
  /(谢谢|感谢)(大家)?(的)?(观看|收看|收听)/,
  /请不吝/,
  /欢迎(订阅|关注).{0,8}(频道|节目)/
]

export function isStockPhrase(text: string): boolean {
  return STOCK_PHRASES.some((re) => re.test(text))
}

// Standard Whisper silence rule: unsure it is speech AND unsure of the words.
function isLikelySilence(s: Segment): boolean {
  return s.no_speech_prob > 0.5 && s.avg_logprob < -0.7
}

// Real speech scores ~0.00 no_speech_prob; the hallucinations seen on silence
// and room noise scored 0.23–0.61. Only then is a stock phrase treated as fake,
// so a user who really dictates 「记得点赞关注」 keeps it.
const SUSPECT_NO_SPEECH = 0.1

export function keepSpokenText(segments: Segment[]): string {
  return segments
    .filter((s) => !isLikelySilence(s) && !(isStockPhrase(s.text) && s.no_speech_prob >= SUSPECT_NO_SPEECH))
    .map((s) => s.text.trim())
    .join('')
    .trim()
}
