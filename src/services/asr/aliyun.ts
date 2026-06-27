import type { ASRConfig, ASRProvider, ASRResult } from './types';
import { consumeAsrResultQueue, emptyAsrResult, ensureConfigured } from '../provider-utils';
import { hmacSha1Base64 } from '../../utils/crypto';
import { firstScreenLatency } from '../../utils/first-screen-latency';

/**
 * 阿里云智能语音交互（NLS）实时语音识别 WebSocket API 协议常量
 * 参考文档：https://help.aliyun.com/zh/isi/real-time-speech-recognition-websocket-api
 *
 * 鉴权流程（两段式）：
 *   ① HTTP POST https://nls-meta.{region}.aliyuncs.com/
 *      → 阿里云 POP 签名（HMAC-SHA1）→ 获取临时 Token（1h 有效）
 *   ② WebSocket wss://nls-gateway-{region}.aliyuncs.com/ws/v1?token=<token>
 *      → 发送 StartTranscription 命令 → 收到 TranscriptionStarted → 逐帧 PCM → 接收结果
 *   区域通过 ASRConfig.region 注入，默认 cn-shanghai
 */
const PROTOCOL = {
  /** Token 有效期（秒）——Token 返回"ExpireTime":3600，提前 5 分钟刷新避免 WebSocket 中途断开 */
  TOKEN_TTL: 3300,
  /** 默认识别语言 */
  DEFAULT_LANG: 'en',
  /** 连接建立/握手超时（毫秒） */
  CONNECT_TIMEOUT: 10000,
  /** 采样率 */
  SAMPLE_RATE: 16000,
} as const;

/** 阿里云 NLS Token 获取端点——区域通过配置注入，消除硬编码 */
function getTokenEndpoint(region: string): string {
  return `https://nls-meta.${region}.aliyuncs.com/`;
}

/** 阿里云 NLS WebSocket 实时识别端点——区域通过配置注入，消除硬编码 */
function getWssUrl(region: string): string {
  return `wss://nls-gateway-${region}.aliyuncs.com/ws/v1`;
}

/** 凭证字段名 */
const CRED_KEY = {
  appKey: 'appKey',
  accessKeyId: 'accessKeyId',
  accessKeySecret: 'accessKeySecret',
} as const;

/** 阿里云 NLS WebSocket 服务端消息结构 */
interface AliyunNlsMessage {
  header: {
    name: string;
    task_id?: string;
    message_id?: string;
    status?: number;
    status_text?: string;
  };
  payload?: Record<string, unknown>;
}

/** Token 缓存——避免每次 connect 都重新获取 */
interface TokenCache {
  token: string;
  expiresAt: number;
}

/**
 * 阿里云 NLS 实时语音识别 WebSocket API 实现
 *
 * 遵循与 IFlyTekASR 一致的接口模式：懒连接、结果队列、连接锁、dispose 清理。
 * 额外处理：Token 自动获取与缓存（1h 有效期，提前 5 分钟刷新）。
 */
export class AliyunASR implements ASRProvider {
  readonly name = 'aliyun';

  private ws: WebSocket | null = null;
  private config: ASRConfig | null = null;
  private resultQueue: ASRResult[] = [];
  private pendingInterim: ASRResult[] = [];
  private connectingPromise: Promise<void> | null = null;
  private tokenCache: TokenCache | null = null;

  // ---- 公共接口 ----

  async configure(config: ASRConfig): Promise<void> {
    this.validateConfig(config);
    this.config = { ...config };
    /** 配置变更时清空 token 缓存，强制重新获取 */
    this.tokenCache = null;
  }

  /**
   * 预热 WebSocket 连接——提前获取 Token 并完成 NLS 握手
   * 可在音频捕获启动前调用，利用 getDisplayMedia 弹窗等待时间并行建连
   * 已连接时幂等返回，失败不抛异常——recognize() 首次调用时会重试
   */
  async preconnect(): Promise<void> {
    const cfg = ensureConfigured(this.config, '阿里云 ASR');
    if (this.ws?.readyState === WebSocket.OPEN) return;
    try {
      await this.connect(cfg);
    } catch {
      /** 预热失败静默——recognize() 内懒连接作为 fallback */
    }
  }

