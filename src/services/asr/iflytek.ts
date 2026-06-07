import type { ASRConfig, ASRProvider, ASRResult } from './types';
import { consumeAsrResultQueue, emptyAsrResult, ensureConfigured } from '../provider-utils';
import { hmacSha1Base64, md5Hex } from '../../utils/crypto';

/**
 * 讯飞实时语音转写（RTASR）WebSocket API 协议常量
 * 参考文档：https://www.xfyun.cn/doc/asr/rtasr/API.html
 * 鉴权方式：signa = Base64(HmacSHA1(MD5(appid + ts), apiKey))
 */
const PROTOCOL = {
  /** WebSocket 端点 */
  WSS_URL: 'wss://rtasr.xfyun.cn/v1/ws',
  /** 默认识别语言（URL 的 lang 参数） */
  DEFAULT_LANG: 'en',
  /** 连接建立/握手超时（毫秒） */
  CONNECT_TIMEOUT: 10000,
} as const;

/** 凭证字段名，与 ASRConfig.credentials 中的 key 对应
 *  注意：apiKey 对应讯飞控制台的 APISecret（密钥），用于 HMAC-SHA1 签名，非 APIKey */
const CRED_KEY = {
  appId: 'appId',
  apiKey: 'apiKey',
} as const;

/** RTASR WebSocket 服务端消息外层结构 */
interface RTASRWsMessage {
  action: string;
  code: string;
  data: string;
  desc: string;
  sid: string;
}

/** RTASR data 字段解析后的识别结果嵌套结构 */
interface RTASRResultData {
  cn?: {
    st?: {
      bg?: string;
      ed?: string;
      rt?: Array<{
        ws?: Array<{
          cw?: Array<{ w?: string; wp?: string }>;
          wb?: number;
          we?: number;
        }>;
      }>;
      type?: string;
    };
  };
  seg_id?: number;
}

/**
 * 讯飞实时语音转写（RTASR）WebSocket API 实现
 *
 * 使用讯飞 RTASR WebSocket 协议，支持不限时长实时语音识别。
 * - 连接懒初始化：首次 recognize() 调用时建立 WebSocket 并完成握手
 * - recognize() 保持 Promise<ASRResult> 签名，与 ASRProvider 接口兼容
 * - 鉴权使用 MD5 + HMAC-SHA1 签名（crypto.subtle），纯浏览器 API
 * - 音频以二进制 PCM 直接发送，不再经 Base64 / JSON 包裹
 * - dispose() 发送 {"end": true} 结束信号后关闭连接
 */
export class IFlyTekASR implements ASRProvider {
  readonly name = 'iflytek';

  private ws: WebSocket | null = null;
  private config: ASRConfig | null = null;

  /** onmessage 写入的识别结果 FIFO 队列——recognize() 非阻塞取走，防止单槽覆盖导致结果丢失 */
  private resultQueue: ASRResult[] = [];

  /** 从队列中分离出的 interim 结果暂存——供 drainInterimResults() 外部拉取 */
  private pendingInterim: ASRResult[] = [];

  /** 连接进行中 Promise——防止并发 processChunk 触发多个并行 connect() 产生孤儿 WebSocket */
  private connectingPromise: Promise<void> | null = null;

  // ---- 公共接口 ----

  async configure(config: ASRConfig): Promise<void> {
    this.validateConfig(config);
    this.config = { ...config };
  }

  /**
   * 预热 WebSocket 连接——提前建立连接并完成 RTASR 握手
   * 可在音频捕获启动前调用，利用 getDisplayMedia 弹窗等待时间并行建连
   * 已连接时幂等返回，失败不抛异常——recognize() 首次调用时会重试
   */
  async preconnect(): Promise<void> {
    const cfg = ensureConfigured(this.config, '讯飞 ASR');
    if (this.ws?.readyState === WebSocket.OPEN) return;
    try {
      await this.connect(cfg);
    } catch {
      /** 预热失败静默——recognize() 内懒连接作为 fallback */
    }
  }

  /**
   * 发送一段 PCM 音频数据进行识别——非阻塞模式
   * RTASR 是流式协议：发送与接收独立。采用「发送即忘 + 拉取队列缓存」模式，
   * 队列化解决单槽覆盖丢失问题。
   * 音频格式要求：16kHz / 16bit / 单声道 / PCM 原始数据
   */
  async recognize(audio: Uint8Array): Promise<ASRResult> {
    const cfg = ensureConfigured(this.config, '讯飞 ASR');
    if (!audio || audio.length === 0) {
      return emptyAsrResult(false);
    }

    try {
      /** 懒连接：首次调用时建立 WebSocket 并完成 RTASR 握手 */
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        await this.connect(cfg);
      }
      /** 发送 Uint8Array 视图自身——WebSocket 原生支持 ArrayBufferView，自动处理偏移与长度 */
      this.ws!.send(audio);
    } catch {
      return emptyAsrResult(true);
    }

