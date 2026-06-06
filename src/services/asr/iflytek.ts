import type { ASRConfig, ASRProvider, ASRResult } from './types';
import { ensureConfigured } from '../provider-utils';

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

/** 凭证字段名，与 ASRConfig.credentials 中的 key 对应 */
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

  /** 结果队列——onmessage 逐条追加，recognize() 一次性消费，解决单槽覆盖丢失问题 */
  private resultQueue: ASRResult[] = [];

  /** 从队列中分离出的 interim 结果暂存——供 drainInterimResults() 外部拉取 */
  private pendingInterim: ASRResult[] = [];

  // ---- 公共接口 ----

  async configure(config: ASRConfig): Promise<void> {
    this.validateConfig(config);
    this.config = { ...config };
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
      return this.emptyResult(false);
    }

    try {
      /** 懒连接：首次调用时建立 WebSocket 并完成 RTASR 握手 */
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        await this.connect(cfg);
      }
      /** 发送 Uint8Array 视图自身——WebSocket 原生支持 ArrayBufferView，自动处理偏移与长度 */
      this.ws!.send(audio);
    } catch {
      return this.emptyResult(true);
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

  /**
   * 消费结果队列：分离 interim 与 final，返回最适合的识别结果
   * 优先返回最新 final 结果（供分句器），无 final 时返回最新 interim（供 UI 展示）
   * interim 暂存到 pendingInterim，调用方可通过 drainInterimResults() 单独拉取
   */
  private consumeQueue(): ASRResult {
    let latestInterim: ASRResult | null = null;
    let latestFinal: ASRResult | null = null;

    while (this.resultQueue.length > 0) {
      const r = this.resultQueue.shift()!;
      if (r.isFinal && r.text) {
        latestFinal = r;
      } else if (r.text) {
        latestInterim = r;
      }
    }

    /** interim 暂存供外部 drainInterimResults() 拉取 */
    if (latestInterim) {
      this.pendingInterim.push(latestInterim);
    }

    return latestFinal ?? latestInterim ?? this.emptyResult(false);
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

  /** 空结果快捷构造 */
  private emptyResult(isFinal: boolean): ASRResult {
    return { text: '', isFinal, confidence: 0, startTime: 0, endTime: 0 };
  }
}

// ---- 鉴权工具函数 ----

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

/**
 * 使用 Web Crypto API 计算 HMAC-SHA1 并返回 Base64 结果
 * 零外部依赖，浏览器原生 API，渲染进程可用
 */
async function hmacSha1Base64(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const messageData = enc.encode(message);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, messageData);
  return uint8ToBase64(new Uint8Array(sig));
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

// ---- 纯 JavaScript MD5 实现 ----

/**
 * RFC 1321 MD5 哈希算法，纯 JS 实现
 * 输入 UTF-8 字符串，输出小写 32 位 hex 字符串
 * crypto.subtle 不原生支持 MD5，故自实现，零依赖
 */
function md5Hex(input: string): string {
  /** 将 UTF-8 字符串转为字节数组 */
  const bytes = utf8Encode(input);
  const len = bytes.length;

  /** 填充：追加 0x80 + 补零 + 8 字节小端序原始长度（位） */
  const padded = new Uint8Array(((len + 8) >>> 6) + 1 << 6);
  padded.set(bytes);
  padded[len] = 0x80;

  /** 在最后 8 字节写入原始消息位长度（小端序，使用 32 位高低位） */
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);

  /** MD5 初始向量 */
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  /** 每 64 字节（16 个 32 位字）为一组处理 */
  for (let i = 0; i < padded.length; i += 64) {
    const X = new Array(16);
    const chunkView = new DataView(padded.buffer, i, 64);
    for (let j = 0; j < 16; j++) {
      X[j] = chunkView.getUint32(j * 4, true);
    }

    /** 四轮变换（每轮 16 步），每轮返回更新后的 [a,b,c,d] */
    const [r1a, r1b, r1c, r1d] = round1(a, b, c, d, X);
    const [r2a, r2b, r2c, r2d] = round2(r1a, r1b, r1c, r1d, X);
    const [r3a, r3b, r3c, r3d] = round3(r2a, r2b, r2c, r2d, X);
    const [r4a, r4b, r4c, r4d] = round4(r3a, r3b, r3c, r3d, X);

    a = (a + r4a) >>> 0;
    b = (b + r4b) >>> 0;
    c = (c + r4c) >>> 0;
    d = (d + r4d) >>> 0;
  }

  return toHex32(a) + toHex32(b) + toHex32(c) + toHex32(d);
}

// ---- MD5 辅助函数 ----

