import { getDefaultStore, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ASRConfig } from '../services/asr/types';
import { createASRProvider } from '../services/asr/factory';
import type { LLMConfig, LLMProvider } from '../services/llm/types';
import { createLLMProvider } from '../services/llm/factory';
import { FastChannelPipeline } from '../services/pipeline/channel1-fast';
import { Channel2Analyzer } from '../services/pipeline/channel2-slow';
import { sharedContextAtom } from '../stores/shared-context';
import { historyAtom, meetingMinutesAtom, subtitleStackAtom } from '../stores/session-store';
import type { SubtitleEntry } from '../types/subtitle';
import { useAudioCapture } from './useAudioCapture';
import type { AudioSource } from './useAudioCapture';
import type { TranslationResult } from '../services/llm/types';
import { firstScreenLatency } from '../utils/first-screen-latency';
import { useChannelBridge } from './useChannelBridge';
import type { ChannelBridgeTarget } from './useChannelBridge';

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

/** 默认配置常量 */
const DEFAULTS = {
  /**
   * stop() 异步清理安全超时（毫秒）
   * 30s 足够覆盖正常 flush（~3s）+ 会议纪要生成（~15s）+ 网络波动余量，
   * 超过此时间说明 LLM 已无响应，强制释放锁防止应用永久卡死
   */
  STOP_CLEANUP_TIMEOUT_MS: 30000,
} as const;

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
  /** 会议纪要写入函数 —— stop 时 LLM 生成后写入 */
  const setMeetingMinutes = useSetAtom(meetingMinutesAtom);

  const pipelineRef = useRef<FastChannelPipeline | null>(null);
  const analyzerRef = useRef<Channel2Analyzer | null>(null);
  const [channelBridgeTarget, setChannelBridgeTarget] = useState<ChannelBridgeTarget | null>(null);
  /** LLM 实例引用——与 pipeline 共享同一实例，stop 时用于生成纪要 */
  const llmRef = useRef<LLMProvider | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);
  const idCounterRef = useRef(0);
  /** 当前正在流式接收的字幕 ID，null 表示无进行中的句子 */
  const activeIdRef = useRef<number | null>(null);
  const segmentSubtitleIdsRef = useRef<Map<string, number>>(new Map());
  /** 会话开始时间戳——stop 时用于计算会议时长 */
  const sessionStartRef = useRef<number>(0);
  /** 停止进行中锁——防止异步 dispose 期间 start 创建新实例导致资源冲突 */
  const stoppingRef = useRef(false);
  /** stop() 异步清理安全定时器——promise 链 hang 住时的最终兜底 */
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 音频捕获——根据 audioSource 参数选择麦克风或系统音频 */
  const audioCapture = useAudioCapture({ source: audioSource });
  useChannelBridge(channelBridgeTarget);

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
    /** 保留 LLM 引用，供 stop 时生成会议纪要用（需在 pipeline.stop() dispose 之前调用） */
    llmRef.current = llm;

    const analyzer = new Channel2Analyzer(llm);
    const pipeline = new FastChannelPipeline(asr, llm, () => contextRef.current, {
      onFinalSentences: (sentences) => {
        analyzer.feedSentences(sentences);
      },
    });
    analyzer.start();
    analyzerRef.current = analyzer;
    setChannelBridgeTarget({ analyzer, pipeline });

    /** 管线翻译回调 → subtitleStackAtom */
    pipeline.onTranslation((result: TranslationResult) => {
      if (result.segmentId) {
        let subtitleId = segmentSubtitleIdsRef.current.get(result.segmentId) ?? null;
        if (subtitleId === null) {
          subtitleId = ++idCounterRef.current;
          segmentSubtitleIdsRef.current.set(result.segmentId, subtitleId);
        }

        setSubtitleStack((prev) => {
          const existing = prev.some((e) => e.id === subtitleId);
          if (existing) {
            return prev.map((e) =>
              e.id === subtitleId
                ? {
                    ...e,
                    translation: result.translation,
                    original: result.originalText ?? e.original,
                    isComplete: result.tokens.length === 0,
                  }
                : e,
            );
          }

          const entry: SubtitleEntry = {
            id: subtitleId,
            timestamp: Date.now(),
            original: result.originalText ?? '',
            translation: result.translation,
            isComplete: result.tokens.length === 0,
            correction: null,
          };
          return [...prev, entry];
        });

        if (result.tokens.length === 0 && result.phase !== 'preview') {
          setHistory((prev) => [...prev, {
            id: subtitleId,
            timestamp: Date.now(),
            original: result.originalText ?? '',
            translation: result.translation,
            isComplete: true,
            correction: null,
          }]);
        }
        return;
      }

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
    firstScreenLatency.start(`source=${audioSource}`);
    if (!asrConfig || !llmConfig) {
      setError('请先配置 ASR 和 LLM 的 API Key');
      return;
    }
    if (isStarting || isTranslating) return;
    /** 上一会话的异步 dispose 尚未完成，阻止重入 */
    if (stoppingRef.current) {
      setError('正在停止上一会话，请稍候');
      return;
    }

    setError(null);
    setIsStarting(true);
    idCounterRef.current = 0;
    activeIdRef.current = null;
    segmentSubtitleIdsRef.current.clear();
    setSubtitleStack([]);
    /** 新会话开始时复位会议纪要状态 */
    setMeetingMinutes({ status: 'idle' });
    sessionStartRef.current = Date.now();

    /** ASR 连接预热 Promise——在 try 块外声明，catch 块中需清理以防孤儿 WebSocket */
    let warmupPromise: Promise<void> | null = null;

    try {
      pipelineRef.current = await createPipeline(asrConfig, llmConfig);
      pipelineRef.current.start();

      /** 音频 PCM → 管线 */
      const unsubAudio = audioCapture.onChunk((pcm) => {
        const buffer = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        pipelineRef.current?.processChunk(buffer, Date.now());
      });
      audioCleanupRef.current = unsubAudio;

      /**
       * ASR 连接预热——与音频捕获并行启动
       * audioCapture.start() 会弹出 getDisplayMedia 系统对话框（需用户选择屏幕），
       * 利用用户操作弹窗的 1~3 秒等待时间在后台建立 ASR WebSocket 连接（Token + 握手）
       */
      warmupPromise = pipelineRef.current.warmup();

      await audioCapture.start();

      /**
       * 确保 ASR 连接就绪——预热通常在弹窗等待期间已完成
       * 失败不阻塞翻译启动：recognize() 首次调用时 retain 懒连接作为可靠 fallback
       */
      try {
        await warmupPromise;
      } catch {
        /** 连接预热失败——静默，recognize() 首次调用时 connect() 会自动重试 */
      }

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
      /** 防止预热仍在进行时 dispose 导致孤儿 WebSocket——静默吞掉未处理 rejection */
      warmupPromise?.catch(() => {});
      analyzerRef.current?.stop();
      analyzerRef.current = null;
      setChannelBridgeTarget(null);
      pipelineRef.current?.stop();
      pipelineRef.current = null;
    }
  }, [asrConfig, llmConfig, audioSource, isStarting, isTranslating, audioCapture, setSubtitleStack]);

  /** 停止翻译：停音频 → flush 缓冲 → 生成纪要 → dispose 管线 → 清字幕 */
  const stop = useCallback((): void => {
    setIsStarting(false);
    audioCapture.stop();
    audioCleanupRef.current?.();
    audioCleanupRef.current = null;

    const pipeline = pipelineRef.current;
    const llm = llmRef.current;
    const analyzer = analyzerRef.current;

    if (pipeline && llm) {
      /** 上锁：防止异步链完成前 start 创建新实例 */
      stoppingRef.current = true;
      /** 安全兜底：超时后强制释放——LLM 无响应时防止应用永久卡死 */
      stopTimerRef.current = setTimeout(() => {
          pipeline.stop();
          analyzer?.stop();
          pipelineRef.current = null;
          analyzerRef.current = null;
          setChannelBridgeTarget(null);
          llmRef.current = null;
          stoppingRef.current = false;
          stopTimerRef.current = null;
      }, DEFAULTS.STOP_CLEANUP_TIMEOUT_MS);

      /**
       * 先 flush 让分句器缓冲中的剩余句子完成翻译并写入 historyAtom，
       * 再基于完整 history 生成会议纪要，最后 dispose。
       * Promise 链式编排——不使用 async/await 以保持 stop 同步返回。
       */
      pipeline.flush()
        .then(() => {
          /** 直接读 Jotai store 而非 ref——ref 仅在 React 渲染时更新，微任务中读到的是旧值 */
          const currentHistory = getDefaultStore().get(historyAtom);
          /** 无翻译记录时设为 empty 而非静默跳过——让 UI 展示明确提示 */
          if (currentHistory.length === 0) {
            setMeetingMinutes({ status: 'empty' });
            return null;
          }
          const sentences = currentHistory.map((h) => ({
            index: h.id,
            original: h.original,
            translation: h.translation,
          }));
          const durationSec = Math.round(
            (Date.now() - sessionStartRef.current) / 1000,
          );
          setMeetingMinutes({ status: 'generating' });
          return llm.generateMinutes(sentences, durationSec);
        })
        .then((data) => {
          if (data) setMeetingMinutes({ status: 'done', data });
        })
        .catch((err: Error) =>
          setMeetingMinutes({ status: 'error', error: err.message }),
        )
        .finally(() => {
          if (stopTimerRef.current) {
            clearTimeout(stopTimerRef.current);
            stopTimerRef.current = null;
          }
          pipeline.stop();
          analyzer?.stop();
          pipelineRef.current = null;
          analyzerRef.current = null;
          setChannelBridgeTarget(null);
          llmRef.current = null;
          stoppingRef.current = false;
        });
    } else {
      pipeline?.stop();
      analyzer?.stop();
      pipelineRef.current = null;
      analyzerRef.current = null;
      setChannelBridgeTarget(null);
      llmRef.current = null;
    }

    activeIdRef.current = null;
    segmentSubtitleIdsRef.current.clear();
    setIsTranslating(false);
    setSubtitleStack([]);
  }, [audioCapture, setSubtitleStack, setMeetingMinutes]);

  return { isTranslating, isStarting, error, isConfigured, start, stop };
}
