// Floating bar: the pill plus alert cards above it.
import { render } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { languageName, MAX_TRANSLATE_LANGUAGES } from '../../shared/languages'
import { COUNTDOWN_MS, MAX_RECORD_MS, type BarAlert, type BarView, type TranslateTarget } from '../../shared/types'
import { createRecorder, decodePcm, type MicStatus } from './recorder'
import { playStart, playStop } from './sounds'
import { createWaveform } from './waveform'
import './bar.css'

const BAR_COUNT = 10 // 38px wide: 2px bars, 2px gaps
const HOVER_DELAY_MS = 250
const DONE_FADE_MS = 350

// Refine progress: fast to 80% in a second, then creeps towards 99%.
const PROGRESS = [
  [0, 0],
  [1, 80],
  [2, 90],
  [3, 95],
  [4, 97],
  [5, 98],
  [10, 99]
]
function progressAt(sec: number): number {
  for (let i = 0; i < PROGRESS.length - 1; i++) {
    const [t0, p0] = PROGRESS[i]
    const [t1, p1] = PROGRESS[i + 1]
    if (sec >= t0 && sec < t1) return p0 + ((sec - t0) / (t1 - t0)) * (p1 - p0)
  }
  return 99
}

type Status = 'idle' | 'hover' | 'starting' | 'recording' | 'hands-free' | 'refining' | 'error'

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
)
function Tooltip({ text, keyLabel, show }: { text: string; keyLabel?: string; show: boolean }) {
  return (
    <div class={`tooltip${show ? ' show' : ''}`} role="tooltip">
      <span>{text}</span>
      {keyLabel && <kbd>{keyLabel}</kbd>}
    </div>
  )
}

function Dots() {
  return (
    <div class="dots">
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  )
}

// A one-line title with actions sits on a single row. Cards you can act on show
// how long is left (the bar pauses while the pointer is over the cards).
function AlertCard({ alert, onClose, paused, round }: { alert: BarAlert; onClose: () => void; paused: boolean; round: number }) {
  const [done, setDone] = useState<string | null>(null) // the action whose doneLabel is showing
  const actionable = !!alert.actions?.length
  const layout = alert.description || alert.quote ? ' with-desc' : actionable ? ' inline' : ''
  return (
    <div class={`alert${layout}`} data-interactive>
      <div class="alert-text">
        <div class="alert-title">{alert.title}</div>
        {alert.description && <div class="alert-desc">{alert.description}</div>}
        {alert.quote && <div class="alert-quote">"{alert.quote}"</div>}
      </div>
      {!!alert.actions?.length && (
        <div class="alert-actions">
          {alert.actions.map((a) =>
            a.doneLabel ? (
              // Copy button: small, flips to a check + 已复制, then the card goes
              <button
                key={a.action}
                class={`btn small${done === a.action ? ' done' : ''}`}
                disabled={done === a.action}
                onClick={() => {
                  window.rea.sendAction(a.action)
                  setDone(a.action)
                  setTimeout(onClose, 400)
                }}
              >
                {done === a.action && <CheckIcon />}
                {done === a.action ? a.doneLabel : a.label}
              </button>
            ) : (
              <button
                key={a.action}
                class={a.primary ? 'btn primary' : 'btn'}
                onClick={() => {
                  window.rea.sendAction(a.action)
                  onClose()
                }}
              >
                {a.label}
              </button>
            )
          )}
        </div>
      )}
      <button class="alert-close" aria-label="关闭" onClick={onClose}>
        <CloseIcon />
      </button>
      {actionable && !!alert.autoHideMs && (
        <i
          key={round}
          class="alert-timer"
          style={{ animationDuration: `${alert.autoHideMs}ms`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      )}
    </div>
  )
}

const CheckIcon = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
)

const ChevronIcon = () => (
  <svg viewBox="0 0 8 8" aria-hidden="true">
    <path d="M1.2 2.6 4 5.4l2.8-2.8" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
)

// 「翻译为 English ▾」 above the pill; hovering the language lists the others.
function TranslateChip({ target }: { target: TranslateTarget }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  // The chosen language sits at the bottom, nearest the chip.
  const ordered = [target.active, ...target.languages.filter((c) => c !== target.active)].reverse()
  const canAdd = target.languages.length < MAX_TRANSLATE_LANGUAGES
  return (
    <div
      class="tchip-wrap"
      onMouseEnter={() => window.rea.setInteractive(true)}
      onMouseLeave={() => {
        setOpen(false)
        window.rea.setInteractive(false)
      }}
    >
      {open && (
        <div
          class="tchip-pop"
          style={{
            left: `${(trigger.current?.offsetLeft ?? 0) - 5}px`,
            minWidth: `${(trigger.current?.offsetWidth ?? 0) + 10}px`
          }}
        >
          {canAdd && (
            <>
              <button class="tchip-item" onClick={() => (setOpen(false), window.rea.sendAction('add-language'))}>
                添加另一种语言
              </button>
              <i class="tchip-divider" />
            </>
          )}
          {ordered.map((code) => (
            <button
              key={code}
              class={`tchip-item${code === target.active ? ' on' : ''}`}
              onClick={() => {
                setOpen(false)
                if (code !== target.active) window.rea.translateTo(code)
              }}
            >
              {languageName(code)}
            </button>
          ))}
        </div>
      )}
      <div class="tchip">
        <span class="tchip-label">翻译为</span>
        <button ref={trigger} class="tchip-trigger" onMouseEnter={() => setOpen(true)}>
          <span>{languageName(target.active)}</span>
          <ChevronIcon />
        </button>
        <i class="tchip-light" />
      </div>
    </div>
  )
}

// Tell the main process where the pill and cards are: it checks the pointer against
// them too, in case the forwarded mouse moves stop arriving (see watchBarPointer).
const HIT_TARGETS = '.alert, .pill:not([data-hidden]), .tchip-wrap, .tchip-pop'

function watchHitRects(): () => void {
  const stage = document.querySelector('.stage')!
  let frame = 0
  let sent = ''
  const send = () => {
    frame = 0
    const rects = [...document.querySelectorAll(HIT_TARGETS)]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width && r.height)
      .map((r) => [r.left, r.top, r.right, r.bottom].map(Math.round))
    const json = JSON.stringify(rects)
    if (json !== sent) window.rea.setHitRects(rects)
    sent = json
  }
  const schedule = () => (frame ||= requestAnimationFrame(send))
  const mutations = new MutationObserver(schedule)
  mutations.observe(stage, { subtree: true, childList: true, attributes: true })
  const sizes = new ResizeObserver(schedule)
  sizes.observe(stage)
  // Cards slide in: measure again once they have settled.
  stage.addEventListener('animationend', schedule)
  stage.addEventListener('transitionend', schedule)
  schedule()
  return () => {
    mutations.disconnect()
    sizes.disconnect()
    stage.removeEventListener('animationend', schedule)
    stage.removeEventListener('transitionend', schedule)
  }
}

