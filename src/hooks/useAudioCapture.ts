import { useCallback, useEffect, useRef, useState } from 'react';

/** 音频捕获源 */
export type AudioSource = 'system' | 'microphone';

/** 音频捕获配置 */
export interface AudioCaptureConfig {
  source: AudioSource;
  /** 采样率，默认 16000 */
  sampleRate?: number;
  /** 声道数，默认 1 */
  channels?: number;
}

/** 默认音频参数 */
const DEFAULTS = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  /** ScriptProcessor 缓冲区帧数——2048 帧 @ 16kHz ≈ 128ms，降低捕获延迟 */
  BUFFER_SIZE: 2048,
  /** 16-bit PCM 最大值 */
  PCM16_MAX: 32767,
  /** AudioContext 延迟策略——interactive 优先低延迟而非省电，适合实时 ASR */
  LATENCY_HINT: 'interactive' as AudioContextLatencyCategory,
  /** 静音超时阈值（毫秒），超过此时间无有效音频输入则上报错误 */
  SILENT_TIMEOUT_MS: 5000,
  /** 静音检测检查间隔（毫秒） */
  SILENT_CHECK_INTERVAL: 1000,
  /** 有效音频阈值——采样振幅超过此值的缓冲区视为有音频输入（0.05% 满幅） */
  AUDIO_LEVEL_THRESHOLD: 0.0005,
  /** 禁用浏览器音频后处理——获取原始音频供 ASR，减少处理延迟 */
  ECHO_CANCELLATION: false,
  NOISE_SUPPRESSION: false,
  AUTO_GAIN_CONTROL: false,
} as const;

/** Hook 返回值 */
export interface UseAudioCaptureReturn {
  isCapturing: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /** 注册 PCM 回调，接收 Int16Array（16-bit PCM），返回取消注册函数 */
  onChunk: (callback: (pcm: Int16Array) => void) => () => void;
}

/**
 * 音频捕获 Hook — 将麦克风输入转为 16-bit PCM 流
 * 输出格式：16kHz, 16-bit, mono, Int16Array
 */
