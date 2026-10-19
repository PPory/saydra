// Settings dialog over the hub: 设置, 模型服务, 关于.
import { useEffect, useState } from 'preact/hooks'
import type { AppInfo, Appearance, UpdateState } from '../../../shared/hub'
import { IS_MAC, type Shortcut, type ShortcutBindings } from '../../../shared/keys'
import type { AsrEngine, PublicSettings, RefineProvider } from '../../../shared/types'
import { Button, Icon, IconButton, Segmented, Switch, type IconName } from '../ui'
import { MicModal, Row, Section, ShortcutInput, TranslationLanguages } from './Controls'
import { GROQ_KEYS_URL, KeyField, ModelPicker, TryRefine, useModelList, useSettingsState, type Save } from './ModelService'

export type SettingsPage = 'settings' | 'models' | 'about'

const MENU: { key: SettingsPage; label: string; icon: IconName }[] = [
  { key: 'settings', label: '设置', icon: 'settings' },
  { key: 'models', label: '模型服务', icon: 'model' },
  { key: 'about', label: '关于', icon: 'info' }
]

function GeneralPage({ s, save }: { s: PublicSettings; save: Save }) {
  const [micOpen, setMicOpen] = useState(false)
  const [micName, setMicName] = useState('自动检测')
  useEffect(() => {
    if (!s.microphoneId) return setMicName('自动检测')
    void navigator.mediaDevices.enumerateDevices().then((list) => {
      setMicName(list.find((d) => d.deviceId === s.microphoneId)?.label || '已选择的麦克风')
    })
  }, [s.microphoneId])

  const setShortcut = (target: keyof ShortcutBindings) => (keys: Shortcut) =>
    save({ shortcuts: { ...s.shortcuts, [target]: keys } }, '快捷键已更新')

  return (
    <div class="set-page">
      <h2 class="set-title">设置</h2>
      <Section icon="keyboard" title="快捷键">
        <Row title="语音输入" description="按住说话。轻按一下进入免提模式，再按一下结束。" top>
          <ShortcutInput target="dictate" value={s.shortcuts.dictate} canDisable={false} onChange={setShortcut('dictate')} />
        </Row>
        <Row title="翻译" description="按下开始和停止翻译。" top>
          <ShortcutInput target="translate" value={s.shortcuts.translate} canDisable onChange={setShortcut('translate')} />
        </Row>
        <Row title="问任何问题" description="选中文字后说出指令来改写它，或者直接提问。" top>
          <ShortcutInput target="ask" value={s.shortcuts.ask} canDisable onChange={setShortcut('ask')} />
        </Row>
        <Row title="粘贴上一次转录" description="把最近一次的转录再粘贴一遍。" top>
          <ShortcutInput target="pasteLast" value={s.shortcuts.pasteLast} canDisable onChange={setShortcut('pasteLast')} />
        </Row>
      </Section>
      <Section icon="translate" title="语言">
        <Row title="翻译目标" description="在翻译模式中最多选择3种目标语言进行听写。录音时可以在浮条上切换。" top>
          <TranslationLanguages
            value={s.translationLanguages}
            onChange={(codes) => save({ translationLanguages: codes }, '翻译目标已更新')}
          />
        </Row>
      </Section>
      <Section icon="volume" title="音频">
        <Row title="麦克风" description="选择您首选的麦克风，以便 Saydra 捕捉您的声音。">
          <Button variant="outline" class="mic-button" onClick={() => setMicOpen(true)}>
            <span>{micName}</span>
            <Icon name="chevron" />
          </Button>
        </Row>
        <Row title="交互声音" description="为开始/停止等关键操作播放声音。">
          <Switch label="交互声音" checked={s.interactionSounds} onChange={(v) => save({ interactionSounds: v })} />
        </Row>
        <Row title="语音输入时静音" description="在语音输入时自动静音其他活动音频。">
          <Switch label="语音输入时静音" checked={s.muteWhileDictating} onChange={(v) => save({ muteWhileDictating: v })} />
        </Row>
      </Section>
      <Section icon="system" title="常规">
        <Row title="外观" description="选择明亮模式或黑暗模式。">
          <Segmented<Appearance>
            value={s.appearance}
            onChange={(v) => save({ appearance: v })}
            options={[
              { value: 'light', label: '明亮' },
              { value: 'dark', label: '黑暗' },
              { value: 'system', label: '系统' }
            ]}
          />
        </Row>
        <Row
          title="登录时启动应用"
          description={`当您的计算机启动时自动打开 Saydra（在${IS_MAC ? '菜单栏' : '托盘'}里安静运行）。`}
        >
          <Switch label="登录时启动应用" checked={s.launchAtLogin} onChange={(v) => save({ launchAtLogin: v })} />
        </Row>
        <Row title="常驻浮条" description="在屏幕底部常驻语音浮条，点一下即可开始说话。关闭后只在说话时出现。">
          <Switch label="常驻浮条" checked={s.showIdleBar} onChange={(v) => save({ showIdleBar: v })} />
        </Row>
        <Row
          title="自动检查更新"
          description={IS_MAC ? '有新版本时在「关于」里提醒你去下载。' : '有新版本时在后台下载好，重启 Saydra 即可更新。'}
        >
          <Switch label="自动检查更新" checked={s.autoUpdate} onChange={(v) => save({ autoUpdate: v })} />
        </Row>
      </Section>
      <MicModal
        open={micOpen}
        current={s.microphoneId}
        onClose={() => setMicOpen(false)}
        onSave={(id) => {
          setMicOpen(false)
          void save({ microphoneId: id }, '麦克风已更新')
        }}
      />
    </div>
  )
}

