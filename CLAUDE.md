# CLAUDE.md — AI 同声传译助手 编码规范

本项目参加代码评审比赛。每一行代码都将被评委审视。以下原则是**强制性的**，不可妥协。
AI 助手在每一次代码修改时必须遵守本文件的所有规范。

---
### A.1 核心原则

本项目参加代码评审比赛。每一行代码都将被评委审视。以下原则是**强制性的**，不可妥协：

1. **无硬编码（No Hardcoding）**：所有配置值、API 端点、密钥、供应商名称、模型名称、默认语言、超时时间——全部通过配置或环境变量注入。业务代码中出现字符串常量即为不合格。
2. **不冗余（No Redundancy）**：同一个逻辑不在两个地方出现。DRY 原则严格执行。如果你发现自己复制粘贴了代码，停下来抽取公共函数。
3. **不走远路（No Over-engineering）**：用最简单的方案解决当前的问题。不引入不需要的抽象层。不要为了"可能的需求"提前设计。一个 5 行函数能解决的问题，不写 50 行的类。
4. **不写屎山（No Spaghetti）**：每个模块职责单一。函数短小（不超过 50 行为佳）。命名自解释。当嵌套超过三层时，必须深入分析嵌套关系的本质，将其重构为安全合规的扁平化代码，而非简单地继续加深嵌套。
5. **必要中文注释（Mandatory Comments）**：所有公共函数、接口、复杂逻辑、边界处理、非显而易见的决策——必须附简短中文注释说明意图。注释要简洁，说清"为什么"而非"是什么"。不要求逐行注释，但关键节点必须注释。

### A.2 架构纪律

**A.2.1 供应商无关（Provider-Agnostic）**

- 所有外部服务（ASR、LLM）必须通过接口抽象。业务逻辑只依赖接口，不依赖具体实现。
- 添加新供应商 = 新增一个实现该接口的类，不改业务代码一行。
- 接口定义在 `src/services/<domain>/types.ts`，实现在 `src/services/<domain>/<provider>.ts`。
- 使用工厂函数 `createXXXProvider(config)` 根据配置创建对应实例。

**A.2.2 模块化与解耦**

- 每个模块只做一件事。一个模块修改不应引起其他模块的连锁修改。
- 模块间通过接口通信，不通过全局变量通信。
- 共享状态通过 Jotai atom，不通过 prop drilling 或全局 window 对象。
- Electron 主进程和渲染进程通过 IPC 通信，IPC 通道名统一定义为常量。

**A.2.3 前后端同步**

- IPC 接口定义在共享类型文件中，主进程和渲染进程引用同一类型定义。
- 状态变更从主进程到渲染进程是单向数据流：IPC push → atom update → React re-render。
- 不在渲染进程中直接调用 Node.js API，全部通过 IPC 桥接。

### A.3 代码风格强制

```typescript
// ✅ 正确：接口抽象，依赖注入
class TranslationPipeline {
  constructor(
    private asr: ASRProvider,     // 依赖接口
    private llm: LLMProvider,     // 依赖接口
    private context: ContextManager
  ) {}
}

// ❌ 错误：硬编码供应商
class TranslationPipeline {
  private asr = new IFlyTekASR('hardcoded-key');  // 硬编码！
  private llm = new DeepSeekLLM('sk-hardcoded');  // 硬编码！
}

// ✅ 正确：配置驱动
const ASR_ENDPOINTS: Record<ASRProviderType, string> = {
  iflytek: 'wss://rtasr.xfyun.cn/v1/ws',
  aliyun: 'wss://nls-gateway.aliyuncs.com/ws/v1',
};
// 使用时：new WebSocket(ASR_ENDPOINTS[config.provider])

// ❌ 错误：在函数体内硬编码 URL
const ws = new WebSocket('wss://rtasr.xfyun.cn/v1/ws'); // 硬编码！

// ✅ 正确：类型安全，无 any
function processResult(result: ASRResult): SubtitleEntry { ... }

// ❌ 错误：使用 any 逃避类型检查
function processResult(result: any): any { ... }

// ✅ 正确：单元职责清晰，有关键注释
/** 判定当前缓冲段是否满足上屏交付条件 */
function isDeliveryReady(buffer: AudioBuffer): boolean {
  return hasSentenceEnd(buffer) || isBufferFull(buffer) || hasTopicShift(buffer);
}

// ❌ 错误：一个函数做太多事，且无注释说明
function processAudioAndTranslateAndRender(buffer: AudioBuffer): void {
  // 300 行代码混在一起，没有任何注释...
}
```

