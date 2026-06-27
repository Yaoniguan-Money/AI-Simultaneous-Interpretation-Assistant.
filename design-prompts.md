# AI 同声传译助手 — 交互逻辑与功能设计

## 整体结构

应用有两个 Electron 窗口——主控制窗口 + 字幕悬浮窗。主窗口内部有多个视图，通过状态切换（非 URL 路由）。

```
主控制窗口 (BrowserWindow, 420×600)
├── 主视图（默认）
├── API 设置视图
├── 翻译历史视图
└── 演示模式视图

字幕悬浮窗 (BrowserWindow, 透明置顶)
└── 字幕堆叠（始终显示最近 2 条）
```

主窗口内四个视图之间通过状态切换（`activeView: 'main' | 'settings' | 'history' | 'demo'`），不是独立页面。

---

## 视图一：主视图

用户打开应用时首先看到的界面。

### 显示的 UI 元素

| 元素 | 类型 | 说明 |
|---|---|---|
| 应用标题 | 文本 | "AI Simultaneous Interpreter" |
| 应用副标题 | 文本 | "Real-time translation · Streaming subtitles · Auto-correction" |
| 音频源选择 | 两个可点击卡片 | "System Audio" / "Microphone"，点击切换选中态。选中 = 白底黑边，未选中 = 灰底 |
| 开始翻译按钮 | 按钮 | 黑色实心主按钮，有 disabled 状态 |
| 停止翻译按钮 | 按钮 | 灰色次按钮，有 disabled 状态 |
| 双语字幕开关 | 复选框 | 勾选 = 开启双语模式（浮窗显示原文 + 译文），默认关闭 |
| 状态栏 | 文本区域 | 空的或被占用的显示区 |
| 翻译历史入口 | 可点击卡片 | 点击切换到「翻译历史视图」 |
| API 设置入口 | 可点击卡片 | 点击切换到「API 设置视图」 |
| 演示模式入口 | 可点击卡片 | 点击切换到「演示模式视图」 |
| 版本号 | 文本 | "v1.0.0"，点击加载版本号（已有功能，调用 `getVersion` IPC） |

### 状态与交互逻辑

**状态 A：API Key 未配置（asrConfigAtom === null 或 llmConfigAtom === null）**

- 状态栏显示黄色警告：`API Key 未配置，请前往「API 设置」配置`
- 「开始翻译」按钮 disabled（灰色不可点）
- 「停止」按钮 disabled
- 用户只能点击「API 设置入口」卡片去配置密钥

**状态 B：API Key 已配置，未在翻译**

- 状态栏为空
- 「开始翻译」按钮 enabled
- 「停止」按钮 disabled
- 「音频源选择」可切换
- 「双语字幕开关」可切换

**状态 C：正在翻译中（isTranslating === true）**

- 状态栏显示绿色呼吸灯 + "● Translating"
- 「开始翻译」按钮 disabled
- 「停止」按钮 enabled
- 「音频源选择」和「双语字幕开关」仍然可切换（实时生效）
- 如果管线产生错误，状态栏显示红色错误文字

**「开始翻译」按钮点击流程**：
1. `window.electronAPI.showOverlay()` — IPC 调用主进程创建/显示字幕悬浮窗
2. `useTranslationSession.start()` — 创建 ASR/LLM 实例 → 创建 FastChannelPipeline → 启动管线 → 启动音频捕获 → PCM 数据流入管线 → 翻译结果写入 subtitleStackAtom → 浮窗订阅 atom 自动渲染
3. 如果第一步或第二步失败（如 API 错误、音频设备缺失），状态栏显示红色错误，按钮恢复 enabled

**「停止翻译」按钮点击流程**：
1. `useTranslationSession.stop()` — 停止音频捕获 → 停止管线 → 清空字幕
2. `window.electronAPI.hideOverlay()` — IPC 调用主进程隐藏悬浮窗

**「音频源选择」点击流程**：
- 立刻切换 `audioSource` 状态
- 如果正在翻译中（状态 C），新的音频源将在下次 `start()` 时生效（需要停止再重新开始）
- 如果未翻译（状态 B），点击即刻切换