const SILICONFLOW_KEYS_URL = 'https://cloud.siliconflow.cn/account/ak'

const ASR_HINT: Record<AsrEngine, string> = {
  local: '在电脑上识别，不联网、不上传录音，约占 300MB 内存。',
  siliconflow: '和本机识别是同一个模型，准确度一样，不占内存；需要联网，录音会上传到硅基流动。从本机识别切过来，重启 Saydra 后才会释放内存。',
  groq: 'Whisper 英文好，但中文错字明显更多，一般不推荐。需要 Groq key 和代理。'
}

// Added to the end of the refine prompt; the built-in rules stay in place, so a
// note can't break the output format and later prompt fixes still reach everyone.
function RefineNotes({ value, save }: { value: string; save: Save }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <Row title="我的整理要求" description="整理口述时会照做，和默认风格冲突时以这里为准。" stacked>
      <textarea
        class="field refine-notes"
        maxLength={500}
        value={text}
        placeholder={'比如：\n英文术语不要翻译，保持原样\n结尾不要加句号\n「咱们」都写成「我们」'}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={() => text.trim() !== value && save({ refineNotes: text }, text.trim() ? '整理要求已保存' : '已清空整理要求')}
      />
    </Row>
  )
}

function ModelsPage({ s, save }: { s: PublicSettings; save: Save }) {
  const [url, setUrl] = useState(s.customBaseUrl)
  useEffect(() => setUrl(s.customBaseUrl), [s.customBaseUrl])
  const [models, setModels] = useModelList(s.customBaseUrl, s.hasCustomKey)
  // Only one model on offer and none chosen yet: take it.
  useEffect(() => {
    if (!s.customModel && models.length === 1) void save({ customModel: models[0] }, '已选择模型')
  }, [models, s.customModel])
  const customReady = Boolean(s.customBaseUrl && s.hasCustomKey && s.customModel)

  return (
    <div class="set-page">
      <h2 class="set-title">模型服务</h2>
      <Section icon="mic" title="识别与润色">
        <Row title="语音识别" description={ASR_HINT[s.asrEngine]}>
          <select class="field select" value={s.asrEngine} onChange={(e) => save({ asrEngine: e.currentTarget.value as AsrEngine })}>
            <option value="local">本机 SenseVoice（推荐）</option>
            <option value="siliconflow">云端识别（硅基流动，免费，省内存）</option>
            <option value="groq">云端 Groq Whisper</option>
          </select>
        </Row>
        <Row title="润色服务" description="去掉口头禅、修正自我更正、补标点。两个都配置时，一个失败会自动换另一个。">
          <select
            class="field select"
            value={s.refineProvider}
            onChange={(e) => save({ refineProvider: e.currentTarget.value as RefineProvider })}
          >
            <option value="groq">Groq（免费，最快）</option>
            <option value="custom">自定义服务</option>
          </select>
        </Row>
        <RefineNotes value={s.refineNotes} save={save} />
      </Section>
      {(s.asrEngine === 'siliconflow' || s.hasSiliconflowKey) && (
        <Section icon="mic" title="硅基流动">
          <Row
            title="API key"
            description={
              <>
                注册即可免费使用语音识别，国内直连，不用代理。
                <a class="link" onClick={() => void window.rea.openExternal(SILICONFLOW_KEYS_URL)}>
                  去申请 key
                </a>
              </>
            }
            top
          >
            <KeyField
              placeholder="sk-…  粘贴你的硅基流动 key"
              source={s.siliconflowKeySource}
              saved={s.hasSiliconflowKey}
              test={(k) => window.rea.testSiliconflow(k)}
              onSaved={(k) => save({ siliconflowKey: k })}
            />
          </Row>
        </Section>
      )}
      <Section icon="sparkle" title="Groq">
        <Row
          title="API key"
          description={
            <>
              免费账号即可，用于云端识别和润色。国内需要开代理才能连上。
              <a class="link" onClick={() => void window.rea.openExternal(GROQ_KEYS_URL)}>
                去申请 key
              </a>
            </>
          }
          top
        >
          <KeyField
            placeholder="gsk_…  粘贴你的 Groq key"
            source={s.apiKeySource}
            saved={s.hasApiKey}
            test={(k) => window.rea.testConnection(k)}
            onSaved={(k) => save({ apiKey: k })}
          />
        </Row>
        <Row title="润色模型">
          <select class="field select" value={s.refineModel} onChange={(e) => save({ refineModel: e.currentTarget.value })}>
            <option value="qwen/qwen3.8-27b">Qwen 3.8 27B（推荐）</option>
            <option value="openai/gpt-oss-120b">GPT-OSS 120B（更稳，稍慢）</option>
          </select>
        </Row>
        <Row title="试一下" description="用一句口语实际整理一次，看看效果和速度。" top>
          <TryRefine provider="groq" disabled={!s.hasApiKey} />
        </Row>
      </Section>
      <Section icon="model" title="自定义服务（OpenAI 兼容）">
        <Row title="服务地址" description="DeepSeek、通义千问、Kimi 等服务文档里的 OpenAI 兼容地址，一般以 /v1 结尾。" top>
          <input
            class="field wide"
            type="url"
            spellcheck={false}
            value={url}
            placeholder="https://…/v1"
            onInput={(e) => setUrl(e.currentTarget.value)}
            onBlur={() => url !== s.customBaseUrl && save({ customBaseUrl: url }, '服务地址已保存')}
          />
        </Row>
        <Row title="API key" top>
          <KeyField
            placeholder="API key"
            source={s.customKeySource}
            saved={s.hasCustomKey}
            test={async (k) => {
              const res = await window.rea.testCustom(url, k)
              if (res.models) setModels(res.models)
              return res
            }}
            onSaved={(k) => save({ customApiKey: k, customBaseUrl: url })}
          />
        </Row>
        <Row title="润色模型" description="选一个对话模型即可。名字带 reasoner、thinking 的推理模型会明显变慢。" top>
          <ModelPicker value={s.customModel} models={models} onChange={(m) => save({ customModel: m }, m ? '模型已保存' : undefined)} />
        </Row>
        <Row title="试一下" description="用一句口语实际整理一次，看看效果和速度。" top>
          <TryRefine provider="custom" disabled={!customReady} />
        </Row>
      </Section>
      <Section icon="folder" title="数据">
        <Row title="保存录音用于对比" description="每次口述另存一份录音，用于对比不同识别模型的效果。只存在本机。">
          <Switch label="保存录音" checked={s.saveRecordings} onChange={(v) => save({ saveRecordings: v })} />
        </Row>
        <Row title="数据文件夹" description="历史数据库、录音和设置都在这里。">
          <Button variant="outline" onClick={() => void window.rea.openDataDir()}>
            <Icon name="folder" />
            打开
          </Button>
        </Row>
      </Section>
    </div>
  )
}