function App() {
  const [view, setView] = useState<BarView>({ kind: 'idle' })
  const [mic, setMic] = useState<MicStatus>('off')
  const [heights, setHeights] = useState<number[]>(() => Array(BAR_COUNT).fill(2))
  const [alerts, setAlerts] = useState<BarAlert[]>([])
  const [alertsHover, setAlertsHover] = useState(false)
  const [alertRound, setAlertRound] = useState(0) // bumps on pointer leave: countdowns restart
  const [hovering, setHovering] = useState(false)
  const [hoverReady, setHoverReady] = useState(false)
  const [tip, setTip] = useState<'cancel' | 'finish' | null>(null)
  const [now, setNow] = useState(Date.now())
  const [progress, setProgress] = useState(0)
  const [fading, setFading] = useState(false)
  const [showIdle, setShowIdle] = useState(false) // hidden until settings say otherwise: no flash when it is off
  const soundsOn = useRef(true)

  const wave = useMemo(() => createWaveform(BAR_COUNT, setHeights), [])
  const recorder = useMemo(
    () =>
      createRecorder((status, analyser) => {
        setMic(status)
        wave.attach(analyser)
      }),
    [wave]
  )

  useEffect(() => {
    window.rea.onStartRecording((req) => {
      soundsOn.current = req.sounds
      if (req.sounds) playStart()
      void recorder.start(req)
    })
    window.rea.onStopRecording(() => {
      if (soundsOn.current) playStop()
      recorder.stop()
    })
    window.rea.onCancelRecording(() => recorder.cancel())
    window.rea.onDecodeAudio(async (reqId, audio) => window.rea.sendDecoded(reqId, await decodePcm(new Blob([audio]))))
    window.rea.onResendCancelled(() => recorder.resendCancelled())
    window.rea.onView(setView)
    window.rea.onShowIdleBar(setShowIdle)
    void window.rea.getSettings().then((s) => setShowIdle(s.showIdleBar))
    window.rea.onAlert((a) => setAlerts((list) => [...list.filter((x) => x.id !== a.id), a].slice(-2)))
    window.rea.onClearAlert((id) => setAlerts((list) => (id ? list.filter((x) => x.id !== id) : [])))
  }, [recorder])

  useEffect(watchHitRects, [])

  // Auto-hide alerts, each on its own clock (another card closing doesn't reset it);
  // hovering holds them, leaving starts every countdown again.
  const shownAt = useRef(new Map<BarAlert, number>())
  useEffect(() => shownAt.current.clear(), [alertRound])
  useEffect(() => {
    if (alertsHover) return
    const now = Date.now()
    const timers = alerts
      .filter((a) => a.autoHideMs)
      .map((a) => {
        if (!shownAt.current.has(a)) shownAt.current.set(a, now)
        const left = a.autoHideMs! - (now - shownAt.current.get(a)!)
        return setTimeout(() => setAlerts((l) => l.filter((x) => x !== a)), Math.max(0, left))
      })
    return () => timers.forEach(clearTimeout)
  }, [alerts, alertsHover, alertRound])

  // Countdown clock while recording.
  useEffect(() => {
    if (view.kind !== 'recording') return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [view.kind])

  // Refine progress, then fill to 100% and fade back to idle.
  useEffect(() => {
    if (view.kind === 'processing') {
      setFading(false)
      const t0 = performance.now()
      let raf = 0
      const tick = () => {
        const p = progressAt((performance.now() - t0) / 1000)
        setProgress(p)
        if (p < 99) raf = requestAnimationFrame(tick)
      }
      tick()
      return () => cancelAnimationFrame(raf)
    }
    if (view.kind === 'done') {
      setProgress(100)
      setFading(true)
      const id = setTimeout(() => {
        setFading(false)
        setProgress(0)
        setView({ kind: 'idle' })
      }, DONE_FADE_MS)
      return () => clearTimeout(id)
    }
    setProgress(0)
  }, [view.kind])

  // The idle handle expands only after the pointer rests on it.
  useEffect(() => {
    if (!hovering) return setHoverReady(false)
    const id = setTimeout(() => setHoverReady(true), HOVER_DELAY_MS)
    return () => clearTimeout(id)
  }, [hovering])

  const status: Status = (() => {
    switch (view.kind) {
      case 'recording':
        return mic !== 'live' ? 'starting' : view.handsFree ? 'hands-free' : 'recording'
      case 'processing':
      case 'done':
        return fading || view.kind === 'processing' ? 'refining' : 'idle'
      case 'error':
        return 'error'
      default:
        return hoverReady ? 'hover' : 'idle'
    }
  })()

  const remaining = view.kind === 'recording' ? MAX_RECORD_MS - (now - view.startedAt) : Infinity
  const countdown =
    remaining <= COUNTDOWN_MS
      ? (() => {
          const s = Math.max(0, Math.ceil(remaining / 1000))
          return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
        })()
      : ''
  const mode = view.kind === 'recording' || view.kind === 'processing' ? view.mode : 'dictate'
  const translate = view.kind === 'recording' || view.kind === 'processing' ? view.translate : undefined
  const showWave = status === 'recording' || status === 'hands-free'
  const handsFree = status === 'hands-free'

  const enter = () => {
    setHovering(true)
    window.rea.setInteractive(true)
  }
  const leave = () => {
    setHovering(false)
    setTip(null)
    window.rea.setInteractive(false)
  }

  return (
    <div class="stage">
      <div
        class="alerts"
        onMouseEnter={() => {
          setAlertsHover(true)
          window.rea.setInteractive(true)
        }}
        onMouseLeave={() => {
          setAlertsHover(false)
          setAlertRound((r) => r + 1)
          leave()
        }}
      >
        {alerts.map((a) => (
          <AlertCard
            key={a.id}
            alert={a}
            paused={alertsHover}
            round={alertRound}
            onClose={() => setAlerts((l) => l.filter((x) => x.id !== a.id))}
          />
        ))}
      </div>
      {translate && <TranslateChip target={translate} />}
      <div class="pill-wrap">
        <Tooltip text="点击开始录音" show={status === 'hover'} />
        <div
          class="pill"
          data-status={status}
          data-mode={mode}
          data-countdown={countdown ? '' : undefined}
          data-live={mic === 'live' ? '' : undefined}
          data-hidden={status === 'idle' && !showIdle ? '' : undefined}
          onMouseEnter={enter}
          onMouseLeave={leave}
          onClick={() => status === 'hover' && window.rea.sendAction('pill-click')}
        >
          {mode !== 'dictate' && (status === 'recording' || status === 'hands-free' || status === 'refining') && (
            <div class="glow">
              <i />
            </div>
          )}
          {(status === 'hover' || status === 'error') && <Dots />}
          {(showWave || status === 'refining') && (
            <div class="row">
              <span class="btn-wrap">
                <Tooltip text="取消" show={tip === 'cancel' && handsFree} />
                <button
                  class="round cancel"
                  data-show={handsFree ? '' : undefined}
                  aria-label="取消"
                  onMouseEnter={() => setTip('cancel')}
                  onMouseLeave={() => setTip(null)}
                  onClick={(e) => {
                    e.stopPropagation()
                    window.rea.sendAction('cancel')
                  }}
                >
                  <CloseIcon />
                </button>
              </span>
              {showWave && (
                <div class="wave">
                  {heights.map((h, i) => (
                    <i key={i} style={{ height: `${h}px` }} />
                  ))}
                </div>
              )}
              <span class="countdown">{countdown}</span>
              {status === 'refining' && (
                <>
                  <div class="progress">
                    <i style={{ width: `${progress}%` }} />
                  </div>
                  <span class="shimmer" data-text="Thinking">
                    Thinking
                  </span>
                </>
              )}
              <span class="btn-wrap">
                <Tooltip
                  text="完成"
                  keyLabel={view.kind === 'recording' ? view.finishKey : undefined}
                  show={tip === 'finish' && handsFree}
                />
                <button
                  class="round finish"
                  data-show={handsFree ? '' : undefined}
                  aria-label="完成"
                  onMouseEnter={() => setTip('finish')}
                  onMouseLeave={() => setTip(null)}
                  onClick={(e) => {
                    e.stopPropagation()
                    window.rea.sendAction('finish')
                  }}
                >
                  <CheckIcon />
                </button>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

render(<App />, document.getElementById('root')!)
