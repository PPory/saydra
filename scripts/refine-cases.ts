// Refine regression cases, taken from real dictation failures. Shared by
// eval-refine (Groq) and bench-refine (any OpenAI-compatible provider).
import type { Scene } from '../src/shared/types'

export interface Case {
  raw: string
  scene?: Scene
  mustHave: string[] // substrings the output must keep
  mustNotHave?: string[]
}

export const CASES: Case[] = [
  { raw: '然后这是一个测试,看看做得怎么样。我也不知道说什么,随便说了。', mustHave: ['不知道说什么', '随便说'] },
  {
    raw: '这是一个测试。测试一下新做的这个语言输入法软件的效果。随便测试一下。',
    mustHave: ['语音输入法', '随便测试'],
    mustNotHave: ['语言输入法']
  },
  { raw: '我也不知道说什么,这是人随便说的。', mustHave: ['不知道说什么', '随便说'] },
  {
    raw: 'Hello,这是一个测试。看看这个新语言输入软件的效果怎么样。周四,周四晚上测试。',
    scene: 'chat',
    mustHave: ['Hello', '语音输入', '怎么样', '周四晚上'],
    mustNotHave: ['语言输入']
  },
  { raw: '嗯,那个,就是说我觉得这个方案啊还可以。', mustHave: ['我觉得这个方案', '还可以'], mustNotHave: ['嗯', '那个'] },
  { raw: '我们周三,不对,周四下午开会。', mustHave: ['周四下午开会'], mustNotHave: ['周三'] },
  { raw: '你能帮我查一下明天北京的天气吗?', scene: 'ai', mustHave: ['明天北京的天气'], mustNotHave: ['晴', '度'] },
  {
    raw: '需要准备三个东西,第一是季度报表,第二是预算方案,第三是新产品的演示。',
    scene: 'document',
    mustHave: ['1.', '季度报表', '预算方案', '新产品']
  },
  { raw: '这个功能我觉得还行吧,反正就是随便用用,不用太在意。', scene: 'chat', mustHave: ['还行', '随便用用', '不用太在意'] },
  // held out: not mirrored by the prompt's examples
  { raw: '我们下周去北京出差,顺便看一下客户,其实也没什么大事。', scene: 'chat', mustHave: ['顺便看一下客户', '没什么大事'] },
  { raw: '帮我把这个文档发给王总,嗯,他应该在等着呢。', mustHave: ['发给王总', '他应该在等着'], mustNotHave: ['嗯'] },
  { raw: '这个模型的推理速度很快,但是准确律不太高。', mustHave: ['准确率'], mustNotHave: ['准确律'] },
  { raw: '那个,我刚才说的不太对,应该是三个人,不是四个人。', mustHave: ['三个人'] },
  // layout: steps chained with 先/然后/再 become a list where lists belong, never in chat
  {
    raw: '你帮我把这个项目整理一下先把没用的依赖删掉然后把测试补上再把文档里的启动命令更新一下',
    scene: 'ai',
    mustHave: ['1. ', '2. ', '3. ', '依赖', '测试', '启动命令']
  },
  {
    raw: '今天先去超市买点菜然后回家做饭晚上再看个电影',
    scene: 'chat',
    mustHave: ['超市', '做饭', '电影'],
    mustNotHave: ['1.', '\n']
  },
  { raw: '好的我知道了明天见', mustHave: ['明天见'], mustNotHave: ['\n'] },
  // a correction several clauses later drops the retracted part
  {
    raw: '首页的标题改成红色然后按钮改大一点哦等一下标题不用改了就把按钮改大',
    scene: 'document',
    mustHave: ['按钮'],
    mustNotHave: ['红色']
  },
  { raw: '这个是一点二点五版本修的转化率提高了百分之十五', mustHave: ['1.2.5', '15%'] },
  {
    raw: '上周的周报我看完了整体没问题就是数据那一块需要再核对一下另外下个月的预算你那边什么时候能给我最好这周五之前吧还有招聘的事情也要抓紧现在还缺两个前端',
    scene: 'email',
    mustHave: ['\n\n', '周五', '两个前端'],
    mustNotHave: ['**']
  }
]

export function checkCase(c: Case, out: string): { ok: boolean; missing: string[]; forbidden: string[] } {
  const missing = c.mustHave.filter((s) => !out.includes(s))
  const forbidden = (c.mustNotHave ?? []).filter((s) => out.includes(s))
  return { ok: !missing.length && !forbidden.length, missing, forbidden }
}
