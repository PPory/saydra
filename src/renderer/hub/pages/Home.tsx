// 首页: 「说话，不要打字」, usage stats, activity heatmap, last 7 days, shortcuts.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { DayActivity, HomeStats } from '../../../shared/hub'
import type { ShortcutBindings } from '../../../shared/keys'
import { durationParts, fmtNumber, KeyCaps, useCountUp } from '../ui'

const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const CELL = 14
const GAP = 8
const LEVEL_TIPS = ['没有活动', '轻度使用', '中度使用', '高使用频率', '强力使用']

// Words per day -> heat level 0-4.
const level = (words: number) => (words <= 0 ? 0 : words < 200 ? 1 : words < 1000 ? 2 : words < 3000 ? 3 : 4)

const parseDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function StatValue({ parts, empty }: { parts: { value: string; unit: string }[]; empty: boolean }) {
  return (
    <p class={`stat-value${empty ? ' empty' : ''}`}>
      {empty ? (
        <b>--</b>
      ) : (
        parts.map((p, i) => (
          <>
            {i > 0 && ' '}
            <b>{p.value}</b>
            {p.unit && <span> {p.unit}</span>}
          </>
        ))
      )}
    </p>
  )
}

function StatCard({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="stat-card">
      {children}
      <span class="stat-label">{label}</span>
    </div>
  )
}

function Stats({ s }: { s: HomeStats | null }) {
  const words = useCountUp(s?.totalWords ?? 0)
  const saved = useCountUp(s?.savedSeconds ?? 0)
  const wpm = useCountUp(s?.avgWpm ?? 0)
  const total = useCountUp(s?.totalSeconds ?? 0)
  const empty = !s || s.totalWords === 0
  return (
    <div class="stats-grid">
      <StatCard label="口述字数">
        <StatValue empty={empty} parts={[{ value: fmtNumber(words), unit: '字' }]} />
      </StatCard>
      <StatCard label="节省时间">
        <StatValue empty={empty} parts={durationParts(saved)} />
      </StatCard>
      <StatCard label="平均口述速度">
        <StatValue empty={empty} parts={[{ value: fmtNumber(wpm), unit: '每分钟字数' }]} />
      </StatCard>
      <StatCard label="总口述时间">
        <StatValue empty={empty} parts={durationParts(total)} />
      </StatCard>
    </div>
  )
}

function Heatmap({ s }: { s: HomeStats | null }) {
  const track = useRef<HTMLDivElement>(null)
  const [weeksFit, setWeeksFit] = useState(20)
  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    const measure = () => setWeeksFit(Math.max(4, Math.floor((el.clientWidth + GAP) / (CELL + GAP))))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const days = s?.activity ?? []
  const weeks: DayActivity[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  const shown = weeks.slice(-weeksFit)
  const summary = [
    { label: '活跃天数', value: s?.activeDays ?? 0 },
    { label: '当前连续天数', value: s?.currentStreak ?? 0 },
    { label: '最长连续天数', value: s?.longestStreak ?? 0 }
  ]

  return (
    <div class="heat-card">
      <div class="heat-summary">
        {summary.map((x) => (
          <div>
            <p class="stat-value">
              <b>{s ? fmtNumber(x.value) : '--'}</b>
              {s && <span> 天</span>}
            </p>
            <span class="stat-label">{x.label}</span>
          </div>
        ))}
      </div>
      <div class="heat-track" ref={track}>
        <div class="heat-months" style={{ gridTemplateColumns: `repeat(${shown.length}, ${CELL}px)` }}>
          {shown.map((w, i) => {
            const first = parseDay(w[0].day)
            const prev = i > 0 ? parseDay(shown[i - 1][0].day) : null
            const label = !prev || prev.getMonth() !== first.getMonth() ? MONTHS[first.getMonth()] : ''
            return <span>{label}</span>
          })}
        </div>
        <div class="heat-grid" style={{ gridTemplateColumns: `repeat(${shown.length}, ${CELL}px)` }}>
          {shown.map((w) =>
            Array.from({ length: 7 }, (_, d) => {
              const day = w[d]
              if (!day) return <i class="heat-cell future" />
              const date = parseDay(day.day)
              const lv = level(day.words)
              return (
                <i
                  class={`heat-cell l${lv}`}
                 
                  data-tip={`${date.getMonth() + 1}月${date.getDate()}日 · ${day.words ? `${fmtNumber(day.words)} 字` : LEVEL_TIPS[0]}`}
                />
              )
            })
          )}
        </div>
      </div>
      <div class="heat-legend">
        <span>更少</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i class={`heat-cell l${l}`} data-tip={LEVEL_TIPS[l]} />
        ))}
        <span>更多</span>
      </div>
    </div>
  )
}

function Last7({ s }: { s: HomeStats | null }) {
  const days = s?.last7 ?? []
  const max = Math.max(1, ...days.map((d) => d.words))
  const total = days.reduce((n, d) => n + d.words, 0)
  return (
    <div class="week-card">
      <div class="week-head">
        <span class="card-title">过去7天</span>
        <span class="week-total">
          <b>{fmtNumber(total)}</b> 字
        </span>
      </div>
      <div class="week-bars">
        {days.map((d, i) => {
          const date = parseDay(d.day)
          const today = i === days.length - 1
          return (
            <div class="week-col" data-tip={`${fmtNumber(d.words)} 字`}>
              <div class="week-bar-track">
                <div class={`week-bar${today ? ' today' : ''}`} style={{ height: `${Math.max(d.words ? 4 : 0, (d.words / max) * 100)}%` }} />
              </div>
              <span class={today ? 'today' : ''}>{today ? '今天' : WEEKDAYS[date.getDay()]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Shortcuts({ bindings }: { bindings: ShortcutBindings | null }) {
  if (!bindings) return null
  const rows = [
    { label: '口述', desc: '杂乱的想法 → 清晰的文字', keys: bindings.dictate },
    { label: '翻译', desc: '自然的语言 → 清晰、地道的写作', keys: bindings.translate },
    { label: '问任何问题', desc: '编辑或询问文本', keys: bindings.ask }
  ]
  return (
    <div class="shortcut-list">
      {rows.map((r) => (
        <div class="shortcut-row">
          <span class="shortcut-label">{r.label}</span>
          <span class="shortcut-desc">{r.desc}</span>
          <KeyCaps keys={r.keys} />
        </div>
      ))}
    </div>
  )
}

export function Home({ version }: { version: number }) {
  const [stats, setStats] = useState<HomeStats | null>(null)
  const [bindings, setBindings] = useState<ShortcutBindings | null>(null)
  useEffect(() => {
    void window.rea.stats().then(setStats)
    void window.rea.getSettings().then((s) => setBindings(s.shortcuts))
  }, [version])

  return (
    <div class="page home">
      <h1 class="page-title">说话，不要打字</h1>
      <div class="home-columns">
        <div class="home-main">
          <div class="dotted-card">
            <div class="insights-head">
              <span class="section-title">洞察</span>
            </div>
            <Stats s={stats} />
            <Heatmap s={stats} />
            <Last7 s={stats} />
          </div>
        </div>
        <div class="home-gap" aria-hidden="true" />
        <aside class="home-side">
          <Shortcuts bindings={bindings} />
          <p class="side-hint">在任何应用的文本框中使用 Saydra：按住说话，松开结束；或轻按一下开始，再按一下结束。</p>
        </aside>
      </div>
    </div>
  )
}