    /** 消费队列：分离 interim 与 final，返回最终结果 */
    return this.consumeQueue();
  }

  /**
   * 拉取本次 recognize() 调用期间累积的所有 interim 结果
   * 供 FastChannelPipeline 分发给字幕 UI 展示实时识别文本
   * 注意：此方法不在 ASRProvider 接口中——由 pipeline 可选调用
   */
  drainInterimResults(): ASRResult[] {
    const arr = this.pendingInterim;
    this.pendingInterim = [];
    return arr;
  }

  // ---- 私有方法 ----

  /** 消费结果队列：委托公共工具 consumeAsrResultQueue */
  private consumeQueue(): ASRResult {
    return consumeAsrResultQueue(this.resultQueue, this.pendingInterim);
  }

  dispose(): void {
    /** 发送 {"end": true} 二进制消息，通知服务端音频流结束 */
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const encoder = new TextEncoder();
        this.ws.send(encoder.encode(JSON.stringify({ end: true })));
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
   * 建立 WebSocket → 等待 "started" 握手确认 → 关闭连接
   * 失败时通过 console.error 输出服务端返回的具体错误码和描述
   */
  async validateCredentials(config: ASRConfig): Promise<boolean> {
    try {
      await this.configure(config);
      const ok = await testAuthHandshake(config);
      this.config = null;
      return ok;
    } catch {
      return false;
    }
  }

  // ---- 私有方法 ----

  /**
   * 建立 WebSocket 连接并完成 RTASR 握手
   * 分两阶段：①等待 WebSocket open + ②等待服务端 started 确认
   */
  private async connect(cfg: ASRConfig): Promise<void> {
    /** 连接锁：已有进行中的连接则复用其 Promise，避免并发 processChunk 产生孤儿 WebSocket */
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = (async (): Promise<void> => {
      const url = await buildAuthUrl(cfg);
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
          reject(new Error('WebSocket 连接失败'));
        };
        connectTimer = setTimeout(
          () => reject(new Error('WebSocket 连接超时')),
          PROTOCOL.CONNECT_TIMEOUT,
        );
      });

      /** 阶段 ②：等待 RTASR 握手确认 */
      await this.awaitHandshake();

      /** 阶段 ③：注册结果处理器——结果追加到队列，recognize() 消费时批量取出 */
      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as RTASRWsMessage;

          if (msg.action === 'error') {
            console.error(`[RTASR] 服务端错误: ${msg.desc} (code: ${msg.code})`);
            return;
          }

          if (msg.action === 'result' && msg.data) {
            const result = extractRTASRResult(msg.data);
            if (result) {
              this.resultQueue.push(result);
            }
          }
        } catch { /* JSON 解析失败，忽略本条消息 */ }
      };

      /** 服务端主动关闭——清空队列，下次 recognize() 调用时自动重连 */
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

  /**
   * 等待 RTASR 握手确认
   * 服务端返回 {"action":"started","code":"0"} 表示鉴权通过
   * 返回 {"action":"error"} 表示鉴权失败
   */
  private awaitHandshake(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      this.ws!.onmessage = (event: MessageEvent) => {
        if (settled) return;
        try {
          const msg = JSON.parse(event.data as string) as RTASRWsMessage;
          if (msg.action === 'started' && msg.code === '0') {
            settled = true;
            if (timer) clearTimeout(timer);
            resolve();
          } else if (msg.action === 'error') {
            settled = true;
            if (timer) clearTimeout(timer);
            reject(new Error(`RTASR 握手失败: ${msg.desc} (code: ${msg.code})`));
          }
        } catch { /* 非 JSON 消息，忽略 */ }
      };

      this.ws!.onerror = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(new Error('RTASR 握手阶段 WebSocket 错误'));
      };

      timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('RTASR 握手超时')); }
      }, PROTOCOL.CONNECT_TIMEOUT);
    });
  }

  /** 校验配置完整性：仅需 appId + apiKey */
  private validateConfig(config: ASRConfig): void {
    const missing: string[] = [];
    if (!config.credentials[CRED_KEY.appId]) missing.push(CRED_KEY.appId);
    if (!config.credentials[CRED_KEY.apiKey]) missing.push(CRED_KEY.apiKey);
    if (missing.length > 0) {
      throw new Error(`讯飞 ASR 缺少凭证: ${missing.join(', ')}`);
    }
  }
}

// ---- 鉴权工具函数（讯飞特定） ----

/**
 * 构建 RTASR WebSocket 鉴权 URL
 * 鉴权流程：appid + ts → MD5 → HMAC-SHA1(apiKey) → Base64 → URL query
 * signa = Base64(HmacSHA1(MD5(appid + ts), apiKey))
 */
