import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ASRConfig } from '../services/asr/types';
import { createASRProvider } from '../services/asr/factory';
import type { LLMConfig } from '../services/llm/types';
import { createLLMProvider } from '../services/llm/factory';
import { FastChannelPipeline } from '../services/pipeline/channel1-fast';
import { sharedContextAtom } from '../stores/shared-context';
import { historyAtom, subtitleStackAtom } from '../stores/session-store';
import type { SubtitleEntry } from '../types/subtitle';
import { useAudioCapture } from './useAudioCapture';
import type { AudioSource } from './useAudioCapture';
import type { TranslationResult } from '../services/llm/types';

/** Hook 返回值 */
export interface UseTranslationSessionReturn {
  /** 是否正在翻译 */
  isTranslating: boolean;
  /** 是否正在启动中（音频捕获尚未就绪） */
  isStarting: boolean;
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
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 共享上下文 —— Channel 2 写入，Channel 1 翻译时携带 */
  const sharedContext = useAtomValue(sharedContextAtom);
  const contextRef = useRef(sharedContext);
  contextRef.current = sharedContext;

  /** 字幕堆栈写入函数 —— 管线翻译结果写入此 atom */
  const setSubtitleStack = useSetAtom(subtitleStackAtom);
  /** 历史记录写入函数 —— 完整句子追加，stop 时不清空 */
  const setHistory = useSetAtom(historyAtom);

  const pipelineRef = useRef<FastChannelPipeline | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);
  const idCounterRef = useRef(0);
  /** 当前正在流式接收的字幕 ID，null 表示无进行中的句子 */
  const activeIdRef = useRef<number | null>(null);

  /** 音频捕获——根据 audioSource 参数选择麦克风或系统音频 */
  const audioCapture = useAudioCapture({ source: audioSource });

  const isConfigured = asrConfig !== null && llmConfig !== null;

  /** 同步音频捕获错误到会话——设备拔出、静音超时等通过此路径传递到 UI */
  useEffect(() => {
    if (audioCapture.error) {
      setError(audioCapture.error);
    }
  }, [audioCapture.error]);

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
          /** 流式 token：更新当前活跃字幕——首 token 携带的原文覆盖 interim 的粗略识别结果 */
          return prev.map((e) =>
            e.id === activeId
              ? {
                  ...e,
                  translation: result.translation,
                  original: result.originalText ?? e.original,
                  isComplete: result.tokens.length === 0,
                }
              : e,
          );
        }
        /** 新句子：创建新字幕条目——英文原文由管道 originalText 提供 */
        const id = ++idCounterRef.current;
        activeIdRef.current = id;
        const entry: SubtitleEntry = {
          id,
          timestamp: Date.now(),
          original: result.originalText ?? '',
          translation: result.translation,
          isComplete: result.tokens.length === 0,
          correction: null,
        };
        return [...prev, entry];
      });

      /** 句子完成后重置活跃 ID 并追加到持久化历史——英文原文由管道 originalText 提供 */
      if (result.tokens.length === 0) {
        activeIdRef.current = null;
        setHistory((prev) => [...prev, {
          id: idCounterRef.current,
          timestamp: Date.now(),
          original: result.originalText ?? '',
          translation: result.translation,
          isComplete: true,
          correction: null,
        }]);
      }
    });

    /**
     * ASR interim 结果回调 → 实时更新活跃字幕原文
     * 仅在有翻译进行中时更新原文字段（提升 ASR 实时识别精度），
     * 不创建纯原文的空翻译条目——确保每条可见字幕同时包含英文原文和中文翻译
     */
    pipeline.onInterimResult((text: string) => {
      if (!text) return;
      setSubtitleStack((prev) => {
        const activeId = activeIdRef.current;
        if (activeId !== null) {
          /** 更新当前活跃字幕的原文——提升 ASR 实时识别精度 */
          return prev.map((e) =>
            e.id === activeId ? { ...e, original: text } : e,
          );
        }
        /** 无活跃字幕时不创建新条目——等待 LLM 翻译到达时由 onTranslation 统一创建 */
        return prev;
      });
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
    if (isStarting || isTranslating) return;

    setError(null);
    setIsStarting(true);
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
      setIsStarting(false);
      setIsTranslating(true);
    } catch (err) {
      setIsStarting(false);
      /** 透传原始错误——音频捕获返回的具体错误（如"未检测到音频输入"）对用户定位问题更有效 */
      const message = err instanceof Error ? err.message : '翻译会话启动失败';
      setError(message);
      /** 清理已注册的 onChunk 回调——start 失败但回调可能已在 audioCapture.start() 前注册 */
      audioCleanupRef.current?.();
      audioCleanupRef.current = null;
      pipelineRef.current?.stop();
      pipelineRef.current = null;
    }
  }, [asrConfig, llmConfig, isStarting, isTranslating, audioCapture, setSubtitleStack]);

  /** 停止翻译：停音频 → 停管线 → 清字幕 */
  const stop = useCallback((): void => {
    setIsStarting(false);
    audioCapture.stop();
    audioCleanupRef.current?.();
    audioCleanupRef.current = null;
    pipelineRef.current?.stop();
    pipelineRef.current = null;
    activeIdRef.current = null;
    setIsTranslating(false);
    setSubtitleStack([]);
  }, [audioCapture, setSubtitleStack]);

  return { isTranslating, isStarting, error, isConfigured, start, stop };
}