  /**
   * 发送 PCM 音频帧进行识别
   * 首次调用时懒建立 WebSocket（含 Token 获取 + 握手），后续直接发送二进制帧
   * 音频格式：16kHz / 16bit / 单声道 / PCM
   */
  async recognize(audio: Uint8Array): Promise<ASRResult> {
    const cfg = ensureConfigured(this.config, '阿里云 ASR');
    if (!audio || audio.length === 0) {
      return emptyAsrResult(false);
    }

    /** connect() 失败直接抛出——存在根本性障碍时（鉴权失败、服务未开通）不应静默重试 */
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect(cfg);
    }

    try {
      this.ws!.send(audio);
      firstScreenLatency.mark('first_audio_sent', `provider=${this.name} bytes=${audio.byteLength}`);
    } catch (err) {
      /** WebSocket 发送失败时关闭连接——下次 recognize() 会重新连接 */
      console.error('[阿里云 ASR] 音频发送失败:', err instanceof Error ? err.message : err);
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      throw err;
    }

    return this.consumeQueue();
  }

  drainInterimResults(): ASRResult[] {
    const arr = this.pendingInterim;
    this.pendingInterim = [];
    return arr;
  }

  dispose(): void {
    /** 发送 StopTranscription 命令结束识别会话——header 含 appkey 与 namespace，对齐 SDK 协议 */
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const stopMsg = JSON.stringify({
          header: this.buildNlsHeader('StopTranscription', this.config?.credentials[CRED_KEY.appKey] ?? '', 'stop-task'),
          context: this.buildNlsContext(),
        });
        this.ws.send(stopMsg);
      } catch { /* 连接可能已断开 */ }
      this.ws.close(1000);
    }
    this.ws = null;
    this.config = null;
    this.resultQueue = [];
    this.pendingInterim = [];
  }

  async validateCredentials(config: ASRConfig): Promise<boolean> {
    await this.configure(config);
    /** 获取 Token 成功即凭证有效——错误原样抛出，由 useConnectionTest catch 分支展示详情 */
    const token = await fetchToken(
      config.credentials.accessKeyId,
      config.credentials.accessKeySecret,
      config.region ?? 'cn-shanghai',
    );
    return token.length > 0;
  }

  // ---- 私有方法 ----

  /**
   * 建立 WebSocket 连接并完成 NLS 握手
   * 分三阶段：①等待 WebSocket open ②发送 StartTranscription + 等待确认 ③注册结果处理器
   * 各阶段抽取为独立方法，嵌套深度从 4 层降为 2 层
   */
  private async connect(cfg: ASRConfig): Promise<void> {
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = (async (): Promise<void> => {
      this.resultQueue = [];
      this.pendingInterim = [];

      const token = await this.getToken(cfg);
      const wssUrl = cfg.endpoint ?? getWssUrl(cfg.region ?? 'cn-shanghai');
      this.ws = new WebSocket(`${wssUrl}?token=${encodeURIComponent(token)}`);

      /** 阶段 ①：等待 WebSocket 连接建立 */
      await this.awaitWebSocketOpen();

      /** 阶段 ②：发送 StartTranscription 并等待 TranscriptionStarted 确认 */
      await this.performNlsHandshake(cfg);

      /** 阶段 ③：注册结果处理器 */
      this.setupResultHandler();
    })();

    try {
      await this.connectingPromise;
    } catch (err) {
      /** 连接失败时关闭 WebSocket 并清空引用——避免下次 recognize() 向未就绪的连接发送音频 */
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      throw err;
    } finally {
      this.connectingPromise = null;
    }
  }

  /** 阶段 ①：等待 WebSocket 连接建立——超时抛出明确错误 */
  private awaitWebSocketOpen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let connectTimer: ReturnType<typeof setTimeout> | null = null;
      this.ws!.onopen = () => {
        if (connectTimer) clearTimeout(connectTimer);
        firstScreenLatency.mark('asr_ws_open', `provider=${this.name}`);
        resolve();
      };
      this.ws!.onerror = () => {
        if (connectTimer) clearTimeout(connectTimer);
        reject(new Error('阿里云 NLS WebSocket 连接失败'));
      };
      connectTimer = setTimeout(
        () => reject(new Error('阿里云 NLS WebSocket 连接超时')),
        PROTOCOL.CONNECT_TIMEOUT,
      );
    });
  }

  /**
   * 阶段 ②：发送 StartTranscription 并等待 TranscriptionStarted 确认
   * appkey 位于 header 中（非 context），符合阿里云 NLS SDK 规范（lib/st.js:52-58）
   */
  private performNlsHandshake(cfg: ASRConfig): Promise<void> {
    const appKey = cfg.credentials[CRED_KEY.appKey];
    const taskId = `task-${Date.now()}`;
    const startMsg = JSON.stringify({
      header: this.buildNlsHeader('StartTranscription', appKey, taskId),
      payload: {
        format: 'pcm',
        sample_rate: PROTOCOL.SAMPLE_RATE,
        enable_intermediate_result: true,
        enable_punctuation_prediction: true,
        enable_inverse_text_normalization: true,
      },
      context: this.buildNlsContext(),
    });

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      this.ws!.onmessage = (event: MessageEvent) => {
        if (settled) return;
        try {
          const msg = JSON.parse(event.data as string) as AliyunNlsMessage;
          if (msg.header.name === 'TranscriptionStarted') {
            settled = true;
            if (timer) clearTimeout(timer);
            resolve();
          } else if (msg.header.name === 'TaskFailed') {
            settled = true;
            if (timer) clearTimeout(timer);
            console.error('[阿里云 ASR] 握手失败:', msg.header.status_text ?? '未知错误');
            reject(
              new Error(`阿里云 NLS 启动失败: ${msg.header.status_text ?? '未知错误'}`),
            );
          }
        } catch { /* 非 JSON 消息，忽略 */ }
      };

      this.ws!.onerror = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(new Error('阿里云 NLS 握手阶段 WebSocket 错误'));
      };

      /** 发送 Start 命令——以 Text Frame 发送 JSON 控制命令，WebSocket send(string) 自动使用 opcode 0x01 */
      this.ws!.send(startMsg);

      timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('阿里云 NLS 握手超时')); }
      }, PROTOCOL.CONNECT_TIMEOUT);
    });
  }

  /** 阶段 ③：注册识别结果处理器——TranscriptionResultChanged 中间结果 + SentenceEnd 最终结果 */
  private setupResultHandler(): void {
    this.ws!.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as AliyunNlsMessage;

        if (msg.header.name === 'TranscriptionResultChanged') {
          /** 中间结果 */
          const result = extractNlsResult(msg, false);
          if (result) this.resultQueue.push(result);
        } else if (msg.header.name === 'SentenceEnd') {
          /** 最终结果 */
          const result = extractNlsResult(msg, true);
          if (result) this.resultQueue.push(result);
        }
      } catch { /* JSON 解析失败，忽略 */ }
    };

    this.ws!.onclose = () => {
      this.resultQueue = [];
      this.pendingInterim = [];
    };
  }

  /** 获取或缓存阿里云 NLS Token */
  private async getToken(cfg: ASRConfig): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }

    const token = await fetchToken(
      cfg.credentials[CRED_KEY.accessKeyId],
      cfg.credentials[CRED_KEY.accessKeySecret],
      cfg.region ?? 'cn-shanghai',
    );

    this.tokenCache = {
      token,
      expiresAt: Date.now() + PROTOCOL.TOKEN_TTL * 1000,
    };

    return token;
  }

  /** 消费结果队列：委托公共工具 */
  private consumeQueue(): ASRResult {
    return consumeAsrResultQueue(this.resultQueue, this.pendingInterim);
  }

  private validateConfig(config: ASRConfig): void {
    const missing: string[] = [];
    if (!config.credentials[CRED_KEY.appKey]) missing.push(CRED_KEY.appKey);
    if (!config.credentials[CRED_KEY.accessKeyId]) missing.push(CRED_KEY.accessKeyId);
    if (!config.credentials[CRED_KEY.accessKeySecret]) missing.push(CRED_KEY.accessKeySecret);
    if (missing.length > 0) {
      throw new Error(`阿里云 ASR 缺少凭证: ${missing.join(', ')}`);
    }
  }

  /** 生成 UUID v4 格式 message_id——对齐阿里云 NLS SDK 协议（lib/st.js） */
  private generateMessageId(): string {
    return crypto.randomUUID();
  }

  /**
   * 构建 NLS 协议消息 header——消除 StartTranscription 与 StopTranscription 的重复结构
   * appkey 位于 header 中（非 context），符合阿里云 NLS SDK 规范（lib/st.js:52-58）
   */
  private buildNlsHeader(name: string, appKey: string, taskId: string): Record<string, string> {
    return {
      message_id: this.generateMessageId(),
      task_id: taskId,
      namespace: 'SpeechTranscriber',
      name,
      appkey: appKey,
    };
  }

  /** 构建 NLS context——SDK 元数据，不含业务鉴权参数 */
  private buildNlsContext(): Record<string, unknown> {
    return {
      sdk: { name: 'nls-electron-renderer', version: '1.0.0', language: 'javascript' },
    };
  }

}

