import type { ASRConfig, ASRProvider, ASRResult } from './types';
import { ensureConfigured } from '../provider-utils';

/**
 * 讯飞语音听写（流式版）WebSocket API 协议常量
 * 参考文档：https://www.xfyun.cn/doc/asr/voicedictation/API.html
 * 鉴权方式：HMAC-SHA256 签名 → Base64 → URL query 参数
 */
const PROTOCOL = {
  /** WebSocket 端点 */
  WSS_URL: 'wss://iat-api.xfyun.cn/v2/iat',
  /** 鉴权 host 字段 */
  HOST: 'iat-api.xfyun.cn',
  /** 鉴权 path 字段 */
  PATH: '/v2/iat',
  /** 业务 domain */
  DOMAIN: 'iat',
  /** 音频格式：16kHz / 16bit / 单声道 PCM */
  AUDIO_FORMAT: 'audio/L16;rate=16000',
  /** 音频编码方式 */
  AUDIO_ENCODING: 'raw',
  /** 首帧标识 */
  FRAME_FIRST: 0,
  /** 中间帧标识 */
  FRAME_CONTINUE: 1,
  /** 尾帧标识（发送后服务端开始关闭流） */
  FRAME_LAST: 2,
  /** 连接建立超时（毫秒） */
  CONNECT_TIMEOUT: 10000,
  /** 服务端响应等待超时（毫秒） */
  RESPONSE_TIMEOUT: 1000,
} as const;

/** 凭证字段名，与 ASRConfig.credentials 中的 key 对应 */
const CRED_KEY = {
  appId: 'appId',
  apiKey: 'apiKey',
  apiSecret: 'apiSecret',
} as const;

/**
 * cfg.language（内部简写 'en'/'zh'）→ 讯飞 API language 参数映射
 * 'en' → 'en_us'（英文），'zh' → 'zh_cn'（中文）
 */
const LANG_TO_API: Record<string, string> = {
  en: 'en_us',
  zh: 'zh_cn',
};

/** 讯飞 WebSocket 返回的 JSON 结构 */
interface IFlyTekWsMessage {
  code: number;
  message?: string;
  sid?: string;
  data?: {
    status?: number;
    result?: {
      sn?: number;
      ls?: boolean;
      ws?: Array<{
        bg?: number;
        ed?: number;
        cw?: Array<{ w?: string; sc?: number }>;
      }>;
    };
  };
}

/**
 * 讯飞语音听写（流式版）WebSocket API 实现
 *
 * 使用讯飞流式 WebSocket 接口，支持实时语音识别。
 * - 连接是懒初始化的：首次 recognize() 调用时建立 WebSocket
 * - recognize() 保持 Promise<ASRResult> 返回签名，与 ASRProvider 接口兼容
 * - dispose() 发送尾帧后关闭连接
 * - 无 Node.js 依赖，纯浏览器 API（WebSocket + Web Crypto），可在渲染进程运行
 */
export class IFlyTekASR implements ASRProvider {
  readonly name = 'iflytek';

  private ws: WebSocket | null = null;
  private config: ASRConfig | null = null;
  private isFirstFrame = true;

  /** onmessage 写入的下一个待消费结果 */
  private queuedResult: ASRResult | null = null;
  /** recognize() 中等待结果的 Promise resolver */
  private pendingResolve: ((r: ASRResult) => void) | null = null;
  /** recognize() 的等待超时定时器 */
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- 公共接口 ----

  async configure(config: ASRConfig): Promise<void> {
    this.validateConfig(config);
    this.config = { ...config };
  }

  async recognize(audio: Uint8Array): Promise<ASRResult> {
    const cfg = ensureConfigured(this.config, '讯飞 ASR');
    if (!audio || audio.length === 0) {
      return this.emptyResult(false);
    }

    try {
      /** 懒连接：首次调用时建立 WebSocket */
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        await this.connect(cfg);
      }

      /** 确定帧状态：首帧带 common+business，后续帧只带 data */
      const status = this.isFirstFrame ? PROTOCOL.FRAME_FIRST : PROTOCOL.FRAME_CONTINUE;
      this.sendFrame(audio, status);
      this.isFirstFrame = false;
    } catch {
      return this.emptyResult(true);
    }

    /** 若 onmessage 已缓存结果，直接返回（避免不必要的异步等待） */
    if (this.queuedResult) {
      const r = this.queuedResult;
      this.queuedResult = null;
      return r;
    }