export function useAudioCapture(config: AudioCaptureConfig): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 用 ref 持有最新 config，避免 useCallback 闭包过期 */
  const configRef = useRef(config);
  configRef.current = config;

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const callbacksRef = useRef<Set<(pcm: Int16Array) => void>>(new Set());
  /** 静音检测定时器引用——processStream 创建，stop 负责清理 */
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 最后收到有效音频的时间戳——0 表示从未收到 */
  const lastAudioTsRef = useRef<number>(0);

  /** 注册 PCM 回调，返回取消注册函数 */
  const onChunk = useCallback(
    (callback: (pcm: Int16Array) => void): (() => void) => {
      callbacksRef.current.add(callback);
      return () => { callbacksRef.current.delete(callback); };
    },
    [],
  );

  /** 停止并释放所有音频资源 */
  const stop = useCallback((): void => {
    /** 清除静音检测定时器 */
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    /** 重置静音检测状态 */
    lastAudioTsRef.current = 0;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    contextRef.current?.close();
    contextRef.current = null;
    setIsCapturing(false);
  }, []);

  /**
   * 麦克风捕获：getUserMedia → AudioContext → Int16Array PCM chunks
   * 输出格式与方案 4.3 一致：16kHz, 16-bit, mono
   */
  const captureMicrophone = useCallback(async (cfg: AudioCaptureConfig): Promise<void> => {
    /** 浏览器环境检测 */
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前环境不支持麦克风访问');
    }
    const sampleRate = cfg.sampleRate ?? DEFAULTS.SAMPLE_RATE;
    if (sampleRate <= 0) {
      throw new Error(`无效的采样率: ${sampleRate}`);
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate,
        channelCount: cfg.channels ?? DEFAULTS.CHANNELS,
        /** 禁用浏览器后处理以获取原始音频——回声消除/降噪/自动增益会增加延迟并降低 ASR 准确率 */
        echoCancellation: DEFAULTS.ECHO_CANCELLATION,
        noiseSuppression: DEFAULTS.NOISE_SUPPRESSION,
        autoGainControl: DEFAULTS.AUTO_GAIN_CONTROL,
      },
    });
    await processStream(stream, sampleRate);
  }, [stop]);

  /**
   * 系统音频捕获：主进程 setDisplayMediaRequestHandler + getDisplayMedia → AudioContext → PCM
   * 首次使用弹出系统屏幕选择器，后续可能复用权限
   */
  const captureSystem = useCallback(async (cfg: AudioCaptureConfig): Promise<void> => {
    /** 浏览器环境检测 */
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('当前环境不支持系统音频捕获');
    }

    const sampleRate = cfg.sampleRate ?? DEFAULTS.SAMPLE_RATE;
    if (sampleRate <= 0) {
      throw new Error(`无效的采样率: ${sampleRate}`);
    }

    /**
     * getDisplayMedia 必须同时请求 video 和 audio 才能获取系统音频权限
     * 视频轨道在获取后立即停止以节省 GPU 资源——仅需音频数据
     * video: 4×4×1fps 最小规格，避免 GPU 纹理包装错误
     */
    const stream = await navigator.mediaDevices.getDisplayMedia({
      /** 系统音频回路通常无后处理，显式声明与麦克风约束一致 */
      audio: {
        echoCancellation: DEFAULTS.ECHO_CANCELLATION,
        noiseSuppression: DEFAULTS.NOISE_SUPPRESSION,
        autoGainControl: DEFAULTS.AUTO_GAIN_CONTROL,
      },
      video: { width: 4, height: 4, frameRate: 1 },
    });

    /** 视频轨道的释放移至 processStream 内 AudioContext 初始化之后
     *  过早停止视频轨道可能导致整个捕获会话被 Windows 撤销 */
    await processStream(stream, sampleRate);
  }, [stop]);

  /**
   * 统一流处理：设备监听 → AudioContext → ScriptProcessor → Int16Array PCM
   * 麦克风和系统音频共用此管道
   */
  const processStream = useCallback(async (
    stream: MediaStream,
    sampleRate: number,
  ): Promise<void> => {
    streamRef.current = stream;

    /** 监听音频轨道断开 */
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.onended = (): void => {
        setError('音频设备已断开，请检查音频源');
        stop();
      };
    }

    /** latencyHint: interactive 让浏览器优先降低延迟——桌面端 Electron 无省电限制，效果最佳 */
    const audioCtx = new AudioContext({ sampleRate, latencyHint: DEFAULTS.LATENCY_HINT });
    /** 确保 AudioContext 处于运行状态——getDisplayMedia 弹出系统对话框会断裂 user gesture 链，
     *  导致 Chromium autoplay policy 将 AudioContext 初始化为 suspended，onaudioprocess 不触发 */
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    contextRef.current = audioCtx;

    const sourceNode = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(DEFAULTS.BUFFER_SIZE, 1, 1);

    /** 每个缓冲区：静音检测 → Float32Array → Int16Array PCM，分发给所有监听者 */
    processor.onaudioprocess = (event: AudioProcessingEvent): void => {
      const floatSamples = event.inputBuffer.getChannelData(0);

      /** 静音检测：计算缓冲区内最大采样振幅，超过阈值标记为有效音频 */
      let maxSample = 0;
      for (let i = 0; i < floatSamples.length; i++) {
        const abs = Math.abs(floatSamples[i]);
        if (abs > maxSample) maxSample = abs;
      }
      if (maxSample > DEFAULTS.AUDIO_LEVEL_THRESHOLD) {
        lastAudioTsRef.current = Date.now();
      }

      const pcm16 = float32ToInt16(floatSamples);
      callbacksRef.current.forEach((cb) => cb(pcm16));
    };

    sourceNode.connect(processor);
    processor.connect(audioCtx.destination);

    /** 延迟释放视频轨道——音频处理管线已完全初始化（AudioContext + ScriptProcessor 就绪）
     *  此时停止视频轨道不再影响音频数据的正常捕获 */
    stream.getVideoTracks().forEach((track) => track.stop());

    /** 启动静音检测定时器：定期检查是否有有效音频输入 */
    const streamStartTime = Date.now();
    lastAudioTsRef.current = 0;

    silenceTimerRef.current = setInterval(() => {
      const now = Date.now();
      const last = lastAudioTsRef.current;

      if (last === 0) {
        /** 从未收到有效音频——超过阈值判定为无音频输入 */
        if (now - streamStartTime >= DEFAULTS.SILENT_TIMEOUT_MS) {
          setError('未检测到音频输入，请检查音频源是否正常工作');
          stop();
        }
      } else if (now - last >= DEFAULTS.SILENT_TIMEOUT_MS) {
        /** 曾经收到过音频但长时间静默——可能音频源已断开 */
        setError('音频输入已静默超过 5 秒，请检查音频源');
        stop();
      }
    }, DEFAULTS.SILENT_CHECK_INTERVAL);
  }, [stop]);

  /** 开始捕获，防重入：先置状态再异步，消除 await 期间的竞态窗口 */
  const start = useCallback(async (): Promise<void> => {
    if (isCapturing) return;
    setIsCapturing(true);
    setError(null);
    try {
      const cfg = configRef.current;
      if (cfg.source === 'microphone') {
        await captureMicrophone(cfg);
      } else {
        await captureSystem(cfg);
      }
    } catch (err) {
      setIsCapturing(false);
      /** 保存错误后重新抛出——让调用方（useTranslationSession）感知启动失败
       *  从而跳过 setIsTranslating(true) 和 showOverlay() */
      const message = err instanceof Error ? err.message : '音频设备启动失败';
      setError(message);
      throw new Error(message);
    }
  }, [isCapturing, captureMicrophone, captureSystem]);

  /** 组件卸载时自动停止 */
  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { isCapturing, error, start, stop, onChunk };
}

/**
 * PCM 转换缓冲区缓存——避免每次 onaudioprocess 分配新 Int16Array
 * BufferSize 在运行期间固定（2048 @ 16kHz），长度不变时重用同一块内存
 */
let pcmBufferCache: Int16Array | null = null;

/**
 * Float32Array（范围 -1.0 ~ 1.0）转 Int16Array（范围 -32768 ~ 32767）
 * 方案 4.3 要求输出 16-bit PCM
 */
/** Float32Array → Int16Array，公共工具函数 */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const len = float32.length;
  /** 缓存命中且长度匹配时重用，否则重新分配 */
  if (!pcmBufferCache || pcmBufferCache.length !== len) {
    pcmBufferCache = new Int16Array(len);
  }
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcmBufferCache[i] = s < 0 ? s * DEFAULTS.PCM16_MAX : s * (DEFAULTS.PCM16_MAX - 1);
  }
  return pcmBufferCache;
}