**「双语字幕开关」点击流程**：
- 立刻切换 `bilingualAtom`
- 浮窗的 SubtitleStack 订阅了这个 atom，开关后立刻看到效果——开启时显示原文行，关闭时不显示

**菜单卡片点击流程**：
- 「翻译历史入口」→ 设置 `activeView = 'history'`
- 「API 设置入口」→ 设置 `activeView = 'settings'`
- 「演示模式入口」→ 设置 `activeView = 'demo'`

---

## 视图二：API 设置视图

用户在主视图点击「API 设置入口」后进入。上方有「← 返回」按钮回到主视图。

### 显示的两个配置区

**ASR 配置区（上半部）**：

| 元素 | 类型 | 说明 |
|---|---|---|
| 区标题 | 文本 | "SPEECH RECOGNITION (ASR)" |
| 提供商选择 | 三个可点击卡片 | "iFlyTek" / "Aliyun" / "Deepgram" / "Custom"。选中态白底黑边，未选中灰底。点击切换 `asrConfigAtom` 的 `provider` 字段 |
| App ID 输入框 | 文本输入 | 等宽字体，明文。对应 `credentials.appId` |
| API Secret 输入框 | 密码输入 | 等宽字体，遮罩显示（●●●●）。对应 `credentials.apiSecret`。可点击眼睛图标切换明文/遮罩 |
| 自定义端点输入框 | 文本输入 | 仅在选择 "Custom" 或 "Aliyun" 时显示。对应 `endpoint` 字段 |
| 测试连接按钮 | 按钮 | 点击 → 调用 `asr.validateCredentials()` → 成功后显示绿色徽章 "Connected"，失败显示红色 "Failed" |
| 连接状态徽章 | 胶囊标签 | 无 = 未测试，绿色 "Connected"，红色 "Failed" |

**LLM 配置区（下半部）**：

| 元素 | 类型 | 说明 |
|---|---|---|
| 区标题 | 文本 | "TRANSLATION (LLM)" |
| 提供商选择 | 可点击卡片 | "DeepSeek" / "Qwen" / "Zhipu GLM" / "Custom" |
| API Key 输入框 | 密码输入 | 对应 `credentials.apiKey` |
| 模型名输入框 | 文本输入 | 对应 `model` 字段，默认 "deepseek-chat" |
| 自定义端点输入框 | 文本输入 | 仅在选择 "Custom" 时显示 |
| 测试连接按钮 + 状态徽章 | 同上 | 同上 |

### 交互逻辑

- **输入框失焦**：立刻写入对应的 Jotai atom（`asrConfigAtom` / `llmConfigAtom`）。无「保存」按钮——实时写入。
- **测试连接按钮**：调用对应 Provider 的 `validateCredentials()`。这是一个异步操作（发真实 API 请求），按钮显示 loading 态，完成后显示绿色/红色徽章。徽章保留 5 秒后自动消失。
- **提供商切换**：切换卡片选中态时，输入框区域根据新提供商的要求变化。例如切到 "Custom" 时多出一个「自定义端点」输入框，切到 "iFlyTek" 时不显示 API Key 字段（讯飞只需要 App ID + Secret）。
- **← 返回按钮**：设置 `activeView = 'main'`。如果刚才修改了任何输入框，atom 已经更新，主视图的状态栏会根据新配置更新（从"未配置"变为已配置，或反过来）。

### 不同提供商的输入字段差异

| 提供商 | 需要的字段 |
|---|---|
| iFlyTek | App ID, API Secret |
| Aliyun | AccessKey ID, AccessKey Secret, 自定义端点 |
| Deepgram | API Key |
| Custom | 自定义端点 + 自定义字段 |
| DeepSeek | API Key, Model（可选，默认 deepseek-chat） |
| Qwen | API Key, 自定义端点 |
| Zhipu GLM | API Key |
| Custom | 自定义端点 + API Key + Model |

---

## 视图三：翻译历史视图

用户在主视图点击「翻译历史入口」后进入。上方有「← 返回」按钮。

