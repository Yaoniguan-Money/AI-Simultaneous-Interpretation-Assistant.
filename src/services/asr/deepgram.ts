import type { ASRConfig, ASRProvider, ASRResult } from './types';
import { consumeAsrResultQueue, emptyAsrResult, ensureConfigured } from '../provider-utils';

/**
 * Deepgram 实时语音识别 WebSocket API 协议常量
 * 参考文档：https://developers.deepgram.com/docs/live-streaming-audio
 * 鉴权方式：API Key 嵌入 WebSocket URL query string（token 参数）
 * 无握手阶段——连接建立后直接发送音频二进制帧
 */
const PROTOCOL = {
  /** WebSocket 端点 */
  WSS_URL: 'wss://api.deepgram.com/v1/listen',
  /** 音频编码格式 */
  ENCODING: 'linear16',
  /** 默认识别语言 */
  DEFAULT_LANG: 'en',
  /** 采样率 */
  SAMPLE_RATE: 16000,
  /** 声道数 */
  CHANNELS: 1,
  /** 连接建立/握手超时（毫秒） */
  CONNECT_TIMEOUT: 10000,
} as const;

/** 凭证字段名 */
const CRED_KEY = { apiKey: 'apiKey' } as const;

/** Deepgram WebSocket 服务端结果消息结构 */
interface DeepgramMessage {
  type: string;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
      confidence?: number;
      words?: Array<{ word: string; start?: number; end?: number }>;
    }>;
  };
  is_final?: boolean;
  speech_final?: boolean;
}

/**
 * Deepgram 实时语音识别 WebSocket API 实现
 *
 * - 最简单的 ASR 供应商实现——纯 WebSocket + API Key query 鉴权
 * - 连接即开始：无握手阶段，直接发送 PCM 音频帧
 * - 结果通过 WebSocket onmessage 流式返回 JSON
 * - 遵循与 IFlyTekASR 一致的接口模式：懒连接、结果队列、连接锁、dispose 清理
 */
export class DeepgramASR implements ASRProvider {
  readonly name = 'deepgram';

  private ws: WebSocket | null = null;
  private config: ASRConfig | null = null;

  /** 识别结果 FIFO 队列 */
  private resultQueue: ASRResult[] = [];

  /** interim 暂存队列——供 drainInterimResults() 外部拉取 */
  private pendingInterim: ASRResult[] = [];

  /** 连接进行中 Promise——防止并发 connect() 产生孤儿 WebSocket */
  private connectingPromise: Promise<void> | null = null;

  // ---- 公共接口 ----

  async configure(config: ASRConfig): Promise<void> {
    this.validateConfig(config);
    this.config = { ...config };
  }

