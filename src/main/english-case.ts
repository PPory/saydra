// SenseVoice writes every English word in capitals (「HELLO EVERYONE」「WINDOWS 和 MAC」).
// Put them back in normal case before refine, which tends to copy them as they are.
// Pure, so it can be tested. Words that already have lower case letters are left alone.

// Kept in capitals.
const ACRONYMS = new Set(
  (
    'AI API CEO CFO COO CTO CPU GPU CSV PDF PPT JSON XML HTML CSS JS TS SQL URL HTTP HTTPS DNS IP ID UI UX ' +
    'PR MR CI CD SDK IDE CLI LLM GPT MCP RAG OCR ASR TTS USB SSD RAM PC TV VR AR OK KPI OKR ROI SEO B2B B2C ' +
    'VIP FAQ PS PM HR QA AWS GCP CPA VPN NBA IT'
  ).split(' ')
)

// Names and keys with a fixed spelling.
const PROPER: Record<string, string> = Object.fromEntries(
  (
    'Alt Ctrl Shift Tab Esc Enter Windows Mac macOS iOS iPhone iPad Android Linux Excel Word Chrome Safari Edge ' +
    'GitHub GitLab Google Gmail YouTube Twitter Facebook Instagram TikTok Reddit Notion Figma Slack Zoom Teams ' +
    'Microsoft Apple Amazon OpenAI ChatGPT Claude Anthropic Gemini DeepSeek Qwen Llama Groq Whisper Cursor ' +
    'Python JavaScript TypeScript Java Node React Vue Docker Git SaaS WiFi Typeless Saydra Hello'
  )
    .split(' ')
    .map((w) => [w.toLowerCase(), w])
)

// Ordinary words: lower case inside an English sentence.
const COMMON = new Set(
  (
    'a an the and or but if so of to in on at by for with from up down out off over into about as is am are was ' +
    'were be been being do does did have has had will would can could should may might must shall i me my mine ' +
    'you your we our us they them their he him his she her it its this that these those there here what which ' +
    'who whom why how when where all any some no not yes very just only also too more most much many one two ' +
    'three first last next new old good bad great nice okay hello hi hey bye thanks thank please sorry name ' +
    'test testing everyone everybody something nothing anything time day today now then again let lets go get ' +
    'make take see look say tell know think want need like love use try work call come give find keep put run app'
  ).split(' ')
)

const LATIN_RUN = /[A-Za-z][A-Za-z0-9]*(?:[ '’-]+[A-Za-z][A-Za-z0-9]*)*/g

function fixWord(word: string, inSentence: boolean, terms: Map<string, string>): string {
  if (/[a-z]/.test(word)) return word
  const lower = word.toLowerCase()
  const term = terms.get(lower)
  if (term) return term
  if (word === 'I') return 'I'
  if (inSentence && COMMON.has(lower)) return lower
  if (ACRONYMS.has(word)) return word
  if (PROPER[lower]) return PROPER[lower]
  if (word.length <= 3) return word // letters or an abbreviation we don't know: 「GT」「Ctrl 加 V」
  return inSentence ? lower : word[0] + lower.slice(1)
}

// A dictionary phrase written with any case and spacing: 「CLAUDE  CODE」 for 「Claude Code」.
function phrasePattern(term: string): RegExp {
  const words = term.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, (c) => `\\${c}`))
  return new RegExp(`(?<![A-Za-z])${words.join('\\s+')}(?![A-Za-z])`, 'gi')
}

export function fixEnglishCase(text: string, dictionary: string[] = []): string {
  if (!/[A-Z]{2}/.test(text)) return text
  const latin = dictionary.map((t) => t.trim()).filter((t) => /^[ -~]+$/.test(t))
  const terms = new Map(latin.map((t) => [t.toLowerCase(), t]))
  for (const t of latin.filter((t) => t.includes(' ')).sort((a, b) => b.length - a.length))
    text = text.replace(phrasePattern(t), t)
  return text.replace(LATIN_RUN, (run) => {
    const words = run.split(/([ '’-]+)/)
    const inSentence = words.filter((_, i) => i % 2 === 0).length >= 3
    const fixed = words.map((w, i) => (i % 2 ? w : fixWord(w, inSentence, terms)))
    if (inSentence && /^[a-z]/.test(fixed[0])) fixed[0] = fixed[0][0].toUpperCase() + fixed[0].slice(1)
    return fixed.join('')
  })
}
