# Saydra

Windows 语音输入工具：按一下**右 Alt** 开始说话，再按一下结束，整理好的文字自动粘贴到光标处。口头禅、改口、标点都会帮你处理好。

不用注册，不用订阅，开源免费。语音默认在你自己电脑上识别。

> 这是个人业余项目，不保证回复 issue，会根据个人情况处理；PR 不一定会合并。欢迎 fork 了自己改。

## 下载安装

1. 打开 [Releases](https://github.com/PPory/saydra/releases/latest)，下载 `Saydra-Setup-x.x.x.exe`。以后有新版本，Saydra 会自己提示，点「重启更新」就行。
2. 双击安装。如果出现蓝色的「Windows 已保护你的电脑」，点**更多信息** → **仍要运行**。弹这个提示是因为安装包没有购买代码签名证书，软件本身没有问题。
3. 第一次打开时，跟着引导连接一个 AI 服务，用来整理文字。二选一：
   - **Groq**：免费。在 [console.groq.com/keys](https://console.groq.com/keys) 注册后创建一个 key，粘贴进去。在国内需要能访问外网的网络环境。
   - **其他 AI 服务**：DeepSeek、通义千问、Kimi、智谱、硅基流动、OpenAI 选好服务商，粘贴你自己的 API key 就行，模型会自动选好；其他兼容 OpenAI 接口的服务也能手填地址。国内网络可以直接用。

更新时直接下载新版覆盖安装即可，设置、历史记录和词典都会保留。

## 怎么用

| 按键 | 作用 |
|---|---|
| 右 Alt | 说话，文字粘贴到光标处（按一下开始、再按一下结束，也可以按住说、松开结束） |
| 右 Alt + 右 Shift | 说中文，输出翻译后的文字（目标语言在设置里选） |
| 右 Alt + 空格 | 问任何问题；先选中一段文字再问，可以直接改写它 |
| Esc | 取消当前这次 |

- 常用的人名、产品名、专业词可以加进**词典**，识别会按你写的形式输出。总被听错的词，可以在词典里填上它「常被识别成」的写法（比如 `git` ← `get`），以后会直接替换。
- 快捷键可以在设置里改。

## 电脑配置要求

普通电脑就能用，不需要显卡，也不需要高配。

| | 要求 |
|---|---|
| 系统 | Windows 10 / 11（64 位） |
| 内存 | 待机约占 450MB（任务管理器里看到的）；8GB 内存的电脑可以放心用，4GB 也能用 |
| 硬盘 | 安装后约 650MB |
| 处理器 | 近几年的普通笔记本、台式机都可以 |
| 显卡 | 不需要 |

语音识别在你电脑上用 CPU 完成。实测一台 2020 年的笔记本（Ryzen 7 4800H），说 10 秒话不到 1 秒就识别完了。电脑配置低一些，只是多等一两秒，不会跑不动。

如果电脑实在很旧、或者内存很紧张：打开 **设置 → 模型服务 → 语音识别**，改成「云端识别（硅基流动，免费，省内存）」。它和本机识别用的是同一个模型，准确度一样，但不占那约 300MB 内存；硅基流动国内直连、免费，在 [cloud.siliconflow.cn](https://cloud.siliconflow.cn/account/ak) 注册就能拿 key。改完重启一次 Saydra 内存才会降下来。

## 数据去哪了

Saydra 没有自己的服务器，没有账号，没有统计和遥测。它只会连这几个地方：**Groq**、**你自己在设置里填的 AI 服务**，选了云端识别时的**硅基流动**，以及检查更新时的 **GitHub**（可以在设置里关掉自动检查）。

| 数据 | 去哪 |
|---|---|
| 录音 | 默认在你电脑上识别。识别改成云端时会发给你选的服务（硅基流动或 Groq）。填了 Groq key 时，每段录音还会同时发给 Groq 再听一遍，句子里有英文时用来纠正英文词（不填 Groq key 就不会发） |
| 识别出的文字 | 发给你选的 AI 服务整理（去口头禅、补标点），一起发送的还有当前应用名、窗口标题，以及输入框里光标前最多 500 字，让整理结果更贴合上下文 |
| 选中的文字 | 只在「问任何问题」时，发给你选的 AI 服务 |
| 历史记录、词典、设置 | 只存在你电脑上，API key 用 Windows 系统加密保存 |

为什么需要这些权限：
- **监听键盘**：只为了识别快捷键（右 Alt 等），不记录你打的字。
- **读取输入框文字**：判断文字有没有粘贴成功；给整理提供上下文；你手动改了识别结果后，自动把改对的词加进词典。
- **剪贴板**：粘贴时临时借用，粘完就恢复成原来的内容。

代码都在这个仓库里，可以自己检查。

## 从源码构建

需要 Node.js 22 及以上版本。

```bash
npm install
# 下载本地识别模型（约 230MB），解压到 data/models/
curl -L -o model.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2
mkdir -p data/models && tar -xjf model.tar.bz2 -C data/models
npm run dev    # 开发模式运行
npm run dist   # 打安装包，输出到 output/installer/
```

`npm run typecheck` 做类型检查，`npm run test:*` 跑各项单元测试，见 `package.json`。

## 致谢

- 本地语音识别用的是 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)（Apache-2.0）。
- 识别模型是 [WSYue-ASR](https://huggingface.co/ASLP-lab/WSYue-ASR) 的 SenseVoice 版本（Apache-2.0），它基于 FunAudioLLM 的 [SenseVoice Small](https://huggingface.co/FunAudioLLM/SenseVoiceSmall)（[FunASR 模型许可证](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)）。
- 交互设计受 [Typeless](https://www.typeless.com) 启发。Saydra 是独立的个人项目，与 Typeless 没有任何关系，也不是它的官方产品。

## 许可证

[MIT](LICENSE)
