import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useRef, useState } from 'react';
import type { ASRConfig } from '../services/asr/types';
import { createASRProvider } from '../services/asr/factory';
import type { LLMConfig } from '../services/llm/types';
import { createLLMProvider } from '../services/llm/factory';
import { FastChannelPipeline } from '../services/pipeline/channel1-fast';
import { sharedContextAtom } from '../stores/shared-context';
import { subtitleStackAtom } from '../stores/session-store';
import type { SubtitleEntry } from '../types/subtitle';
import { useAudioCapture } from './useAudioCapture';
import type { AudioSource } from './useAudioCapture';
import type { TranslationResult } from '../services/llm/types';

/** Hook 返回值 */
export interface UseTranslationSessionReturn {
  /** 是否正在翻译 */
  isTranslating: boolean;
  /** 错误信息 */
  error: string | null;
  /** ASR 和 LLM 是否均已配置 */
  isConfigured: boolean;
  /** 开始翻译 */
  start: () => Promise<void>;
  /** 停止翻译 */
  stop: () => void;
}

/**
 * 翻译会话 Hook —— 将音频捕获、ASR、LLM、字幕全部串联
 * 链路 A 的完整运行时：音频 PCM → FastChannelPipeline → subtitleStackAtom
 * @param asrConfig ASR 配置，null 表示未配置
 * @param llmConfig LLM 配置，null 表示未配置
 */
export function useTranslationSession(
  asrConfig: ASRConfig | null,
  llmConfig: LLMConfig | null,
  audioSource: AudioSource,
): UseTranslationSessionReturn {
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 共享上下文 —— Channel 2 写入，Channel 1 翻译时携带 */
  const sharedContext = useAtomValue(sharedContextAtom);
  const contextRef = useRef(sharedContext);
  contextRef.current = sharedContext;

  /** 字幕堆栈写入函数 —— 管线翻译结果写入此 atom */
  const setSubtitleStack = useSetAtom(subtitleStackAtom);

  const pipelineRef = useRef<FastChannelPipeline | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);
  const idCounterRef = useRef(0);
  /** 当前正在流式接收的字幕 ID，null 表示无进行中的句子 */
  const activeIdRef = useRef<number | null>(null);

  /** 音频捕获——根据 audioSource 参数选择麦克风或系统音频 */
  const audioCapture = useAudioCapture({ source: audioSource });

  const isConfigured = asrConfig !== null && llmConfig !== null;

  /** 创建并接线管线：工厂 → FastChannelPipeline → 翻译回调写入字幕 atom → 错误回调 ← 38 行，从 start 中提取 */
  async function createPipeline(
    asrCfg: ASRConfig,
    llmCfg: LLMConfig,
  ): Promise<FastChannelPipeline> {
    const asr = createASRProvider(asrCfg);
    const llm = createLLMProvider(llmCfg);
    await asr.configure(asrCfg);
    await llm.configure(llmCfg);

    const pipeline = new FastChannelPipeline(asr, llm, () => contextRef.current);

    /** 管线翻译回调 → subtitleStackAtom */
    pipeline.onTranslation((result: TranslationResult) => {
      setSubtitleStack((prev) => {
        const activeId = activeIdRef.current;
        if (activeId !== null) {
          /** 流式 token：更新当前活跃字幕 */
          return prev.map((e) =>
            e.id === activeId
              ? { ...e, translation: result.translation, isComplete: result.tokens.length === 0 }
              : e,
          );
        }
        /** 新句子：创建新字幕条目 */
        const id = ++idCounterRef.current;
        activeIdRef.current = id;
        const entry: SubtitleEntry = {
          id,
          original: '',
          translation: result.translation,
          isComplete: result.tokens.length === 0,
          correction: null,
        };
        return [...prev, entry];
      });

      /** 句子完成后重置活跃 ID */
      if (result.tokens.length === 0) {
        activeIdRef.current = null;
      }
    });

    /** 管线错误回调 */
    pipeline.onError((err: Error) => {
      setError(err.message);
    });

    return pipeline;
  }

  /** 开始翻译：防重入 → 实例化管线 → 接线音频 → 启动 */
  const start = useCallback(async (): Promise<void> => {
    if (!asrConfig || !llmConfig) {
      setError('请先配置 ASR 和 LLM 的 API Key');
      return;
    }
    if (isTranslating) return;

    setError(null);
    idCounterRef.current = 0;
    activeIdRef.current = null;
    setSubtitleStack([]);

    try {
      pipelineRef.current = await createPipeline(asrConfig, llmConfig);
      pipelineRef.current.start();

      /** 音频 PCM → 管线 */
      const unsubAudio = audioCapture.onChunk((pcm) => {
        const buffer = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        pipelineRef.current?.processChunk(buffer, Date.now());
      });
      audioCleanupRef.current = unsubAudio;

      await audioCapture.start();
      setIsTranslating(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '翻译会话启动失败');
      pipelineRef.current?.stop();
      pipelineRef.current = null;
    }
  }, [asrConfig, llmConfig, isTranslating, audioCapture, setSubtitleStack]);

  /** 停止翻译：停音频 → 停管线 → 清字幕 */
  const stop = useCallback((): void => {
    audioCapture.stop();
    audioCleanupRef.current?.();
    audioCleanupRef.current = null;
    pipelineRef.current?.stop();
    pipelineRef.current = null;
    activeIdRef.current = null;
    setIsTranslating(false);
    setSubtitleStack([]);
  }, [audioCapture, setSubtitleStack]);

  return { isTranslating, error, isConfigured, start, stop };
}