### A.4 UI 强制规范

- **无黑框**：字幕窗口背景色 `#00000000`（完全透明），`transparent: true`。
- **无遮挡**：字幕文字下方使用 `backdrop-filter: blur()` 半透明底栏，不遮挡下方视频内容。
- **字号合理**：默认 18px，最大不超过 28px。不用 px 写死，使用 CSS 变量或 Tailwind 的 text 类。
- **鼠标穿透**：字幕覆盖层设置 `pointer-events: none`，点击事件透传。
- **动画流畅**：使用 `will-change: transform` 优化动画性能。动画时长不超过 300ms。
- **响应式边界**：窗口最小 300px 宽，字幕过长时自动换行不截断。

### A.5 边界处理清单

每个函数必须考虑以下边界：

| 边界 | 处理方式 |
|---|---|
| 空输入 / null / undefined | 提前返回或使用默认值 |
| 网络断开 | 显示明确错误提示，自动重连（指数退避） |
| API 返回异常格式 | try-catch + Zod schema 校验 |
| 音频设备被拔出 | 优雅降级，提示用户检查设备 |
| 并发调用 | 使用 AbortController 取消旧请求 |
| 内存泄漏 | 事件监听在 cleanup 中移除，WebSocket 在组件卸载时关闭 |
| API Key 过期 | 捕获 401/403，提示用户更新密钥 |

### A.6 提交前自查

每次 `git commit` 前，AI 助手必须自查：

1. [ ] 有没有硬编码的字符串常量？（检查 URL、密钥、供应商名、模型名）
2. [ ] 新增的外部服务是否通过接口抽象？
3. [ ] 有没有复制粘贴的代码块？
4. [ ] 函数是否超过 50 行？是否可以用更小的函数组合？
5. [ ] 嵌套超过三层时是否已深入分析嵌套关系并重构为扁平化代码？
6. [ ] 公共函数、接口、复杂逻辑是否有关键中文注释？
7. [ ] 有没有 `any` 类型？
8. [ ] 事件监听/WebSocket/timer 是否有对应的清理逻辑？
9. [ ] IPC 通信的类型定义是否在主进程和渲染进程共享？
10. [ ] UI 是否有黑框或遮挡内容？
11. [ ] 边界情况是否处理（空值、断网、异常响应）？

### A.7 禁止事项

- ❌ 禁止在业务代码中写死供应商名称（如 `'iflytek'`, `'deepseek'` 出现在 pipeline 代码中）
- ❌ 禁止使用 `any` 类型（除非适配第三方无类型库，需注释说明原因）
- ❌ 禁止遗留 `console.log` 调试日志（使用统一的 logger 模块）
- ❌ 禁止在渲染进程直接调用 Node.js / Electron 原生 API
- ❌ 禁止注释掉的代码块——删除它们，Git 历史会记住
- ❌ 禁止在组件中直接调用 API（必须通过 service 层）

---

### A.8 PR 提交规范

每个 PR 只做一件事，粒度要细。大功能拆分为多个独立 PR 分步提交。每个 PR 的 commit 必须包含以下三部分：

**① 标题**：一句话说明本 PR 新增/修改了什么（中文，简洁明确）。

**② 功能描述**：说明该功能的作用与使用方式，让评委一眼看懂这个 PR 的价值。

**③ 实现思路**：简要说明技术选型或核心实现逻辑，帮助评委理解代码结构。

**PR 粒度要求**：
- 一个 PR 只实现或修改单一功能
- 鼓励尽可能小、粒度尽可能细的 PR
- 大功能必须拆分为多个独立 PR 分步提交
- PR 合并后主分支代码需保持可运行状态
- 禁止临尾一次性导入所有代码，commit 时间戳必须分布在开发周期内
- **仓库只含核心代码**：push 时只提交项目源代码、配置文件、README。严禁 push 任何与比赛、评委、评审规则、提交规范相关的文档或内容（如方案设计文档中包含比赛评分标准、提交规则等内容的部分不应出现在仓库中）。方案文档仅本地保留
