# GEMINI.md — AI Simultaneous Interpreter Project Context

## What This Project Is

A Windows Electron desktop app that does real-time English-to-Chinese simultaneous interpretation.
Audio input (system/mic) → ASR → sentence segmentation → LLM translation → transparent subtitle overlay.

**Competition project** — code quality, architecture, and PR discipline matter as much as functionality.

## Current Progress

```
PR1  ✅ Scaffold       Electron + React + Vite + TypeScript + Tailwind
PR2  ✅ ASR Interface  ASRProvider interface + iFlyTek REST API implementation
PR3  ✅ LLM Interface  LLMProvider interface + DeepSeek OpenAI-compatible SSE streaming
PR4  ✅ Audio Capture  useAudioCapture hook (microphone → Int16Array PCM)
PR5  ✅ Segmenter      SentenceSegmenter + Jotai shared context atoms
PR6  ✅ Channel 1      FastChannelPipeline (audio→ASR→segment→LLM→callback)
PR7  ✅ Channel 2      Channel2Analyzer (domain/terms/summary/topic-shift detection)
PR8  ✅ Bridge         useChannelBridge hook (Channel 2 → Jotai atoms → Channel 1)
PR9  ✅ Correction     CorrectionEngine (trigger strategy: every N sentences, re-evaluate oldest)
PR10 ✅ Overlay Window  Transparent always-on-top click-through BrowserWindow + bilingual toggle
PR11 ✅ Subtitle Render SubtitleStack/SubtitleLine/CorrectionBadge with Framer Motion animations
────────────────────────────────────────────────────────────────────────────────────────
PR12 ⬜ Main Window UI    Polish the control panel with the new design system
PR13 ⬜ API Key Mgmt      Credential encryption + multi-provider switching
PR14 ⬜ History Sidebar   Translation history panel + Channel 2 summary card
PR15 ⬜ Demo Mode         Offline demo with pre-recorded video + pre-computed subtitles
PR16 ⬜ More Providers    Aliyun ASR + Qwen/Zhipu LLM + custom OpenAI-compatible endpoint
PR17 ⬜ Build & Package   electron-builder config + auto-update + final integration
```

## Your Task (PR12 through PR17)

You are implementing the frontend UI for this app. The backend services (ASR, LLM, pipeline, stores) are already complete. Your job is to build the React components that connect to them.

### Design Direction

4 mockup HTML files in the project root define the visual direction:
- `design-01-empty.html` — Initial main window (white + frosted glass, audio source toggle, start button, menu cards)
- `design-02-settings.html` — API settings (provider cards, key inputs, test connection badges)
- `design-03-history.html` — Translation history + Channel 2 summary card
- `design-04-inuse.html` — In-use mode with subtitle overlay on video content

**Key aesthetic**: White backgrounds + high-transparency frosted glass (`backdrop-filter: blur()`), clean typography, minimal borders, no heavy shadows, no gradients.

### Code Rules (also in CLAUDE.md)

1. **No hardcoding**: All endpoints, keys, vendor names, model names, timeouts come from config
2. **Provider-agnostic**: Business logic depends on interfaces (ASRProvider, LLMProvider), never concrete classes
3. **No `any` types**: TypeScript strict mode, zero `any`
4. **No `console.log`**: Use structured error handling, not debug logs
5. **Functions ≤ 50 lines**: Break down longer functions
6. **Chinese comments** on public APIs, complex logic, and non-obvious decisions
7. **IPC through contextBridge**: Renderer never calls Node.js directly
8. **UI rules**: No black frames, transparent overlays, mouse passthrough, Tailwind text classes only

## Architecture

```
src/
├── components/
│   ├── layout/
│   │   ├── MainWindow.tsx      ← PR12: Redesign with new aesthetic
│   │   └── OverlayWindow.tsx   ← Done (PR10)
│   ├── subtitle/              ← Done (PR11)
│   │   ├── SubtitleLine.tsx
│   │   ├── SubtitleStack.tsx
│   │   └── CorrectionBadge.tsx
│   ├── settings/              ← PR13: API key input components
│   ├── history/               ← PR14: History panel + summary card
│   └── demo/                  ← PR15: Demo player
├── hooks/
│   ├── useAudioCapture.ts     ← Done (PR4)
│   └── useChannelBridge.ts    ← Done (PR8)
├── services/
│   ├── asr/                   ← Done (PR2)
│   ├── llm/                   ← Done (PR3)
│   └── pipeline/              ← Done (PR5-9)
├── stores/
│   ├── settings-store.ts      ← bilingualAtom (PR10)
│   ├── session-store.ts       ← subtitleStackAtom (PR11)
│   └── shared-context.ts      ← Channel 2 → Channel 1 context atoms (PR5)
├── types/
│   ├── subtitle.ts            ← SubtitleEntry type
│   └── index.ts               ← IPC channels, AudioSource, etc.
├── App.tsx                    ← Hash router (#overlay → OverlayWindow, else MainWindow)
└── vite-env.d.ts              ← ElectronAPI type declarations

electron/
├── main.ts                    ← Window management + IPC handlers
├── preload.ts                 ← contextBridge API exposure
└── overlay-window.ts         ← Overlay BrowserWindow factory

shared/
├── ipc-channels.ts            ← IPC channel name constants
└── app-config.ts              ← APP_NAME, APP_TAGLINE constants
```

## Key Interfaces (what you connect to)

```typescript
// ASR — already implemented, you just configure and call
interface ASRProvider {
  configure(config: ASRConfig): Promise<void>;
  recognize(audio: Buffer): Promise<ASRResult>;
  dispose(): void;
}

// LLM — already implemented
interface LLMProvider {
  configure(config: LLMConfig): Promise<void>;
  translate(request: TranslationRequest): AsyncGenerator<TranslationResult>;
  analyze(sentences: string[], history: string[]): Promise<AnalysisResult>;
}

// Pipeline — already implemented, connects ASR + LLM
class FastChannelPipeline {
  processChunk(audio: Buffer, timestamp: number): Promise<void>;
  onTranslation(cb: (result: TranslationResult) => void): () => void;
  start(): void;
  stop(): void;
}

// Subtitle data — write to this atom to display subtitles
import { subtitleStackAtom } from './stores/session-store';
// SubtitleEntry { id, original, translation, isComplete, correction }
```

## Global State (Jotai Atoms)

| Atom | File | Purpose |
|---|---|---|
| `bilingualAtom` | settings-store.ts | Bilingual subtitle toggle |
| `subtitleStackAtom` | session-store.ts | Subtitle display stack |
| `domainAtom` | shared-context.ts | Detected domain |
| `activeTermsAtom` | shared-context.ts | Term mappings |
| `recentSummaryAtom` | shared-context.ts | Rolling summary |

## IPC API (what window.electronAPI exposes)

```typescript
interface ElectronAPI {
  getVersion(): Promise<string>;
  showOverlay(): Promise<void>;
  hideOverlay(): Promise<void>;
}
```

Add new methods to `shared/ipc-channels.ts` → `electron/main.ts` (handler) → `electron/preload.ts` (expose) → `src/vite-env.d.ts` (type).

## Getting Started with PR12

PR12 is to redesign `src/components/layout/MainWindow.tsx` to match `design-01-empty.html`.
The file already exists with basic functionality. The redesign should:
1. Use white + frosted glass card aesthetic
2. Keep all existing functionality (bilingual toggle, show/hide overlay, version display)
3. Follow the visual direction from `design-01-empty.html`
4. Add smooth transitions between states

Open `design-01-empty.html` in a browser first to see the target design.