// ---- Token 获取（阿里云 POP 签名） ----

/**
 * 通过阿里云 POP API 获取 NLS Token
 * 使用 HMAC-SHA1 签名鉴权
 * @param accessKeyId  RAM 用户 AccessKey ID
 * @param accessKeySecret  RAM 用户 AccessKey Secret
 * @param region  NLS 服务区域（如 cn-shanghai）
 */
async function fetchToken(accessKeyId: string, accessKeySecret: string, region: string): Promise<string> {
  const params: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: 'CreateToken',
    Version: '2019-02-28',
    Format: 'JSON',
    RegionId: region,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    /** 标准 ISO 8601 格式，剔除毫秒部分，保留原有 Z 后缀 */
    Timestamp: new Date().toISOString().replace(/\.\d{3}/, ''),
  };

  /** 构建签名——阿里云 POP RPC 风格 POST 请求，参数在 body 中以 form-urlencoded 编码 */
  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const stringToSign = `POST&${encodeURIComponent('/')}&${encodeURIComponent(queryString)}`;
  const signature = await hmacSha1Base64(stringToSign, `${accessKeySecret}&`);

  const url = getTokenEndpoint(region);
  const body = `${queryString}&Signature=${encodeURIComponent(signature)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    console.error('[阿里云 ASR] Token 获取失败: HTTP', response.status);
    throw new Error(`阿里云 Token 获取失败: HTTP ${response.status}`);
  }

  const json = (await response.json()) as { Token?: { Id?: string } };
  const token = json.Token?.Id;
  if (!token) {
    throw new Error('阿里云 Token 响应中未找到 Token.Id');
  }

  return token;
}

// ---- 识别结果解析 ----

/**
 * 从阿里云 NLS 消息中提取识别结果
 * payload.result 为识别文本，SentenceEnd 为最终结果
 */
function extractNlsResult(msg: AliyunNlsMessage, isFinal: boolean): ASRResult | null {
  const payload = msg.payload as { result?: string; confidence?: number } | undefined;
  if (!payload?.result) return null;

  return {
    text: payload.result,
    isFinal,
    confidence: payload.confidence ?? 0,
    startTime: 0,
    endTime: 0,
  };
}