/** MD5 辅助函数 F, G, H, I */
function F(x: number, y: number, z: number): number { return (x & y) | (~x & z); }
function G(x: number, y: number, z: number): number { return (x & z) | (y & ~z); }
function H(x: number, y: number, z: number): number { return x ^ y ^ z; }
function I(x: number, y: number, z: number): number { return y ^ (x | ~z); }

/** 循环左移 */
function rotl(x: number, n: number): number { return (x << n) | (x >>> (32 - n)); }

/** 32 位无符号整数按 MD5 标准小端序输出（低位字节在前） */
function toHex32(val: number): string {
  return ((val & 0xff).toString(16).padStart(2, '0'))
    + (((val >>> 8) & 0xff).toString(16).padStart(2, '0'))
    + (((val >>> 16) & 0xff).toString(16).padStart(2, '0'))
    + (((val >>> 24) & 0xff).toString(16).padStart(2, '0'));
}

/** UTF-8 编码：字符串 → 字节数组 */
function utf8Encode(str: string): Uint8Array {
  const result: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    if (cp < 0x80) {
      result.push(cp);
    } else if (cp < 0x800) {
      result.push(0xc0 | (cp >>> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0xd800 || cp >= 0xe000) {
      result.push(0xe0 | (cp >>> 12), 0x80 | ((cp >>> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      /** 代理对：UTF-16 高/低位 → 码点 */
      i++;
      const lo = str.charCodeAt(i);
      const full = 0x10000 + ((cp & 0x3ff) << 10) + (lo & 0x3ff);
      result.push(
        0xf0 | (full >>> 18),
        0x80 | ((full >>> 12) & 0x3f),
        0x80 | ((full >>> 6) & 0x3f),
        0x80 | (full & 0x3f),
      );
    }
  }
  return new Uint8Array(result);
}

// ---- MD5 四轮变换 ----

/** 正弦表 T[i] = floor(4294967296 * |sin(i+1)|)，i=0..63 */
const T: number[] = [];
for (let i = 0; i < 64; i++) {
  T[i] = (Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
}

/** MD5 位移量：每轮 4 个值，各重复 4 次共 16 步 */
const S1 = [7, 12, 17, 22];
const S2 = [5, 9, 14, 20];
const S3 = [4, 11, 16, 23];
const S4 = [6, 10, 15, 21];

/** MD5 单步操作：op(a, b, c, d, f, x, s, t) */
type MD5State = [number, number, number, number];

function md5Op(
  func: (x: number, y: number, z: number) => number,
  a: number, b: number, c: number, d: number,
  x: number, t: number,
): number {
  return (a + func(b, c, d) + x + t) >>> 0;
}

function round1(aa: number, bb: number, cc: number, dd: number, X: number[]): MD5State {
  let a = aa; let b = bb; let c = cc; let d = dd;
  for (let i = 0; i < 16; i++) {
    const val = md5Op(F, a, b, c, d, X[i], T[i]);
    a = d;
    d = c;
    c = b;
    b = (b + rotl(val, S1[i % 4])) >>> 0;
  }
  return [a, b, c, d];
}

function round2(aa: number, bb: number, cc: number, dd: number, X: number[]): MD5State {
  let a = aa; let b = bb; let c = cc; let d = dd;
  for (let i = 0; i < 16; i++) {
    const k = (5 * i + 1) % 16;
    const val = md5Op(G, a, b, c, d, X[k], T[16 + i]);
    a = d;
    d = c;
    c = b;
    b = (b + rotl(val, S2[i % 4])) >>> 0;
  }
  return [a, b, c, d];
}

function round3(aa: number, bb: number, cc: number, dd: number, X: number[]): MD5State {
  let a = aa; let b = bb; let c = cc; let d = dd;
  for (let i = 0; i < 16; i++) {
    const k = (3 * i + 5) % 16;
    const val = md5Op(H, a, b, c, d, X[k], T[32 + i]);
    a = d;
    d = c;
    c = b;
    b = (b + rotl(val, S3[i % 4])) >>> 0;
  }
  return [a, b, c, d];
}

function round4(aa: number, bb: number, cc: number, dd: number, X: number[]): MD5State {
  let a = aa; let b = bb; let c = cc; let d = dd;
  for (let i = 0; i < 16; i++) {
    const k = (7 * i) % 16;
    const val = md5Op(I, a, b, c, d, X[k], T[48 + i]);
    a = d;
    d = c;
    c = b;
    b = (b + rotl(val, S4[i % 4])) >>> 0;
  }
  return [a, b, c, d];
}

// ---- 纯 JavaScript 工具函数 ----

/**
 * Uint8Array 转 Base64 字符串
 * 替代 Node.js Buffer.toString('base64')，渲染进程可用
 */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