  /**
   * 发送 PCM 音频帧进行识别
   * 首次调用时懒建立 WebSocket，后续直接发送二进制帧
   * 音频格式：16kHz / 16bit / 单声道 / PCM
   */
  async recognize(audio: Uint8Array): Promise<ASRResult> {
    const cfg = ensureConfigured(this.config, 'Deepgram ASR');
    if (!audio || audio.length === 0) {
      return emptyAsrResult(false);
    }

    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        await this.connect(cfg);
      }
      this.ws!.send(audio);
    } catch {
      return emptyAsrResult(true);
    }

    return this.consumeQueue();
  }

  /** 拉取未消费的 interim 结果 */
  drainInterimResults(): ASRResult[] {
    const arr = this.pendingInterim;
    this.pendingInterim = [];
    return arr;
  }

  dispose(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      /** Deepgram 需要发送 CloseStream 消息来结束识别并获取最终结果 */
      try {
        const encoder = new TextEncoder();
        this.ws.send(encoder.encode(JSON.stringify({ type: 'CloseStream' })));
      } catch { /* 连接可能已断开 */ }
      this.ws.close(1000);
    }
    this.ws = null;
    this.config = null;
    this.resultQueue = [];
    this.pendingInterim = [];
  }

  /**
   * 验证凭证有效性
   * 建立 WebSocket → 等待第一条消息（表示连接成功且鉴权通过）→ 关闭连接
   */
  async validateCredentials(config: ASRConfig): Promise<boolean> {
    try {
      await this.configure(config);
      const url = buildUrl(config);
      const ws = new WebSocket(url);

      const ok = await new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;

        ws.onopen = () => {
          timer = setTimeout(() => {
            resolve(true); // 连接保持等同于鉴权通过
            ws.close(1000);
          }, 2000);
        };

        ws.onmessage = () => {
          /** 收到任何消息都说明鉴权通过（否则服务端会立即关闭连接） */
          if (timer) clearTimeout(timer);
          resolve(true);
          ws.close(1000);
        };

        ws.onclose = () => {
          if (timer) clearTimeout(timer);
          resolve(false);
        };

        ws.onerror = () => {
          if (timer) clearTimeout(timer);
          resolve(false);
        };
      });

      return ok;
    } catch {
      return false;
    }
  }

  // ---- 私有方法 ----

  private async connect(cfg: ASRConfig): Promise<void> {
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = (async (): Promise<void> => {
      const url = buildUrl(cfg);
      this.ws = new WebSocket(url);
      this.resultQueue = [];
      this.pendingInterim = [];
      let connectTimer: ReturnType<typeof setTimeout> | null = null;

      /** 阶段 ①：等待 WebSocket 连接建立 */
      await new Promise<void>((resolve, reject) => {
        this.ws!.onopen = () => {
          if (connectTimer) clearTimeout(connectTimer);
          resolve();
        };
        this.ws!.onerror = () => {
          if (connectTimer) clearTimeout(connectTimer);
          reject(new Error('Deepgram WebSocket 连接失败'));
        };
        connectTimer = setTimeout(
          () => reject(new Error('Deepgram WebSocket 连接超时')),
          PROTOCOL.CONNECT_TIMEOUT,
        );
      });

      /** 阶段 ②：注册结果处理器 */
      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as DeepgramMessage;

          if (msg.type !== 'Results') return;

          const alt = msg.channel?.alternatives?.[0];
          const text = alt?.transcript ?? '';
          if (!text) return;

          const wordsArr = alt?.words;
          const lastWord = wordsArr?.[wordsArr.length - 1];
          const result: ASRResult = {
            text,
            isFinal: msg.is_final ?? false,
            confidence: alt?.confidence ?? 0,
            startTime: wordsArr?.[0]?.start != null ? wordsArr[0].start * 1000 : 0,
            endTime: lastWord?.end != null ? lastWord.end * 1000 : 0,
          };
          this.resultQueue.push(result);
        } catch { /* JSON 解析失败，忽略 */ }
      };

      /** 服务端主动关闭——清空队列，下次自动重连 */
      this.ws.onclose = () => {
        this.resultQueue = [];
        this.pendingInterim = [];
      };
    })();

    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  /** 消费结果队列：委托公共工具 */
  private consumeQueue(): ASRResult {
    return consumeAsrResultQueue(this.resultQueue, this.pendingInterim);
  }

  private validateConfig(config: ASRConfig): void {
    if (!config.credentials[CRED_KEY.apiKey]) {
      throw new Error('Deepgram ASR 缺少 apiKey');
    }
  }

}

/**
 * 构建 Deepgram WebSocket 鉴权 URL
 * API Key 以 token 查询参数传递，同时指定音频编码参数
 */
function buildUrl(cfg: ASRConfig): string {
  const apiKey = cfg.credentials[CRED_KEY.apiKey];
  const lang = cfg.language ?? PROTOCOL.DEFAULT_LANG;
  const baseUrl = cfg.endpoint ?? PROTOCOL.WSS_URL;

  const params = new URLSearchParams({
    token: apiKey,
    encoding: PROTOCOL.ENCODING,
    sample_rate: PROTOCOL.SAMPLE_RATE.toString(),
    channels: PROTOCOL.CHANNELS.toString(),
    language: lang,
    interim_results: 'true',
  });

  return `${baseUrl}?${params.toString()}`;
}