const RELEASES_URL = 'https://github.com/PPory/saydra/releases/latest'

export const hasUpdate = (u: UpdateState) => u.kind === 'ready' || u.kind === 'available'

// Version line plus what the updater is doing, with the one button that moves it on.
function UpdateRow({ version, update }: { version: string; update: UpdateState }) {
  const status: Record<UpdateState['kind'], string> = {
    idle: '',
    checking: '正在检查更新…',
    latest: '已是最新版本',
    available: `新版本 ${'version' in update ? update.version : ''} 可以下载了`,
    downloading: `正在下载新版本 ${'version' in update ? update.version : ''}（${update.kind === 'downloading' ? update.percent : 0}%）`,
    ready: `新版本 ${'version' in update ? update.version : ''} 已就绪，重启即可更新`,
    error: update.kind === 'error' ? update.message : ''
  }
  const text = status[update.kind]
  const download = (label: string, variant: 'primary' | 'outline') => (
    <Button variant={variant} onClick={() => void window.rea.openExternal(RELEASES_URL)}>
      {label}
    </Button>
  )
  return (
    <Row title="版本" description={text ? `${version} · ${text}` : version}>
      {update.kind === 'ready' && (
        <Button variant="primary" onClick={() => void window.rea.updateInstall()}>
          重启更新
        </Button>
      )}
      {update.kind === 'available' && download('去下载', 'primary')}
      {update.kind === 'error' && download('去下载页', 'outline')}
      {['idle', 'latest', 'checking', 'error'].includes(update.kind) && (
        <Button variant="outline" loading={update.kind === 'checking'} onClick={() => void window.rea.updateCheck()}>
          {update.kind === 'error' ? '重试' : '检查更新'}
        </Button>
      )}
    </Row>
  )
}

