import type { ASRConfig, ASRProvider, ASRResult } from './types';
import { consumeAsrResultQueue, emptyAsrResult, ensureConfigured } from '../provider-utils';
import { firstScreenLatency } from '../../utils/first-screen-latency';

/**
 * 自定义 WebSocket ASR 协议常量
 */
const PROTOCOL = {
  /** 连接建立超时（毫秒） */
  CONNECT_TIMEOUT: 10000,
} as const;

/** 凭证字段名 */
const CRED_KEY = { endpoint: 'endpoint' } as const;

/**
 * 自定义 WebSocket ASR 实现
 *
 * 供用户接入自建或第三方兼容 ASR 服务。
 * 协议约定：连接后发送二进制 PCM 音频帧，服务端通过 WebSocket 返回 JSON 结果。
 * 消息格式期望：{ text: string, isFinal: boolean, confidence?: number }
 *
 * 适合与讯飞/阿里云/Deepgram 协议不同的私有 ASR，或需要自定义端点的情况。
 */
export class CustomASR implements ASRProvider {
  readonly name = 'custom';

  private ws: WebSocket | null = null;
  private config: ASRConfig | null = null;
  private resultQueue: ASRResult[] = [];
  private pendingInterim: ASRResult[] = [];
  private connectingPromise: Promise<void> | null = null;

  async configure(config: ASRConfig): Promise<void> {
    this.validateConfig(config);
    this.config = { ...config };
  }

  /**
   * 预热 WebSocket 连接——提前建立与自定义 ASR 服务的连接
   * 可在音频捕获启动前调用，利用 getDisplayMedia 弹窗等待时间并行建连
   * 已连接时幂等返回，失败不抛异常——recognize() 首次调用时会重试
   */
  async preconnect(): Promise<void> {
    const cfg = ensureConfigured(this.config, '自定义 ASR');
    if (this.ws?.readyState === WebSocket.OPEN) return;
    try {
      await this.connect(cfg);
    } catch {
      /** 预热失败静默——recognize() 内懒连接作为 fallback */
    }
  }

  async recognize(audio: Uint8Array): Promise<ASRResult> {
    const cfg = ensureConfigured(this.config, '自定义 ASR');
    if (!audio || audio.length === 0) {
      return emptyAsrResult(false);
    }

    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        await this.connect(cfg);
      }
      this.ws!.send(audio);
      firstScreenLatency.mark('first_audio_sent', `provider=${this.name} bytes=${audio.byteLength}`);
    } catch {
      return emptyAsrResult(true);
    }

    return this.consumeQueue();
  }

  drainInterimResults(): ASRResult[] {
    const arr = this.pendingInterim;
    this.pendingInterim = [];
    return arr;
  }

  dispose(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000);
    }
    this.ws = null;
    this.config = null;
    this.resultQueue = [];
    this.pendingInterim = [];
  }

  async validateCredentials(config: ASRConfig): Promise<boolean> {
    try {
      await this.configure(config);
      const endpoint = config.credentials[CRED_KEY.endpoint];
      if (!endpoint) return false;

      const ws = new WebSocket(endpoint);
      const ok = await new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;

        ws.onopen = () => {
          timer = setTimeout(() => {
            resolve(true);
            ws.close(1000);
          }, 3000);
        };

        ws.onmessage = () => {
          if (timer) clearTimeout(timer);
          resolve(true);
          ws.close(1000);
        };

        ws.onerror = () => {
          if (timer) clearTimeout(timer);
          resolve(false);
        };

        ws.onclose = () => {
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
      const endpoint = cfg.credentials[CRED_KEY.endpoint];
      this.ws = new WebSocket(endpoint);
      this.resultQueue = [];
      this.pendingInterim = [];
      let connectTimer: ReturnType<typeof setTimeout> | null = null;

      await new Promise<void>((resolve, reject) => {
        this.ws!.onopen = () => {
          if (connectTimer) clearTimeout(connectTimer);
          firstScreenLatency.mark('asr_ws_open', `provider=${this.name}`);
          resolve();
        };
        this.ws!.onerror = () => {
          if (connectTimer) clearTimeout(connectTimer);
          reject(new Error('自定义 ASR WebSocket 连接失败'));
        };
        connectTimer = setTimeout(
          () => reject(new Error('自定义 ASR WebSocket 连接超时')),
          PROTOCOL.CONNECT_TIMEOUT,
        );
      });

      /** 通用 JSON 结果解析：支持 {text, isFinal, confidence} 格式 */
      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            text?: string;
            isFinal?: boolean;
            confidence?: number;
            startTime?: number;
            endTime?: number;
          };

          if (!msg.text) return;

          this.resultQueue.push({
            text: msg.text,
            isFinal: msg.isFinal ?? true,
            confidence: msg.confidence ?? 1,
            startTime: msg.startTime ?? 0,
            endTime: msg.endTime ?? 0,
          });
        } catch { /* 非 JSON 消息，忽略 */ }
      };

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
    if (!config.credentials[CRED_KEY.endpoint]) {
      throw new Error('自定义 ASR 缺少 WebSocket 端点');
    }
  }

}