### 显示的 UI 元素

| 元素 | 类型 | 说明 |
|---|---|---|
| 返回按钮 | 按钮 | "← 返回"，回到主视图 |
| 历史条目列表 | 可滚动列表 | 每条翻译记录的时间戳 + 中文译文 + 英文原文。滚动时加载更多 |
| Channel 2 摘要卡片 | 卡片 | 显示最近一次分析的领域/术语/摘要 |
| 复制全部按钮 | 按钮 | 复制所有历史记录到剪贴板 |
| 导出 Markdown 按钮 | 按钮 | 导出为 `.md` 文件 |

### 交互逻辑

- **历史数据来源**：目前 `subtitleStackAtom` 只存最近 N 条（运行时），停止翻译后被清空。PR14 需要新增一个持久化的 `historyAtom`，存满全部历史（不随 stop 清空）。PR14 实现后，历史视图从这个 atom 读取。
- **无历史时**：显示空状态提示「暂无翻译记录，开始翻译后此处将显示历史」。
- **Channel 2 摘要卡片**：仅当 Channel 2 分析器运行过至少一次时才显示。无分析时显示「暂无分析摘要」。
- **复制全部**：将所有条目的时间戳 + 中文译文拼接为文本，写入剪贴板。
- **导出 Markdown**：将历史格式化为 Markdown（时间戳 + 引用块译文），通过 Electron 的 `dialog.showSaveDialog` 保存为 `.md` 文件。
- **← 返回按钮**：设置 `activeView = 'main'`。

---

## 视图四：演示模式视图

用户在主视图点击「演示模式入口」后进入。上方有「← 返回」按钮。

### 显示的 UI 元素

| 元素 | 类型 | 说明 |
|---|---|---|
| 返回按钮 | 按钮 | "← 返回" |
| 演示列表 | 卡片列表 | 每个内建演示的视频缩略图 + 标题 + 时长 |
| 演示播放器 | 视频 + 字幕叠加 | 点击某个演示后出现，包含播放/暂停/进度条 |

### 交互逻辑

- **演示列表**：列出 2-3 个内建演示包（每个含 video.mp4 + subtitles.json + corrections.json）。
- **点击某个演示**：打开内建播放器，加载视频文件。同时加载预计算的 `subtitles.json`（包含时间轴、原文、译文、修正事件）。播放器按时间轴驱动字幕渲染，展示打字机效果 + 修正动画。
- **播放器控件**：播放/暂停按钮 + 进度条 + 关闭按钮（X）。
- **零 API 调用**：全程离线。不检查 asrConfigAtom/llmConfigAtom 是否配置。
- **即使密钥未配置也能使用**：用户可以完全没有 API Key，依然能在这个视图体验完整的打字机 + 修正动画效果。
- **← 返回按钮**：停止播放，设置 `activeView = 'main'`。

---

## 字幕悬浮窗（独立窗口）

不属任何视图，是一个独立的 Electron BrowserWindow。

### 显示的元素

| 元素 | 说明 |
|---|---|
| 当前句翻译 | 大字（18px）白色加粗，居中。来自 subtitleStackAtom 的最新一条，`isComplete: false` 时文字带轻微透明度表示"还在流式接收中" |
| 上一句翻译 | 小字（14px）60% 透明白色，居中。来自 subtitleStackAtom 的倒数第二条 |
| 英文原文（可选）| 仅双语开关开启时显示。小字（12px）35% 透明白色，在当前句上方 |
| 修正标记 | 当有修正事件发生时，底部短暂出现 "✎ 根据上下文已修正" 淡灰色标记，2 秒后自动消失 |

### 交互逻辑

