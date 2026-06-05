# AI 同声传译助手

> 一款 Windows 桌面端 AI 同声传译应用，将英语音频流实时翻译为中文，以流式字幕形式呈现。

## 功能

- 实时英文语音识别（ASR）→ 流式中文字幕
- 双通道架构：快通道同传 + 慢通道上下文理解
- 基于上下文的自动翻译修正
- 透明悬浮字幕窗，不遮挡任何内容
- 系统音频 + 麦克风双模式
- 演示模式（零 API 成本）
- 多供应商支持（讯飞/阿里云 ASR，DeepSeek/通义千问/智谱 LLM）

## 技术栈

- **桌面框架**: Electron 33
- **前端**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS + Framer Motion
- **状态管理**: Jotai
- **ASR**: 讯飞实时语音转写（可替换）
- **LLM**: DeepSeek V4 Flash（可替换）

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 构建安装包
npm run build
```

## 项目结构

```
├── electron/          # Electron 主进程
│   ├── main.ts        # 入口，窗口管理
│   └── preload.ts     # 预加载脚本
├── src/               # React 渲染进程
│   ├── components/    # UI 组件
│   ├── services/      # 业务服务（ASR、LLM、管线）
│   ├── stores/        # Jotai 状态管理
│   ├── hooks/         # 自定义 Hooks
│   └── types/         # TypeScript 类型定义
└── assets/            # 静态资源
```

## License

MIT
