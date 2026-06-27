# AI 同声传译助手开发定位手册

> 用法：在 VS Code 中打开本文件，`Ctrl + 左键` 点击表格中的链接跳转到对应文件位置。  
> 本文只记录项目关键设计、运行链路和高频修改点，避免散落在代码里反复查找。

## 0. 项目总览

| 模块 | 职责 | 关键入口 |
| --- | --- | --- |
| Electron 主进程 | 创建主窗口、悬浮窗、IPC、凭据加密、屏幕源预取。 | [electron/main.ts:22](electron/main.ts#L22) |
| Electron 预加载 | 通过 `contextBridge` 暴露安全 API 给 React。 | [electron/preload.ts:8](electron/preload.ts#L8) |
| React 入口 | 根据 hash 区分主窗口和 Overlay 窗口。 | [src/App.tsx:5](src/App.tsx#L5) |
| 主窗口 UI | 配置、开始/停止翻译、历史记录、字幕同步。 | [src/components/layout/MainWindow.tsx:24](src/components/layout/MainWindow.tsx#L24) |
| Overlay UI | 接收 IPC 字幕并渲染悬浮字幕窗口。 | [src/components/layout/OverlayWindow.tsx:28](src/components/layout/OverlayWindow.tsx#L28) |
| 核心会话 Hook | 串联音频捕获、ASR、LLM、快慢通道和字幕状态。 | [src/hooks/useTranslationSession.ts:51](src/hooks/useTranslationSession.ts#L51) |
| 快通道 Pipeline | 实时音频到 ASR、分句、preview/final 翻译。 | [src/services/pipeline/channel1-fast.ts:84](src/services/pipeline/channel1-fast.ts#L84) |
| 慢通道 Analyzer | 分析领域、术语、摘要、话题切换并更新上下文。 | [src/services/pipeline/channel2-slow.ts:29](src/services/pipeline/channel2-slow.ts#L29) |

## 1. 端到端数据流

| 阶段 | 数据流 | 代码位置 |
| --- | --- | --- |
| 用户点击开始 | 主窗口先调用 `start()`，再显示 Overlay，确保音频授权仍在用户手势内。 | [src/components/layout/MainWindow.tsx:55](src/components/layout/MainWindow.tsx#L55) |
| 会话启动 | 创建 ASR/LLM provider，创建快通道和慢通道。 | [src/hooks/useTranslationSession.ts:100](src/hooks/useTranslationSession.ts#L100) |
| 音频捕获 | 系统音频或麦克风经 Web Audio 转 PCM16。 | [src/hooks/useAudioCapture.ts:162](src/hooks/useAudioCapture.ts#L162) |
| 音频入队 | PCM chunk 进入 `FastChannelPipeline.processChunk()`。 | [src/hooks/useTranslationSession.ts:275](src/hooks/useTranslationSession.ts#L275) |
| ASR 识别 | `consumeNext()` 从 RingBuffer 取音频并调用 ASR。 | [src/services/pipeline/channel1-fast.ts:208](src/services/pipeline/channel1-fast.ts#L208) |
| interim 处理 | interim 更新 UI 原文，并尝试 preview 翻译。 | [src/services/pipeline/channel1-fast.ts:260](src/services/pipeline/channel1-fast.ts#L260) |
| final 处理 | final 进入正式分句、final 翻译，并喂给慢通道。 | [src/services/pipeline/channel1-fast.ts:284](src/services/pipeline/channel1-fast.ts#L284) |
| 翻译输出 | LLM SSE token 持续回调到字幕状态。 | [src/services/pipeline/channel1-fast.ts:521](src/services/pipeline/channel1-fast.ts#L521) |
| 字幕同步 | 主窗口把 `subtitleStackAtom` 通过 IPC 发给 Overlay。 | [src/hooks/useSubtitleSync.ts:13](src/hooks/useSubtitleSync.ts#L13) |
| Overlay 渲染 | Overlay 接收 payload 后写入本地 atom 并渲染字幕。 | [src/hooks/useSubtitleReceiver.ts:13](src/hooks/useSubtitleReceiver.ts#L13) |

## 2. Electron 与 IPC

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| 主窗口创建 | 创建主控制台窗口，加载 Vite dev server 或 dist 文件。 | [electron/main.ts:22](electron/main.ts#L22) |
| 屏幕源预取 | 预取 `desktopCapturer` 屏幕源，避免 getDisplayMedia 选择器异常。 | [electron/main.ts:50](electron/main.ts#L50) |
| Overlay 创建 | 创建置顶、透明、忽略鼠标事件的字幕悬浮窗。 | [electron/overlay-window.ts:18](electron/overlay-window.ts#L18) |
| Overlay resize | 根据字幕高度重新居中定位悬浮窗。 | [electron/overlay-window.ts:83](electron/overlay-window.ts#L83) |
| IPC 常量 | 所有主/渲染进程通道名集中定义。 | [shared/ipc-channels.ts:2](shared/ipc-channels.ts#L2) |
| Preload API | 暴露 `showOverlay / hideOverlay / saveCredentials / sendSubtitleUpdate` 等 API。 | [electron/preload.ts:8](electron/preload.ts#L8) |
| 字幕 IPC 转发 | 主进程把主窗口字幕 payload 转发给 Overlay。 | [electron/main.ts:123](electron/main.ts#L123) |
| 凭据加密保存 | 使用 Electron `safeStorage` 加密保存配置。 | [electron/main.ts:99](electron/main.ts#L99) |
| 凭据解密加载 | 应用启动时读取并解密本地凭据。 | [electron/main.ts:111](electron/main.ts#L111) |

## 3. React 页面与 UI 结构

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| 路由分流 | `#overlay` 进入悬浮字幕窗口，否则进入主窗口。 | [src/App.tsx:5](src/App.tsx#L5) |
| 主窗口状态接入 | 主窗口读取设置 atom，并接入会话、凭据持久化、字幕同步。 | [src/components/layout/MainWindow.tsx:24](src/components/layout/MainWindow.tsx#L24) |
| 开始/停止控制 | 按钮触发会话开始/停止及 Overlay 显隐。 | [src/components/layout/MainWindow.tsx:55](src/components/layout/MainWindow.tsx#L55) |
| Overlay 状态接入 | Overlay 从 IPC 接收字幕，并读取双语/字号配置。 | [src/components/layout/OverlayWindow.tsx:28](src/components/layout/OverlayWindow.tsx#L28) |
| 字幕栈 | 控制最多展示条数和最短显示时长。 | [src/components/subtitle/SubtitleStack.tsx:14](src/components/subtitle/SubtitleStack.tsx#L14) |
| 单条字幕 | 渲染原文、译文和修正态。 | [src/components/subtitle/SubtitleLine.tsx:14](src/components/subtitle/SubtitleLine.tsx#L14) |
| 修正动画 | final 修正时展示旧译文到新译文的过渡。 | [src/components/subtitle/SubtitleLine.tsx:58](src/components/subtitle/SubtitleLine.tsx#L58) |
| 历史面板 | 展示完整历史字幕记录。 | [src/components/history/HistoryPanel.tsx:10](src/components/history/HistoryPanel.tsx#L10) |
| 滚动摘要卡片 | 展示慢通道写入的 recent summary。 | [src/components/history/SummaryCard.tsx:10](src/components/history/SummaryCard.tsx#L10) |
| 会议纪要卡片 | 展示 stop 后生成的结构化纪要。 | [src/components/history/MeetingMinutesCard.tsx:9](src/components/history/MeetingMinutesCard.tsx#L9) |

## 4. 状态模型

| 状态 | 用途 | 代码位置 |
| --- | --- | --- |
| 字幕栈 | 当前屏幕展示的实时字幕。 | [src/stores/session-store.ts:6](src/stores/session-store.ts#L6) |
| 历史记录 | final 翻译完成后进入历史。 | [src/stores/session-store.ts:9](src/stores/session-store.ts#L9) |
| 会议纪要状态 | stop 后生成纪要的 idle/generating/done/error 状态。 | [src/stores/session-store.ts:20](src/stores/session-store.ts#L20) |
| 双语显示 | 控制是否显示英文原文。 | [src/stores/settings-store.ts:8](src/stores/settings-store.ts#L8) |
| 字幕字号 | 控制 Overlay 字幕大小。 | [src/stores/settings-store.ts:11](src/stores/settings-store.ts#L11) |
| 音频来源 | 系统音频或麦克风。 | [src/stores/settings-store.ts:14](src/stores/settings-store.ts#L14) |
| ASR 配置 | 当前 ASR provider 和凭据。 | [src/stores/settings-store.ts:17](src/stores/settings-store.ts#L17) |
| LLM 配置 | 当前 LLM provider、endpoint、model 和凭据。 | [src/stores/settings-store.ts:20](src/stores/settings-store.ts#L20) |
| Shared Context | 慢通道产出的领域、术语、摘要和话题历史。 | [src/stores/shared-context.ts:36](src/stores/shared-context.ts#L36) |
| Context 写入 API | 慢通道更新 domain/terms/summary/topic。 | [src/stores/shared-context.ts:47](src/stores/shared-context.ts#L47) |
| 字幕 payload 类型 | MainWindow 到 Overlay 的 IPC 数据结构。 | [src/types/subtitle.ts:31](src/types/subtitle.ts#L31) |

## 5. 会话生命周期

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| Hook 入口 | 翻译会话的总编排入口。 | [src/hooks/useTranslationSession.ts:51](src/hooks/useTranslationSession.ts#L51) |
| 创建 provider | `createASRProvider` / `createLLMProvider` 后分别 configure。 | [src/hooks/useTranslationSession.ts:100](src/hooks/useTranslationSession.ts#L100) |
| 复用 LLM 引用 | stop 时先用 LLM 生成会议纪要，再 dispose。 | [src/hooks/useTranslationSession.ts:111](src/hooks/useTranslationSession.ts#L111) |
| 创建慢通道 | `Channel2Analyzer` 与快通道共用同一 LLM provider。 | [src/hooks/useTranslationSession.ts:114](src/hooks/useTranslationSession.ts#L114) |
| 慢通道桥接 | 顶层调用 `useChannelBridge`，把慢通道结果写回 Jotai。 | [src/hooks/useTranslationSession.ts:91](src/hooks/useTranslationSession.ts#L91) |
| 开始会话 | 重置状态、创建 pipeline、预热 ASR、启动音频捕获。 | [src/hooks/useTranslationSession.ts:245](src/hooks/useTranslationSession.ts#L245) |
| ASR 预热 | 与音频授权并行建立 ASR WebSocket。 | [src/hooks/useTranslationSession.ts:283](src/hooks/useTranslationSession.ts#L283) |
| stop 清理 | 停音频、flush、生成纪要、停止 pipeline/analyzer。 | [src/hooks/useTranslationSession.ts:323](src/hooks/useTranslationSession.ts#L323) |
| stop 超时兜底 | LLM 或 flush 卡住时强制释放资源。 | [src/hooks/useTranslationSession.ts:336](src/hooks/useTranslationSession.ts#L336) |

## 6. 音频捕获与 PCM

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| Hook 入口 | 统一管理系统音频/麦克风捕获。 | [src/hooks/useAudioCapture.ts:52](src/hooks/useAudioCapture.ts#L52) |
| 麦克风捕获 | `getUserMedia` 获取麦克风流。 | [src/hooks/useAudioCapture.ts:98](src/hooks/useAudioCapture.ts#L98) |
| 系统音频捕获 | `getDisplayMedia` 获取屏幕共享里的音频流。 | [src/hooks/useAudioCapture.ts:126](src/hooks/useAudioCapture.ts#L126) |
| AudioContext | 以低延迟模式处理输入流。 | [src/hooks/useAudioCapture.ts:162](src/hooks/useAudioCapture.ts#L162) |
| ScriptProcessor | 将 Web Audio buffer 转成 PCM chunk。 | [src/hooks/useAudioCapture.ts:187](src/hooks/useAudioCapture.ts#L187) |
| 首块音频日志 | 记录 `[first_audio_chunk]`。 | [src/hooks/useAudioCapture.ts:203](src/hooks/useAudioCapture.ts#L203) |
| PCM16 转换 | Float32 样本转 16-bit PCM。 | [src/hooks/useAudioCapture.ts:281](src/hooks/useAudioCapture.ts#L281) |
| 静音检测 | 长时间无音频时停止并报错。 | [src/hooks/useAudioCapture.ts:219](src/hooks/useAudioCapture.ts#L219) |

## 7. 快通道 Pipeline

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| Pipeline 配置 | 控制历史长度、强制交付、分句器配置、慢通道回调。 | [src/services/pipeline/channel1-fast.ts:15](src/services/pipeline/channel1-fast.ts#L15) |
| 默认实时参数 | RingBuffer 容量、force delivery、preview 节流参数。 | [src/services/pipeline/channel1-fast.ts:27](src/services/pipeline/channel1-fast.ts#L27) |
| 音频入口 | `processChunk()` 非阻塞接收 PCM 并触发消费。 | [src/services/pipeline/channel1-fast.ts:193](src/services/pipeline/channel1-fast.ts#L193) |
| 消费循环 | 从 RingBuffer 取音频，调用 ASR，分发 interim/final。 | [src/services/pipeline/channel1-fast.ts:208](src/services/pipeline/channel1-fast.ts#L208) |
| 拉取 interim 队列 | 从 ASR provider 拉取 pending interim。 | [src/services/pipeline/channel1-fast.ts:249](src/services/pipeline/channel1-fast.ts#L249) |
| interim 处理 | 更新最新 interim、触发 preview、判断 force delivery。 | [src/services/pipeline/channel1-fast.ts:260](src/services/pipeline/channel1-fast.ts#L260) |
| final 处理 | final 分句、替换 preview、进入正式翻译。 | [src/services/pipeline/channel1-fast.ts:284](src/services/pipeline/channel1-fast.ts#L284) |
| preview 切片 | 根据词数、时间、标点和弱边界提前切出片段。 | [src/services/pipeline/channel1-fast.ts:346](src/services/pipeline/channel1-fast.ts#L346) |
| 强制交付 | ASR 长时间无 final 时把 interim 当作 preview 交付。 | [src/services/pipeline/channel1-fast.ts:418](src/services/pipeline/channel1-fast.ts#L418) |
| 翻译队列 | preview/final 进入队列，保持字幕顺序。 | [src/services/pipeline/channel1-fast.ts:460](src/services/pipeline/channel1-fast.ts#L460) |
| 队列执行 | 串行调用 LLM，避免字幕顺序错乱。 | [src/services/pipeline/channel1-fast.ts:478](src/services/pipeline/channel1-fast.ts#L478) |
| Flush | stop 时把分句器剩余文本送入 final 翻译。 | [src/services/pipeline/channel1-fast.ts:506](src/services/pipeline/channel1-fast.ts#L506) |
| 翻译执行 | 构造请求、消费 SSE token、回调字幕。 | [src/services/pipeline/channel1-fast.ts:521](src/services/pipeline/channel1-fast.ts#L521) |
| 请求上下文 | final/default 请求读取 shared context 和历史句子。 | [src/services/pipeline/channel1-fast.ts:601](src/services/pipeline/channel1-fast.ts#L601) |
| 错误分发 | 统一把内部异常交给 pipeline error callback。 | [src/services/pipeline/channel1-fast.ts:631](src/services/pipeline/channel1-fast.ts#L631) |

## 8. 分句器与缓冲

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| RingBuffer | 音频生产/消费之间的短缓冲，容量小以控制实时性。 | [src/utils/audio-ring-buffer.ts:18](src/utils/audio-ring-buffer.ts#L18) |
| RingBuffer 满处理 | 满时覆盖旧数据，避免无限积压。 | [src/utils/audio-ring-buffer.ts:55](src/utils/audio-ring-buffer.ts#L55) |
| 深拷贝音频帧 | 防止复用 PCM 内存导致缓冲数据被覆盖。 | [src/utils/audio-ring-buffer.ts:65](src/utils/audio-ring-buffer.ts#L65) |
| 分句器默认值 | `PAUSE_MS`、`MAX_BUFFER_MS` 等分句阈值。 | [src/services/pipeline/sentence-segmenter.ts:29](src/services/pipeline/sentence-segmenter.ts#L29) |
| 分句入口 | `push(text, timestamp, isFinal)` 返回本次产出的句子。 | [src/services/pipeline/sentence-segmenter.ts:82](src/services/pipeline/sentence-segmenter.ts#L82) |
| Flush 剩余文本 | stop 或强制交付时清空未完成分句。 | [src/services/pipeline/sentence-segmenter.ts:143](src/services/pipeline/sentence-segmenter.ts#L143) |

## 9. ASR Provider 层

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| ASR 接口 | 所有 ASR provider 必须实现的统一接口。 | [src/services/asr/types.ts:39](src/services/asr/types.ts#L39) |
| ASR 工厂 | 根据配置选择讯飞、阿里云、Deepgram 或自定义 provider。 | [src/services/asr/factory.ts:12](src/services/asr/factory.ts#L12) |
| 队列工具 | 将 ASR result queue 拆成 final 和 pending interim。 | [src/services/provider-utils.ts:30](src/services/provider-utils.ts#L30) |
| 讯飞 ASR | 讯飞实时语音转写实现。 | [src/services/asr/iflytek.ts:65](src/services/asr/iflytek.ts#L65) |
| 讯飞预连接 | 可选预热 WebSocket，失败不阻断 recognize。 | [src/services/asr/iflytek.ts:92](src/services/asr/iflytek.ts#L92) |
| 讯飞音频发送 | `recognize()` 发送 PCM 并返回队列中的 ASRResult。 | [src/services/asr/iflytek.ts:108](src/services/asr/iflytek.ts#L108) |
| ASR ws 日志 | WebSocket 打开时记录 `[asr_ws_open]`。 | [src/services/asr/iflytek.ts:202](src/services/asr/iflytek.ts#L202) |
| 阿里云 ASR | 阿里云实时语音识别实现。 | [src/services/asr/aliyun.ts:69](src/services/asr/aliyun.ts#L69) |
| Deepgram ASR | Deepgram 实时识别实现。 | [src/services/asr/deepgram.ts:51](src/services/asr/deepgram.ts#L51) |
| 自定义 ASR | 兼容自定义 WebSocket ASR 服务。 | [src/services/asr/custom.ts:25](src/services/asr/custom.ts#L25) |

## 10. LLM Provider 层

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| LLM 接口 | 统一定义 translate/analyze/generateMinutes/dispose。 | [src/services/llm/types.ts:125](src/services/llm/types.ts#L125) |
| TranslationRequest | 翻译请求携带 text、context、mode 和历史句子。 | [src/services/llm/types.ts:49](src/services/llm/types.ts#L49) |
| LLM 工厂 | 根据 provider 创建 DeepSeek/Qwen/Zhipu/custom 兼容实现。 | [src/services/llm/factory.ts:25](src/services/llm/factory.ts#L25) |
| OpenAI 兼容实现 | 所有兼容 `/v1/chat/completions` 的 LLM 复用此类。 | [src/services/llm/openai-compat.ts:59](src/services/llm/openai-compat.ts#L59) |
| 流式翻译 | `translate()` 发起 SSE 请求并 yield token。 | [src/services/llm/openai-compat.ts:104](src/services/llm/openai-compat.ts#L104) |
| 慢通道分析 | `analyze()` 非流式返回领域、术语、摘要、话题切换。 | [src/services/llm/openai-compat.ts:131](src/services/llm/openai-compat.ts#L131) |
| 会议纪要 | stop 后基于历史翻译生成结构化纪要。 | [src/services/llm/openai-compat.ts:172](src/services/llm/openai-compat.ts#L172) |
| 请求构造 | 根据 preview/final 控制 max tokens 和 prompt。 | [src/services/llm/openai-compat.ts:253](src/services/llm/openai-compat.ts#L253) |
| SSE 解析 | 解析 `data:` 行并逐 token 累积译文。 | [src/services/llm/openai-compat.ts:280](src/services/llm/openai-compat.ts#L280) |
| prompt 构造 | preview 使用极简 prompt，final 使用上下文和历史。 | [src/services/llm/openai-compat.ts:327](src/services/llm/openai-compat.ts#L327) |
| 分析结果解析 | JSON 解析为 `AnalysisResult`。 | [src/services/llm/openai-compat.ts:430](src/services/llm/openai-compat.ts#L430) |
| 基础翻译 prompt | 正式翻译的通用系统提示。 | [src/services/llm/openai-compat.ts:548](src/services/llm/openai-compat.ts#L548) |
| 分析 prompt | 慢通道分析使用的 JSON prompt。 | [src/services/llm/openai-compat.ts:560](src/services/llm/openai-compat.ts#L560) |
| 纪要 prompt | 会议纪要生成使用的 JSON prompt。 | [src/services/llm/openai-compat.ts:572](src/services/llm/openai-compat.ts#L572) |

## 11. 慢通道与 Shared Context

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| 慢通道配置 | 控制累计多少句触发一次分析。 | [src/services/pipeline/channel2-slow.ts:4](src/services/pipeline/channel2-slow.ts#L4) |
| 慢通道入口 | `Channel2Analyzer` 维护待分析句子和分析历史。 | [src/services/pipeline/channel2-slow.ts:29](src/services/pipeline/channel2-slow.ts#L29) |
| 接收 final 句子 | 快通道 final 分句后调用 `feedSentences()`。 | [src/services/pipeline/channel2-slow.ts:78](src/services/pipeline/channel2-slow.ts#L78) |
| 分析触发日志 | 达阈值输出 `[channel2] slow channel triggered`。 | [src/services/pipeline/channel2-slow.ts:86](src/services/pipeline/channel2-slow.ts#L86) |
| 异步分析 | `runAnalysis()` 不 await，不阻塞快通道字幕输出。 | [src/services/pipeline/channel2-slow.ts:103](src/services/pipeline/channel2-slow.ts#L103) |
| 分析完成 | 成功后记录领域、术语数量、摘要和话题切换。 | [src/services/pipeline/channel2-slow.ts:130](src/services/pipeline/channel2-slow.ts#L130) |
| 快通道接入点 | final 分句后通知慢通道。 | [src/services/pipeline/channel1-fast.ts:303](src/services/pipeline/channel1-fast.ts#L303) |
| 回调异常隔离 | slow feed 失败只打日志，不影响快通道。 | [src/services/pipeline/channel1-fast.ts:451](src/services/pipeline/channel1-fast.ts#L451) |
| Bridge Hook | 订阅 analyzer result，并写入 shared context atoms。 | [src/hooks/useChannelBridge.ts:24](src/hooks/useChannelBridge.ts#L24) |
| Context 更新 | 写入 domain/terms/summary/topicShift。 | [src/hooks/useChannelBridge.ts:36](src/hooks/useChannelBridge.ts#L36) |
| Context 更新日志 | 输出 `[channel2] context updated`。 | [src/hooks/useChannelBridge.ts:59](src/hooks/useChannelBridge.ts#L59) |
| 翻译读取 context | 后续 final 请求读取最新 shared context。 | [src/services/pipeline/channel1-fast.ts:601](src/services/pipeline/channel1-fast.ts#L601) |
| prompt 消费 context | final prompt 使用 domain、terms、recentSummary、history。 | [src/services/llm/openai-compat.ts:339](src/services/llm/openai-compat.ts#L339) |

## 12. 字幕同步与 Overlay

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| 字幕实体 | 每条字幕包含原文、译文、完成态和修正信息。 | [src/types/subtitle.ts:4](src/types/subtitle.ts#L4) |
| MainWindow 推送 | 本地字幕状态变化后发送 IPC payload。 | [src/hooks/useSubtitleSync.ts:13](src/hooks/useSubtitleSync.ts#L13) |
| Overlay 首次更新日志 | 有字幕时记录 `[overlay_update]`。 | [src/hooks/useSubtitleSync.ts:21](src/hooks/useSubtitleSync.ts#L21) |
| Overlay 接收 | 监听 `onSubtitleUpdate` 并写入本地 atom。 | [src/hooks/useSubtitleReceiver.ts:19](src/hooks/useSubtitleReceiver.ts#L19) |
| 可见字幕选择 | 最近两条为主，第三条不足最短展示时间则保留。 | [src/components/subtitle/SubtitleStack.tsx:29](src/components/subtitle/SubtitleStack.tsx#L29) |
| 字幕渲染 | 根据 bilingual 和 fontSize 渲染原文/译文。 | [src/components/subtitle/SubtitleLine.tsx:14](src/components/subtitle/SubtitleLine.tsx#L14) |
| Overlay 窗口尺寸 | OverlayWindow 根据最坏字幕高度设置窗口。 | [src/components/layout/OverlayWindow.tsx:10](src/components/layout/OverlayWindow.tsx#L10) |

## 13. 设置、凭据与连接测试

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| 凭据持久化 Hook | 启动时加载配置，配置变化后保存。 | [src/hooks/useCredentialPersistence.ts:11](src/hooks/useCredentialPersistence.ts#L11) |
| 加载凭据 | 从 preload API 调用主进程解密加载。 | [src/hooks/useCredentialPersistence.ts:22](src/hooks/useCredentialPersistence.ts#L22) |
| 保存凭据 | ASR/LLM 配置变化后写入加密文件。 | [src/hooks/useCredentialPersistence.ts:64](src/hooks/useCredentialPersistence.ts#L64) |
| 连接测试 Hook | 通用测试 provider 凭据有效性。 | [src/hooks/useConnectionTest.ts:24](src/hooks/useConnectionTest.ts#L24) |
| provider 校验 | 调用 `validateCredentials` 并设置测试状态。 | [src/hooks/useConnectionTest.ts:56](src/hooks/useConnectionTest.ts#L56) |
| ASR 设置 | 切换 provider、编辑不同 ASR 凭据。 | [src/components/settings/ASRSettings.tsx:23](src/components/settings/ASRSettings.tsx#L23) |
| ASR 默认配置 | 每个 ASR provider 的默认字段。 | [src/components/settings/ASRSettings.tsx:18](src/components/settings/ASRSettings.tsx#L18) |
| LLM 设置 | 切换 provider、编辑 API Key、endpoint、model。 | [src/components/settings/LLMSettings.tsx:24](src/components/settings/LLMSettings.tsx#L24) |
| LLM 默认配置 | 每个 LLM provider 的默认 endpoint/model。 | [src/components/settings/LLMSettings.tsx:19](src/components/settings/LLMSettings.tsx#L19) |
| 密钥输入 | 本地输入态，blur 后写回 atom。 | [src/components/settings/ApiKeyInput.tsx:15](src/components/settings/ApiKeyInput.tsx#L15) |

## 14. 延迟与调试日志

| 日志点 | 用途 | 代码位置 |
| --- | --- | --- |
| 日志工具 | 首屏关键事件统一计时。 | [src/utils/first-screen-latency.ts:1](src/utils/first-screen-latency.ts#L1) |
| `[start]` | 用户点击开始翻译。 | [src/hooks/useTranslationSession.ts:245](src/hooks/useTranslationSession.ts#L245) |
| `[audio_ready]` | 音频捕获成功。 | [src/hooks/useAudioCapture.ts:118](src/hooks/useAudioCapture.ts#L118) |
| `[first_audio_chunk]` | 第一块 PCM 产生。 | [src/hooks/useAudioCapture.ts:203](src/hooks/useAudioCapture.ts#L203) |
| `[asr_ws_open]` | ASR WebSocket 打开。 | [src/services/asr/iflytek.ts:202](src/services/asr/iflytek.ts#L202) |
| `[first_audio_sent]` | 第一块音频发送给 ASR。 | [src/services/asr/iflytek.ts:121](src/services/asr/iflytek.ts#L121) |
| `[first_asr_interim]` | 第一次收到 ASR interim。 | [src/services/pipeline/channel1-fast.ts:267](src/services/pipeline/channel1-fast.ts#L267) |
| `[first_asr_final]` | 第一次收到 ASR final。 | [src/services/pipeline/channel1-fast.ts:286](src/services/pipeline/channel1-fast.ts#L286) |
| `[force_delivery_triggered]` | interim 被强制交付。 | [src/services/pipeline/channel1-fast.ts:425](src/services/pipeline/channel1-fast.ts#L425) |
| `[preview_translate_start]` | preview 翻译请求开始。 | [src/services/pipeline/channel1-fast.ts:529](src/services/pipeline/channel1-fast.ts#L529) |
| `[llm_request_start]` | LLM 请求开始。 | [src/services/pipeline/channel1-fast.ts:531](src/services/pipeline/channel1-fast.ts#L531) |
| `[first_llm_token]` | 第一个翻译 token 到达。 | [src/services/pipeline/channel1-fast.ts:551](src/services/pipeline/channel1-fast.ts#L551) |
| `[overlay_update]` | 字幕 payload 推送给 Overlay。 | [src/hooks/useSubtitleSync.ts:21](src/hooks/useSubtitleSync.ts#L21) |
| `[channel2] ...` | 慢通道触发、完成、失败、上下文更新。 | [src/services/pipeline/channel2-slow.ts:86](src/services/pipeline/channel2-slow.ts#L86) |

## 15. 构建与发布

| 关键点 | 说明 | 代码位置 |
| --- | --- | --- |
| npm scripts | dev/build/lint/clean 命令。 | [package.json:8](package.json#L8) |
| Vite 配置 | React、Electron main/preload、renderer 插件配置。 | [vite.config.ts:7](vite.config.ts#L7) |
| Electron main 构建 | main 入口输出到 `dist-electron`。 | [vite.config.ts:12](vite.config.ts#L12) |
| Electron preload 构建 | preload 入口输出到 `dist-electron`。 | [vite.config.ts:28](vite.config.ts#L28) |
| 打包配置 | Windows zip 包、图标、产物命名。 | [electron-builder.yml:3](electron-builder.yml#L3) |
| 应用常量 | 应用名、标语、演示视频链接。 | [shared/app-config.ts:4](shared/app-config.ts#L4) |

## 16. 高频修改点

| 需求 | 优先改哪里 |
| --- | --- |
| 调整首屏响应速度 | [src/services/pipeline/channel1-fast.ts:27](src/services/pipeline/channel1-fast.ts#L27) |
| 调整 preview 切片策略 | [src/services/pipeline/channel1-fast.ts:346](src/services/pipeline/channel1-fast.ts#L346) |
| 调整正式分句等待 | [src/services/pipeline/sentence-segmenter.ts:29](src/services/pipeline/sentence-segmenter.ts#L29) |
| 新增 ASR provider | [src/services/asr/types.ts:39](src/services/asr/types.ts#L39) 和 [src/services/asr/factory.ts:12](src/services/asr/factory.ts#L12) |
| 新增 LLM provider | [src/services/llm/types.ts:125](src/services/llm/types.ts#L125) 和 [src/services/llm/factory.ts:25](src/services/llm/factory.ts#L25) |
| 修改翻译 prompt | [src/services/llm/openai-compat.ts:327](src/services/llm/openai-compat.ts#L327) |
| 修改慢通道分析 prompt | [src/services/llm/openai-compat.ts:560](src/services/llm/openai-compat.ts#L560) |
| 修改 Overlay 样式 | [src/components/layout/OverlayWindow.tsx:28](src/components/layout/OverlayWindow.tsx#L28) 和 [src/components/subtitle/SubtitleLine.tsx:14](src/components/subtitle/SubtitleLine.tsx#L14) |
| 修改字幕 IPC payload | [src/types/subtitle.ts:31](src/types/subtitle.ts#L31) |
| 修改凭据保存逻辑 | [src/hooks/useCredentialPersistence.ts:11](src/hooks/useCredentialPersistence.ts#L11) |

## 17. 验证命令

```bash
npx tsc --noEmit
npx vite build
npm run build
```

注意：当前 `npm run lint` 使用 ESLint 9，但项目没有 `eslint.config.*`，会因为配置缺失失败。修 lint 前先补 ESLint flat config。