- **何时出现**：主视图点击「开始翻译」→ IPC `overlay:show` → 主进程创建/显示浮窗。
- **何时隐藏**：点击「停止翻译」→ IPC `overlay:hide` → 浮窗隐藏（但保持 BrowserWindow 存在，下次 show 复用）。
- **何时显示内容**：`subtitleStackAtom` 有数据时自动渲染。原子空时浮窗为不可见的空 div。
- **双语开关切换**：主视图的复选框切换 `bilingualAtom` → 浮窗订阅此 atom → 原文行立刻出现/消失。不经过 IPC，纯 Jotai 响应式更新。
- **全屏兼容**：浮窗 `alwaysOnTop: true`。浏览器全屏（F11）时浮窗正常覆盖在最上层。DirectX 独占全屏（某些游戏/播放器）时浮窗不可见，这是操作系统级限制。
- **位置**：屏幕底部居中（`y = screenHeight - 100 - 40`）。窗口 800×100px。用户可以通过拖动字幕区域来移动浮窗位置（短暂禁用鼠标穿透，拖动结束后重新启用穿透）。

### 数据来源
- `subtitleStackAtom` — 由 `useTranslationSession` Hook 中的管线回调写入
- `bilingualAtom` — 由主视图的复选框写入

---

## 数据流总览

```
                   ┌─────────────────┐
                   │  settings-store │
                   │  asrConfigAtom  │─── API 设置视图写入，主视图/useTranslationSession 读取
                   │  llmConfigAtom  │─── API 设置视图写入，主视图/useTranslationSession 读取
                   │  bilingualAtom  │─── 主视图写入，浮窗/SubtitleStack 读取
                   └─────────────────┘

                   ┌─────────────────┐
                   │  session-store  │
                   │ subtitleStackAtom│── useTranslationSession 管线回调写入，浮窗/SubtitleStack 读取
                   │  historyAtom    │── (PR14 新增) translateSession 结束后写入，历史视图读取
                   └─────────────────┘

                   ┌─────────────────┐
                   │ shared-context  │
                   │ domainAtom etc. │── Channel2Analyzer 写入，FastChannelPipeline 读取
                   └─────────────────┘
```

---

## 视图切换状态机

```
App 启动
  │
  └─ activeView = 'main'（默认）
       │
       ├─ 点击「API 设置入口」→ activeView = 'settings'
       │      │
       │      └─ 点击「← 返回」→ activeView = 'main'
       │
       ├─ 点击「翻译历史入口」→ activeView = 'history'
       │      │
       │      └─ 点击「← 返回」→ activeView = 'main'
       │
       ├─ 点击「演示模式入口」→ activeView = 'demo'
       │      │
       │      └─ 点击「← 返回」→ activeView = 'main'
       │
       └─ 点击「开始翻译」→ 浮窗出现（不改变 activeView）
              │
              └─ 点击「停止翻译」→ 浮窗隐藏（不改变 activeView）
```

主视图始终显示音频源选择 + 开始/停止按钮 + 菜单卡片。视图切换只改变下半部分内容区域。

---

## 主视图三种状态的 UI 差异

```
状态 A: 未配置
┌──────────────────────┐
│ 标题 + 副标题         │
│ 音频源: ●系统 ○麦克风 │
│ [开始翻译]禁用 [停止]禁用│
│ □ 双语字幕            │
│ ⚠ API Key 未配置      │ ← 黄色警告
│ ─────────────────── │
│ 翻译历史    >        │
│ API 设置    >        │ ← 用户应该点这个
│ 演示模式    >        │
└──────────────────────┘

状态 B: 已配置，待翻译
┌──────────────────────┐
│ 标题 + 副标题         │
│ 音频源: ●系统 ○麦克风 │
│ [▶ 开始翻译] [停止]禁用│
│ □ 双语字幕            │
│                      │ ← 无警告
│ ─────────────────── │
│ 翻译历史    >        │
│ API 设置    >        │
│ 演示模式    >        │
└──────────────────────┘

状态 C: 翻译中
┌──────────────────────┐
│ 标题 + 副标题         │
│ 音频源: ●系统 ○麦克风 │
│ [开始翻译]禁用 [⏹ 停止]│
│ □ 双语字幕            │
│ ● Translating        │ ← 绿色状态灯
│ ─────────────────── │
│ 翻译历史    >        │
│ API 设置    >        │
│ 演示模式    >        │
└──────────────────────┘
```
