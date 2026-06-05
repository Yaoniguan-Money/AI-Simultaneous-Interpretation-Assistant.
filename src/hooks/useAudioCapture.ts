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
  /** ScriptProcessor 缓冲区帧数 */
  BUFFER_SIZE: 4096,
  /** 16-bit PCM 最大值 */
  PCM16_MAX: 32767,
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
      audio: { sampleRate, channelCount: cfg.channels ?? DEFAULTS.CHANNELS },
    });
    await processStream(stream, sampleRate);
  }, [stop]);

  /**
   * 系统音频捕获：桌面源 ID → getUserMedia（Chrome 桌面约束）→ AudioContext → PCM
   * 首次使用弹出屏幕选择对话框（Chrome 安全策略），后续静默
   */
  const captureSystem = useCallback(async (cfg: AudioCaptureConfig): Promise<void> => {
    /** 通过 IPC 获取桌面捕获源 ID */
    const sourceId = await window.electronAPI?.getDesktopSourceId();
    if (!sourceId) {
      throw new Error('无法获取桌面捕获源，请确认屏幕共享权限');
    }

    const sampleRate = cfg.sampleRate ?? DEFAULTS.SAMPLE_RATE;
    if (sampleRate <= 0) {
      throw new Error(`无效的采样率: ${sampleRate}`);
    }

    /** Chrome 桌面捕获约束：捕获屏幕 + 系统音频 */
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop' as unknown as string,
          chromeMediaSourceId: sourceId,
        },
      } as MediaTrackConstraints,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop' as unknown as string,
          chromeMediaSourceId: sourceId,
        },
      } as MediaTrackConstraints,
    });

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

    const audioCtx = new AudioContext({ sampleRate });
    contextRef.current = audioCtx;

    const sourceNode = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(DEFAULTS.BUFFER_SIZE, 1, 1);

    /** 每个缓冲区：Float32Array → Int16Array（16-bit PCM），分发给所有监听者 */
    processor.onaudioprocess = (event: AudioProcessingEvent): void => {
      const floatSamples = event.inputBuffer.getChannelData(0);
      const pcm16 = float32ToInt16(floatSamples);
      callbacksRef.current.forEach((cb) => cb(pcm16));
    };

    sourceNode.connect(processor);
    processor.connect(audioCtx.destination);
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
      setError(err instanceof Error ? err.message : '音频设备启动失败');
    }
  }, [isCapturing, captureMicrophone, captureSystem]);

  /** 组件卸载时自动停止 */
  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { isCapturing, error, start, stop, onChunk };
}

/**
 * Float32Array（范围 -1.0 ~ 1.0）转 Int16Array（范围 -32768 ~ 32767）
 * 方案 4.3 要求输出 16-bit PCM
 */
function float32ToInt16(float32: Float32Array): Int16Array {
  const len = float32.length;
  const int16 = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * DEFAULTS.PCM16_MAX : s * (DEFAULTS.PCM16_MAX - 1);
  }
  return int16;
}