    /** 等待服务端下一条消息，超时后返回空结果 */
    return new Promise<ASRResult>((resolve) => {
      this.pendingResolve = resolve;
      this.pendingTimer = setTimeout(() => {
        if (this.pendingResolve) {
          this.pendingResolve = null;
          resolve(this.emptyResult(false));
        }
      }, PROTOCOL.RESPONSE_TIMEOUT);
    });
  }

  dispose(): void {
    /** 发送尾帧通知服务端音频流结束 */
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          data: {
            status: PROTOCOL.FRAME_LAST,
            format: PROTOCOL.AUDIO_FORMAT,
            audio: '',
            encoding: PROTOCOL.AUDIO_ENCODING,
          },
        }));
      } catch { /* 连接可能已断开 */ }
      this.ws.close(1000);
    }
    this.ws = null;
    this.config = null;
    this.isFirstFrame = true;
    this.queuedResult = null;

    /** 清理等待中的 Promise */
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    if (this.pendingResolve) {
      this.pendingResolve(this.emptyResult(true));
      this.pendingResolve = null;
    }
  }

  /**
   * 验证凭证有效性
   * 建立 WebSocket → 发首帧静音 PCM → 发尾帧 → 等待服务端响应
   * 判定依据：code === 0 且 data.status === 2（服务端确认完整流程成功）
   * 空音频返回 w="" 是正常的，不以识别文本是否为空判断
   */
  async validateCredentials(config: ASRConfig): Promise<boolean> {
    try {
      await this.configure(config);

      const url = await buildAuthUrl(config);
      const ws = new WebSocket(url);
      /** settled 标记防止 onmessage/onclose/onerror/timeout 竞态 */
      let settled = false;
      let connectTimer: ReturnType<typeof setTimeout> | null = null;

      /** 连接阶段：等待 onopen，清理定时器防泄漏 */
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

      /** 发送首帧（空音频，仅验证鉴权）+ 尾帧 */
      ws.send(JSON.stringify(buildFirstFrame(config, new Uint8Array(0))));
      ws.send(JSON.stringify({
        data: { status: PROTOCOL.FRAME_LAST, format: PROTOCOL.AUDIO_FORMAT, audio: '', encoding: PROTOCOL.AUDIO_ENCODING },
      }));

      /** 等待服务端确认：code===0 且 data.status===2 表示鉴权通过且流程完成 */
      const ok = await new Promise<boolean>((resolve) => {
        let resultTimer: ReturnType<typeof setTimeout> | null = null;

        ws.onmessage = (event: MessageEvent) => {
          if (settled) return;
          try {
            const json = JSON.parse(event.data as string) as IFlyTekWsMessage;
            if (json.code === 0 && json.data?.status === 2) {
              settled = true;
              if (resultTimer) clearTimeout(resultTimer);
              resolve(true);
            }
          } catch { /* 解析失败，继续等待下一条消息 */ }
        };

        /** onclose code=1000 是正常关闭——但在收到成功结果前关闭说明服务端异常 */
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
        }, PROTOCOL.RESPONSE_TIMEOUT);
      });

      ws.close(1000);
      this.config = null;
      return ok;
    } catch {
      return false;
    }
  }

  // ---- 私有方法 ----

  /** 建立 WebSocket 连接并注册 onmessage 处理器 */
  private async connect(cfg: ASRConfig): Promise<void> {
    const url = await buildAuthUrl(cfg);
    this.ws = new WebSocket(url);
    this.isFirstFrame = true;
    this.queuedResult = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;

    await new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => {
        if (connectTimer) clearTimeout(connectTimer);
        resolve();
      };
      this.ws!.onerror = () => {
        if (connectTimer) clearTimeout(connectTimer);
        reject(new Error('WebSocket 连接失败'));
      };
      connectTimer = setTimeout(() => reject(new Error('WebSocket 连接超时')), PROTOCOL.CONNECT_TIMEOUT);
    });

    /** 注册消息处理器：解析服务端 JSON → 提取识别文本 → 通知等待的 recognize() */
    this.ws.onmessage = (event: MessageEvent) => {
      const result = parseResult(event.data as string);
      if (!result) return;

      if (this.pendingResolve) {
        /** 有 recognize() 正在等待 → 立即 resolve */
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        if (this.pendingTimer) clearTimeout(this.pendingTimer);
        resolve(result);
        /** 最终结果后重置状态 */
        if (result.isFinal) {
          this.queuedResult = null;
        }
      } else {
        /** 没有等待者 → 缓存结果供下一次 recognize() 消费 */
        this.queuedResult = result;
      }
    };

    this.ws.onclose = () => {
      /** 服务端主动关闭时清理等待 */
      if (this.pendingResolve) {
        this.pendingResolve(this.emptyResult(true));
        this.pendingResolve = null;
        if (this.pendingTimer) clearTimeout(this.pendingTimer);
      }
    };
  }

  /** 发送一帧音频数据 over WebSocket */
  private sendFrame(audio: Uint8Array, status: number): void {
    const cfg = this.config!;
    const frame = status === PROTOCOL.FRAME_FIRST
      ? buildFirstFrame(cfg, audio)
      : buildContinueFrame(audio);
    this.ws!.send(JSON.stringify(frame));
  }

  /** 校验配置完整性：appId/apiKey/apiSecret 三者缺一不可 */
  private validateConfig(config: ASRConfig): void {
    const missing: string[] = [];
    if (!config.credentials[CRED_KEY.appId]) missing.push(CRED_KEY.appId);
    if (!config.credentials[CRED_KEY.apiKey]) missing.push(CRED_KEY.apiKey);
    if (!config.credentials[CRED_KEY.apiSecret]) missing.push(CRED_KEY.apiSecret);
    if (missing.length > 0) {
      throw new Error(`讯飞 ASR 缺少凭证: ${missing.join(', ')}`);
    }
  }

  /** 空结果快捷构造 */
  private emptyResult(isFinal: boolean): ASRResult {
    return { text: '', isFinal, confidence: 0, startTime: 0, endTime: 0 };
  }
}