async function buildAuthUrl(cfg: ASRConfig): Promise<string> {
  const appId = cfg.credentials[CRED_KEY.appId];
  const apiKey = cfg.credentials[CRED_KEY.apiKey];
  const ts = Math.floor(Date.now() / 1000).toString();
  const lang = cfg.language ?? PROTOCOL.DEFAULT_LANG;

  /** 优先使用配置 endpoint，未提供时回退到默认 WSS_URL */
  const baseUrl = cfg.endpoint ?? PROTOCOL.WSS_URL;
  const md5Str = md5Hex(appId + ts);
  const signa = await hmacSha1Base64(md5Str, apiKey);

  return `${baseUrl}?appid=${encodeURIComponent(appId)}&ts=${ts}&signa=${encodeURIComponent(signa)}&lang=${encodeURIComponent(lang)}`;
}

/**
 * 创建测试 WebSocket 并等待 RTASR 握手确认
 * 供 validateCredentials 专用，与 connect() 的握手逻辑独立
 * 握手成功→true，握手失败/超时→false
 */
async function testAuthHandshake(cfg: ASRConfig): Promise<boolean> {
  const url = await buildAuthUrl(cfg);
  const ws = new WebSocket(url);
  let settled = false;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  /** 等待 onopen */
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      if (connectTimer) clearTimeout(connectTimer);
      resolve();
    };
    ws.onerror = () => {
      if (connectTimer) clearTimeout(connectTimer);
      if (!settled) { settled = true; reject(new Error('WebSocket 连接失败')); }
    };
    connectTimer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('连接超时')); }
    }, PROTOCOL.CONNECT_TIMEOUT);
  });

  /** 等待握手：action="started"=成功，action="error"=失败 */
  const ok = await new Promise<boolean>((resolve) => {
    let resultTimer: ReturnType<typeof setTimeout> | null = null;

    ws.onmessage = (event: MessageEvent) => {
      if (settled) return;
      try {
        const msg = JSON.parse(event.data as string) as RTASRWsMessage;
        if (msg.action === 'started' && msg.code === '0') {
          settled = true;
          if (resultTimer) clearTimeout(resultTimer);
          resolve(true);
        } else if (msg.action === 'error') {
          settled = true;
          if (resultTimer) clearTimeout(resultTimer);
          console.error(`[RTASR] 鉴权失败: ${msg.desc} (code: ${msg.code})`);
          resolve(false);
        }
      } catch { /* JSON 解析失败，继续等待 */ }
    };

    ws.onclose = () => {
      if (settled) return;
      settled = true;
      if (resultTimer) clearTimeout(resultTimer);
      resolve(false);
    };

    ws.onerror = () => {
      if (settled) return;
      settled = true;
      if (resultTimer) clearTimeout(resultTimer);
      resolve(false);
    };

    resultTimer = setTimeout(() => {
      if (!settled) { settled = true; resolve(false); }
    }, PROTOCOL.CONNECT_TIMEOUT);
  });

  ws.close(1000);
  return ok;
}

// ---- 识别结果解析 ----

/**
 * 从 RTASR 词信息列表中提取平均置信度
 * wp（word probability）为每个词的置信度浮点字符串，缺失时回退到 1.0
 */
/** wp 为每词置信度浮点字符串，取平均值；缺失或解析失败回退到 1.0 */
function extractConfidence(ws: Array<{ cw?: Array<{ wp?: string }> }> | undefined): number {
  let total = 0;
  let count = 0;
  for (const w of ws ?? []) {
    const wp = w.cw?.[0]?.wp;
    if (wp) {
      const parsed = parseFloat(wp);
      if (!isNaN(parsed)) {
        total += parsed;
        count++;
      }
    }
  }
  return count > 0 ? total / count : 1.0;
}

/**
 * 解析 RTASR 服务端返回的识别结果
 * msg.data 是 JSON 字符串，需二次解析
 * 文本提取路径：cn.st.rt[0].ws[].cw[].w 逐词拼接
 * type="0"=最终结果，"1"=中间结果
 * 返回 null 表示非识别结果消息（如心跳）
 */
function extractRTASRResult(rawData: string): ASRResult | null {
  try {
    const data = JSON.parse(rawData) as RTASRResultData;
    const st = data.cn?.st;
    if (!st?.rt?.[0]?.ws) return null;

    const words: string[] = [];
    for (const w of st.rt[0].ws) {
      if (w.cw?.[0]?.w) {
        words.push(w.cw[0].w);
      }
    }

    const text = words.join('');
    const isFinal = st.type === '0';

    return {
      text,
      isFinal,
      confidence: extractConfidence(st.rt[0].ws),
      startTime: st.bg ? Number(st.bg) : 0,
      endTime: st.ed ? Number(st.ed) : 0,
    };
  } catch {
    return null;
  }
}
