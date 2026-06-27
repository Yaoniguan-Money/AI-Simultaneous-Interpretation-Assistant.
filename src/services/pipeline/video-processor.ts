import type { ASRProvider } from '../asr/types';
import type { LLMProvider, SharedContext } from '../llm/types';
import { float32ToInt16 } from '../../hooks/useAudioCapture';

/** SRT 字幕条目 */
export interface SRTEntry {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

/** 处理进度回调 */
export type ProgressCallback = (stage: string, percent: number) => void;

/** 默认参数 */
const DEFAULTS = {
  /** 每个音频块的时长（毫秒） */
  CHUNK_MS: 2000,
  /** 音频采样率 */
  SAMPLE_RATE: 16000,
} as const;

/**
 * 离线视频处理器——链路 B 的编排器
 * 提取视频音频 → 批量 ASR → 批量翻译 → 生成 SRT 字幕
 * 与 FastChannelPipeline 共享 ASRProvider/LLMProvider 接口，编排完全独立
 */
export class VideoProcessor {
  constructor(
    private asr: ASRProvider,
    private llm: LLMProvider,
  ) {}

  /**
   * 处理视频文件，返回 SRT 格式字幕数据
   * @param file 视频文件（mp4/mov/webm）
   * @param onProgress 进度回调
   */
  async processFile(
    file: File,
    onProgress?: ProgressCallback,
  ): Promise<SRTEntry[]> {
    onProgress?.('extracting', 0);

    /** 第一步：从视频中提取 PCM 音频数据 */
    const audioBuffer = await this.extractAudio(file);
    if (!audioBuffer) throw new Error('无法从视频中提取音频');

    const sampleRate = audioBuffer.sampleRate;
    const pcmData = audioBuffer.getChannelData(0); // 单声道

    /** 第二步：按时间块切分音频 → 批量 ASR 识别 */
    const chunkSamples = (sampleRate * DEFAULTS.CHUNK_MS) / 1000;
    const chunks: { data: Float32Array; startMs: number }[] = [];

    for (let offset = 0; offset < pcmData.length; offset += chunkSamples) {
      const end = Math.min(offset + chunkSamples, pcmData.length);
      chunks.push({
        data: pcmData.slice(offset, end),
        startMs: (offset / sampleRate) * 1000,
      });
    }

    onProgress?.('asr', 10);

    /** 第三步：逐块 ASR 识别，记录时间戳 */
    const segments: { text: string; startMs: number; endMs: number }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk.data || chunk.data.length === 0) continue;

      const int16 = float32ToInt16(chunk.data);
      /** Int16Array → Uint8Array（共享底层 buffer，零拷贝） */
      const uint8 = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
      const result = await this.asr.recognize(uint8);

      if (result.text.trim()) {
        segments.push({
          text: result.text.trim(),
          startMs: chunk.startMs,
          endMs: chunk.startMs + DEFAULTS.CHUNK_MS,
        });
      }

      const pct = 10 + Math.round((i / chunks.length) * 40);
      onProgress?.('asr', pct);
    }

    if (segments.length === 0) throw new Error('未识别到任何语音内容');

    /** 第四步：拼接 ASR 文本 → 通过分句器切为完整句子 */
    const fullText = segments.map((s) => s.text).join(' ');
    const estimatedStartMs = segments[0].startMs;
    const estimatedEndMs = segments[segments.length - 1].endMs;

    /** 按时间戳比例估算每句的起始时间 */
    const charsPerMs = fullText.length / Math.max(estimatedEndMs - estimatedStartMs, 1);
    let sentenceBuffer = '';
    const sentences: { text: string; startMs: number }[] = [];

    for (let i = 0; i < fullText.length; i++) {
      sentenceBuffer += fullText[i];
      const ch = fullText[i];
      if (ch === '.' || ch === '!' || ch === '?') {
        const sentenceStartMs = estimatedStartMs +
          Math.round((i - sentenceBuffer.length + 1) / Math.max(charsPerMs, 0.01));
        sentences.push({ text: sentenceBuffer.trim(), startMs: Math.max(0, sentenceStartMs) });
        sentenceBuffer = '';
      }
    }
    if (sentenceBuffer.trim()) {
      sentences.push({ text: sentenceBuffer.trim(), startMs: estimatedEndMs - 2000 });
    }

    onProgress?.('translate', 50);

    /** 第五步：逐句 LLM 翻译 */
    const entries: SRTEntry[] = [];
    const emptyContext: SharedContext = {
      domain: null, domainConfidence: 0, activeTerms: new Map(),
      recentSummary: '', topicHistory: [],
    };

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const request = { text: s.text, context: emptyContext, previousSentences: [] };
      let translation = '';

      try {
        for await (const result of this.llm.translate(request)) {
          translation = result.translation;
        }
      } catch {
        translation = s.text; // 翻译失败时用原文
      }

      const nextStartMs = i + 1 < sentences.length ? sentences[i + 1].startMs : estimatedEndMs;
      entries.push({
        index: i + 1,
        startMs: s.startMs,
        endMs: nextStartMs,
        text: translation || s.text,
      });

      const pct = 50 + Math.round((i / sentences.length) * 50);
      onProgress?.('translate', pct);
    }

    return entries;
  }

  /**
   * 将 SRT 条目数组格式化为标准 SRT 字符串
   */
  static formatSRT(entries: SRTEntry[]): string {
    return entries
      .map((e) => {
        const start = formatTimestamp(e.startMs);
        const end = formatTimestamp(e.endMs);
        return `${e.index}\n${start} --> ${end}\n${e.text}\n`;
      })
      .join('\n');
  }

  // ---- 内部 ----

  /** 从视频文件提取 PCM 音频 */
  private async extractAudio(file: File): Promise<AudioBuffer | null> {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;

      const url = URL.createObjectURL(file);
      video.src = url;

      video.onloadedmetadata = async () => {
        const audioCtx = new AudioContext({ sampleRate: DEFAULTS.SAMPLE_RATE });
        const source = audioCtx.createMediaElementSource(video);

        /** 使用 OfflineAudioContext 离线渲染完整音频 */
        const duration = video.duration;
        if (!duration || duration <= 0) {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }

        const offlineCtx = new OfflineAudioContext(
          1,
          Math.ceil(DEFAULTS.SAMPLE_RATE * duration),
          DEFAULTS.SAMPLE_RATE,
        );

        source.connect(offlineCtx.destination);
        video.play();

        try {
          const rendered = await offlineCtx.startRendering();
          video.pause();
          URL.revokeObjectURL(url);
          audioCtx.close();
          resolve(rendered);
        } catch {
          URL.revokeObjectURL(url);
          audioCtx.close();
          resolve(null);
        }
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
    });
  }
}

/** SRT 时间戳格式：HH:MM:SS,mmm */
function formatTimestamp(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