// ---- 帧构建函数（无状态，不依赖实例） ----

/** 构建首帧 JSON：包含 common.app_id + business + data */
function buildFirstFrame(cfg: ASRConfig, audio: Uint8Array): Record<string, unknown> {
  const langCode = cfg.language ?? 'en';
  return {
    common: { app_id: cfg.credentials[CRED_KEY.appId] },
    business: {
      domain: PROTOCOL.DOMAIN,
      language: LANG_TO_API[langCode] ?? LANG_TO_API.en,
      accent: 'mandarin',
      vad_eos: 10000,
    },
    data: {
      status: PROTOCOL.FRAME_FIRST,
      format: PROTOCOL.AUDIO_FORMAT,
      audio: audio.length > 0 ? uint8ToBase64(audio) : '',
      encoding: PROTOCOL.AUDIO_ENCODING,
    },
  };
}

/** 构建中间帧 JSON：仅含 data */
function buildContinueFrame(audio: Uint8Array): Record<string, unknown> {
  return {
    data: {
      status: PROTOCOL.FRAME_CONTINUE,
      format: PROTOCOL.AUDIO_FORMAT,
      audio: uint8ToBase64(audio),
      encoding: PROTOCOL.AUDIO_ENCODING,
    },
  };
}

// ---- 结果解析 ----

/**
 * 解析 WebSocket 返回的 JSON 识别结果
 * 从 ws[].cw[].w 逐词拼接文本，ls 字段决定是否为最终结果
 * 返回 null 表示非识别结果消息（如心跳或首帧确认）
 */
function parseResult(rawData: string): ASRResult | null {
  try {
    const json = JSON.parse(rawData) as IFlyTekWsMessage;
    if (json.code !== 0) return null;

    const result = json.data?.result;
    if (!result?.ws) return null;

    const words: string[] = [];
    for (const w of result.ws) {
      if (w.cw && w.cw.length > 0 && w.cw[0].w) {
        words.push(w.cw[0].w);
      }
    }

    return {
      text: words.join(''),
      isFinal: result.ls ?? false,
      confidence: 1.0,
      startTime: 0,
      endTime: 0,
    };
  } catch {
    return null;
  }
}

// ---- 鉴权工具函数 ----

/**
 * 构建讯飞 WebSocket 鉴权 URL
 * 鉴权流程：signature_origin → HMAC-SHA256(apiSecret) → Base64 →
 *   authorization_origin → Base64 → 拼接到 URL query
 */
async function buildAuthUrl(cfg: ASRConfig): Promise<string> {
  const apiKey = cfg.credentials[CRED_KEY.apiKey];
  const apiSecret = cfg.credentials[CRED_KEY.apiSecret];
  /** RFC1123 GMT 格式日期：Wed, 21 Jun 2023 12:00:00 GMT */
  const date = new Date().toUTCString();

  /** signature_origin：host + date + request-line，换行分隔 */
  const signatureOrigin = `host: ${PROTOCOL.HOST}\ndate: ${date}\nGET ${PROTOCOL.PATH} HTTP/1.1`;
  const signature = await hmacSha256Base64(signatureOrigin, apiSecret);

  /** authorization_origin 格式固定，headers 值为字面量 "host date request-line" */
  const authOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  /** authorization 为 authOrigin 的 Base64 编码 */
  const authorization = btoa(authOrigin);

  return `${PROTOCOL.WSS_URL}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${PROTOCOL.HOST}`;
}

/**
 * 使用 Web Crypto API 计算 HMAC-SHA256 并返回 Base64 结果
 * 零外部依赖，浏览器原生 API，渲染进程可用
 */
async function hmacSha256Base64(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const messageData = enc.encode(message);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, messageData);
  return uint8ToBase64(new Uint8Array(sig));
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
