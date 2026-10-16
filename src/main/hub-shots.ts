// Dev check: REA_HUB_SHOTS=<dir> opens the hub on a throwaway profile filled
// with sample data and saves a screenshot of every page in light and dark.
import { app, nativeTheme } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HubRoute } from '../shared/hub'
import type { Db } from './db'
import { getHub, openHub } from './windows'

const SAMPLES = [
  '明天下午三点开会，讨论一下新版本的发布计划，记得带上上周的数据。',
  '我最近在用 Claude Code 写代码，感觉比 Cursor 好用一些。',
  '帮我把这段话改得更礼貌一点。',
  '周四晚上一起吃饭吧，地点你来定。',
  '这个功能的核心是让用户不用打字，说完话文字就自动出现在光标处。',
  '第一，先把识别做准；第二，润色要忠实；第三，界面要简洁好看。'
]

function seed(db: Db): void {
  const now = Date.now()
  const DAY = 86_400_000
  let n = 0
  for (let d = 0; d < 120; d++) {
    if ((d * 7) % 5 === 0 && d > 3) continue // a few idle days
    const perDay = 1 + ((d * 13) % 6)
    for (let i = 0; i < perDay; i++) {
      const text = SAMPLES[(d + i) % SAMPLES.length]
      db.saveHistory({
        id: `demo-${n++}`,
        mode: i % 7 === 3 ? 'translate' : 'dictate',
        status: d === 0 && i === 1 ? 'error' : 'ok',
        rawText: text,
        refinedText: text,
        appName: ['WeChat.exe', 'Code.exe', 'chrome.exe', 'Notepad.exe'][i % 4],
        title: null,
        scene: null,
        asrEngine: 'local',
        model: 'qwen/qwen3.8-27b',
        durationMs: 4000 + text.length * 220,
        voicedMs: 3000,
        peakRms: 0.4,
        transcribeMs: 320,
        refineMs: 600,
        audioPath: null,
        error: null,
        createdAt: now - d * DAY - i * 3_700_000
      })
    }
  }
  const ask = (id: string, minutesAgo: number, rawText: string, refinedText: string, extra = {}) =>
    db.saveHistory({
      id,
      mode: 'ask',
      status: 'ok',
      rawText,
      refinedText,
      appName: 'chrome.exe',
      title: null,
      scene: null,
      asrEngine: 'local',
      model: 'claude-sonnet-4-6',
      durationMs: 3000,
      voicedMs: 2500,
      peakRms: 0.4,
      transcribeMs: 300,
      refineMs: 1800,
      audioPath: null,
      error: null,
      createdAt: now - minutesAgo * 60_000,
      ...extra
    })
  ask('demo-ask-1', 5, '帮我解释一下什么是向量数据库，用三句话说清楚。', '**向量数据库**按语义相似度检索数据……', { askResult: 'answer' })
  ask('demo-ask-2', 9, '把这句话改得更礼貌一点。', '麻烦把文件发给我，谢谢！', { askResult: 'edit', selectedText: '把文件发我，快点。' })
  db.addWords(['辛禾Xenho', 'Claude Code', 'Notion', 'SenseVoice', 'Saydra', 'Groq', 'CPA'])
  db.addWord('卜禾李', 'auto')
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runHubShots(db: Db, dir: string): Promise<void> {
  seed(db)
  openHub('home')
  await wait(2500)
  const win = getHub()
  if (!win) throw new Error('hub did not open')
  const routes: HubRoute[] = ['home', 'history', 'dictionary', 'settings', 'models', 'welcome']
  for (const theme of ['light', 'dark'] as const) {
    nativeTheme.themeSource = theme
    for (const route of routes) {
      win.webContents.send('hub:navigate', route)
      await wait(900)
      const img = await win.webContents.capturePage()
      await writeFile(join(dir, `${theme}-${route}.png`), img.toPNG())
      if (route === 'home') {
        // Scrolled: content must stay below the title bar and window buttons.
        await win.webContents.executeJavaScript(`document.querySelector('.content').scrollTop = 160`)
        await wait(300)
        await writeFile(join(dir, `${theme}-home-scrolled.png`), (await win.webContents.capturePage()).toPNG())
        await win.webContents.executeJavaScript(`document.querySelector('.content').scrollTop = 0`)
      }
      if (route === 'welcome') {
        // Step 2 of the guide for each service choice.
        const shootChoice = async (i: number, name: string) => {
          await win.webContents.executeJavaScript(`document.querySelectorAll('.welcome-choice')[${i}].click()`)
          await wait(500)
          await writeFile(join(dir, `${theme}-welcome-${name}.png`), (await win.webContents.capturePage()).toPNG())
          await win.webContents.executeJavaScript(`document.querySelector('.welcome-footer .btn').click()`) // 上一步
          await wait(300)
        }
        await shootChoice(0, 'groq')
        await shootChoice(1, 'custom')
      }
      if (route === 'settings' || route === 'models') {
        // These pages are taller than the modal: also shoot their bottom half.
        await win.webContents.executeJavaScript(`(() => {
          for (let el = document.querySelector('.set-page'); el; el = el.parentElement)
            if (el.scrollHeight > el.clientHeight + 1) { el.scrollTop = el.scrollHeight; break }
        })()`)
        await wait(300)
        const rest = await win.webContents.capturePage()
        await writeFile(join(dir, `${theme}-${route}-bottom.png`), rest.toPNG())
      }
      if (route === 'settings' || route === 'models' || route === 'welcome') win.webContents.send('hub:navigate', 'home')
    }
  }
  console.log('HUB SHOTS OK')
  app.exit(0)
}
