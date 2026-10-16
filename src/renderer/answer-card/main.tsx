// 问任何问题 answer card: the question (and the selected text), then the answer.
import { render } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { AnswerPayload } from '../../shared/types'
import { Icon } from '../hub/ui'
import { renderMarkdown } from './markdown'
import '@fontsource/prompt/500.css'
import '../hub/tokens.css'
import './card.css'

const PROMPT_LINE = 22
const PROMPT_LINES = 2 // collapsed height of the question block
const PAGE_PADDING = 24 + 8 // above and below the card, in the window
const COPIED_MS = 3000

function CopyButton({ text, label, class: cls }: { text: string; label: string; class?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    await window.rea.copyText(text)
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
  }
  return (
    <button type="button" class={`copy-btn${copied ? ' copied' : ''} ${cls ?? ''}`} data-tip={copied ? '已复制' : label} onClick={copy}>
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  )
}

function Prompt({ prompt, selectedText }: { prompt: string; selectedText: string | null }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    setExpanded(false)
    const el = box.current
    if (el) setOverflows(el.scrollHeight > PROMPT_LINE * PROMPT_LINES + 1)
  }, [prompt, selectedText])
  const all = [prompt, selectedText].filter(Boolean).join('\n')

  return (
    <div class="prompt">
      <div ref={box} class={`prompt-box${expanded ? ' open' : ''}`}>
        <div class="prompt-row">
          <span class="prompt-icon">
            <Icon name="mic" size={14} />
          </span>
          <p class="prompt-text">{prompt}</p>
          <CopyButton text={all} label="复制" />
        </div>
        {selectedText && (
          <div class="prompt-row">
            <span class="quote-bar" />
            <p class="prompt-text selected">{selectedText}</p>
            <span class="copy-spacer" />
          </div>
        )}
        {overflows && !expanded && (
          <button type="button" class="more" onClick={() => setExpanded(true)}>
            ...更多
          </button>
        )}
      </div>
      {overflows && expanded && (
        <button type="button" class="less" onClick={() => setExpanded(false)}>
          显示更少
        </button>
      )}
    </div>
  )
}

function App() {
  const [payload, setPayload] = useState<AnswerPayload | null>(null)
  const [shown, setShown] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const show = (p: AnswerPayload | null) => {
      if (!p) return
      setShown(false)
      setPayload(p)
    }
    window.rea.onCardShow(show)
    void window.rea.cardPayload().then(show)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && window.rea.closeCard()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The window takes the card's height; a new answer always reports, so the
  // hidden window is shown again even when the height did not change.
  useLayoutEffect(() => {
    const el = card.current
    if (!payload || !el) return
    if (scroller.current) scroller.current.scrollTop = 0
    let last = 0
    const report = (force = false) => {
      const h = Math.ceil(el.getBoundingClientRect().height) + PAGE_PADDING
      if (!force && Math.abs(h - last) < 2) return
      last = h
      window.rea.resizeCard(h)
    }
    const ro = new ResizeObserver(() => report())
    ro.observe(el)
    report(true)
    const t = setTimeout(() => setShown(true), 120)
    return () => {
      ro.disconnect()
      clearTimeout(t)
    }
  }, [payload])

  const html = useMemo(() => (payload ? renderMarkdown(payload.answer) : ''), [payload])
  if (!payload) return null

  return (
    <div class="page">
      <div ref={card} class={`card${shown ? ' shown' : ''}`}>
        <div class="card-head">
          <div class="card-logo">
            <svg viewBox="0 0 26 26" width="20" height="20" aria-hidden="true">
              <rect x="5.2" y="10.1" width="2.4" height="5.8" rx="1.2" />
              <rect x="9" y="7.5" width="2.4" height="11" rx="1.2" />
              <rect x="12.8" y="4.9" width="2.4" height="16.2" rx="1.2" />
              <rect x="16.6" y="7.5" width="2.4" height="11" rx="1.2" />
              <rect x="20.4" y="10.1" width="2.4" height="5.8" rx="1.2" />
            </svg>
            <span>Saydra</span>
          </div>
          <button type="button" class="close-btn" data-tip="关闭" data-key="Esc" onClick={() => window.rea.closeCard()}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div ref={scroller} class="card-scroll">
          <Prompt prompt={payload.prompt} selectedText={payload.selectedText} />
          <section class="answer">
            <header class="answer-head">
              <span class="answer-title">
                <Icon name="sparkle" size={14} />
                回答
              </span>
              <CopyButton text={payload.answer} label="复制" class="answer-copy" />
            </header>
            <div class="answer-body markdown" dangerouslySetInnerHTML={{ __html: html }} />
          </section>
        </div>
      </div>
    </div>
  )
}

render(<App />, document.getElementById('root')!)