function AboutPage({ update }: { update: UpdateState }) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => void window.rea.appInfo().then(setInfo), [])
  return (
    <div class="set-page">
      <h2 class="set-title">关于</h2>
      <Section icon="info" title="Saydra">
        <UpdateRow version={info?.version ?? ''} update={update} />
        {'notes' in update && update.notes.length > 0 && (
          <div class="update-notes">
            <span class="update-notes-title">{update.version} 更新了这些</span>
            <ul>
              {update.notes.map((n) => (
                <li>{n}</li>
              ))}
            </ul>
          </div>
        )}
        <Row
          title="怎么用"
          description="在任何输入框里按住快捷键说话，松开后整理好的文字自动出现在光标处；轻按一下进入免提，再按一下结束，Esc 取消。"
        />
        <Row
          title="隐私"
          description="录音和历史只存在本机。识别默认在本机完成；选了云端识别，或填了 Groq key（用来再听一遍英文）时，录音会发给对应的服务。润色把转写文字发给你配置的服务。检查更新只连接 GitHub。"
        />
        <Row title="数据位置" description={info?.dataDir ?? ''}>
          <Button variant="outline" onClick={() => void window.rea.openDataDir()}>
            打开
          </Button>
        </Row>
      </Section>
    </div>
  )
}

export function SettingsModal({
  page,
  update,
  onPage,
  onClose
}: {
  page: SettingsPage
  update: UpdateState
  onPage: (p: SettingsPage) => void
  onClose: () => void
}) {
  const [s, save] = useSettingsState()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.scrim .scrim') && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="settings-modal" role="dialog" aria-modal="true" aria-label="设置">
        <nav class="settings-menu">
          {MENU.map((m) => (
            <button type="button" class={`nav-item${m.key === page ? ' on' : ''}`} onClick={() => onPage(m.key)}>
              <Icon name={m.icon} />
              <span>{m.label}</span>
              {m.key === 'about' && hasUpdate(update) && <span class="nav-dot" aria-label="有新版本" />}
            </button>
          ))}
        </nav>
        <div class="settings-pane">
          {s && page === 'settings' && <GeneralPage s={s} save={save} />}
          {s && page === 'models' && <ModelsPage s={s} save={save} />}
          {page === 'about' && <AboutPage update={update} />}
        </div>
        <IconButton class="modal-close" icon="close" label="关闭" onClick={onClose} />
      </div>
    </div>
  )
}
