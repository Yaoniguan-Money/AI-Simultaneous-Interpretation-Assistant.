import type { ASRConfig, ASRProvider, ASRResult } from './types';
import { ensureConfigured } from '../provider-utils';

/**
 * 讯飞语音听写 REST API 协议常量
 * 这些是讯飞 API 的固定协议参数，不属于业务配置
 */
const PROTOCOL = {
  /** 鉴权 header 字段名 */
  HEADER_APP_ID: 'X-Appid',
  HEADER_TIMESTAMP: 'X-CurTime',
  HEADER_PARAM: 'X-Param',
  HEADER_CHECKSUM: 'X-CheckSum',
  /** 请求体 form 字段名 */
  FORM_AUDIO_FIELD: 'audio',
  /** 响应成功码 */
  SUCCESS_CODE: '0',
  /** 音频原始编码标识 */
  AUDIO_ENCODING_RAW: 'raw',
  /** 英文引擎类型标识 */
  ENGINE_EN: 'en',
  /** 中文引擎类型标识 */
  ENGINE_ZH: 'zh',
} as const;

/** 供应商默认配置——用户可通过 ASRConfig 覆盖 */
const DEFAULTS = {
  endpoint: 'https://raasr.xfyun.cn/v2/api/upload',
  language: 'en',
} as const;

/** 凭证字段名，与 ASRConfig.credentials 中的 key 对应 */
const CRED_KEY = {
  appId: 'appId',
  apiSecret: 'apiSecret',
} as const;

/** 讯飞 API 返回的 JSON 结构 */
interface IFlyTekResponse {
  code: string;
  desc?: string;
  message?: string;
  data?: {
    text?: string;
  };
}

/**
 * 讯飞语音听写 REST API 实现（纯 JS 版本，零 Node.js 依赖）
 * 可在渲染进程和主进程中使用
 */
export class IFlyTekASR implements ASRProvider {
  readonly name = 'iflytek';

  private config: ASRConfig | null = null;
  private abortController: AbortController | null = null;

  async configure(config: ASRConfig): Promise<void> {
    this.validateConfig(config);
    this.config = { ...config };
  }

  async recognize(audio: Uint8Array): Promise<ASRResult> {
    const cfg = ensureConfigured(this.config, '讯飞 ASR');
    if (!audio || audio.length === 0) {
      return { text: '', isFinal: true, confidence: 0, startTime: 0, endTime: 0 };
    }

    this.abortController = new AbortController();
    const endpoint = cfg.endpoint ?? DEFAULTS.endpoint;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const paramBase64 = this.encodeParam(cfg);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(cfg, timestamp, paramBase64),
        body: this.buildFormBody(audio),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`讯飞 API HTTP ${response.status}`);
      }

      return await this.parseResponse(response);
    } catch (error) {
      if (this.isAbortError(error)) {
        return { text: '', isFinal: true, confidence: 0, startTime: 0, endTime: 0 };
      }
      throw error;
    }
  }

  dispose(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.config = null;
  }

  async validateCredentials(config: ASRConfig): Promise<boolean> {
    try {
      /** 1 秒静音 PCM 16kHz 16bit mono：32000 字节全零 */
      const testAudio = new Uint8Array(32000);
      const tempASR = new IFlyTekASR();
      await tempASR.configure(config);
      const result = await tempASR.recognize(testAudio);
      tempASR.dispose();
      return result.confidence >= 0;
    } catch {
      return false;
    }
  }

  // ---- 请求构建 ----

  /** 构建鉴权请求头 */
  private buildHeaders(
    cfg: ASRConfig,
    timestamp: string,
    paramBase64: string,
  ): Record<string, string> {
    const apiSecret = cfg.credentials[CRED_KEY.apiSecret];
    return {
      [PROTOCOL.HEADER_APP_ID]: cfg.credentials[CRED_KEY.appId],
      [PROTOCOL.HEADER_TIMESTAMP]: timestamp,
      [PROTOCOL.HEADER_PARAM]: paramBase64,
      [PROTOCOL.HEADER_CHECKSUM]: this.computeChecksum(apiSecret, timestamp, paramBase64),
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }

  /** 将音频参数编码为 base64，一次请求内结果不变故独立计算 */
  private encodeParam(cfg: ASRConfig): string {
    const lang = cfg.language ?? DEFAULTS.language;
    const engineType = lang === 'en' ? PROTOCOL.ENGINE_EN : PROTOCOL.ENGINE_ZH;
    const param = {
      engine_type: engineType,
      aue: PROTOCOL.AUDIO_ENCODING_RAW,
    };
    /** btoa 替代 Node.js Buffer.from().toString('base64') */
    return btoa(JSON.stringify(param));
  }

  /** 计算讯飞鉴权 checksum：纯 JS MD5 替代 Node crypto */
  private computeChecksum(apiSecret: string, timestamp: string, paramBase64: string): string {
    return md5Hex(apiSecret + timestamp + paramBase64);
  }

  /** 构建请求体，音频数据 base64 编码后放入 form */
  private buildFormBody(audio: Uint8Array): URLSearchParams {
    const params = new URLSearchParams();
    params.set(PROTOCOL.FORM_AUDIO_FIELD, uint8ToBase64(audio));
    return params;
  }

  // ---- 响应解析 ----

  /** 解析讯飞 JSON 响应，提取识别文本 */
  private async parseResponse(response: Response): Promise<ASRResult> {
    const json = (await response.json()) as IFlyTekResponse;

    if (json.code !== PROTOCOL.SUCCESS_CODE) {
      const desc = json.desc ?? json.message ?? '未知错误';
      throw new Error(`讯飞 API 错误 (${json.code}): ${desc}`);
    }

    return {
      text: json.data?.text ?? '',
      isFinal: true,
      confidence: 1.0,
      startTime: 0,
      endTime: 0,
    };
  }

  // ---- 工具 ----

  /** 校验配置完整性 */
  private validateConfig(config: ASRConfig): void {
    const missing: string[] = [];
    if (!config.credentials[CRED_KEY.appId]) missing.push(CRED_KEY.appId);
    if (!config.credentials[CRED_KEY.apiSecret]) missing.push(CRED_KEY.apiSecret);
    if (missing.length > 0) {
      throw new Error(`讯飞 ASR 缺少凭证: ${missing.join(', ')}`);
    }
  }

  /** 判断是否为 AbortController 取消的信号 */
  private isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }
}

// ---- 纯 JavaScript 工具函数（替代 Node.js crypto 和 Buffer） ----

/**
 * 计算字符串的 MD5 哈希并返回十六进制字符串
 * 纯 JavaScript 实现，零外部依赖，渲染进程和主进程均可使用
 * 输入为短字符串（讯飞鉴权签名：apiSecret + timestamp + param，通常 < 200 字节）
 */
function md5Hex(input: string): string {
  /** 将字符串转为 UTF-8 字节数组 */
  const bytes = new TextEncoder().encode(input);
  /** MD5 核心算法（RFC 1321） */
  const words = md5(bytes);
  /** 将 4 个 32-bit word 转为 32 字符十六进制字符串 */
  const hex = (w: number): string =>
    ((w >>> 0).toString(16).padStart(8, '0'));
  return hex(words[0]) + hex(words[1]) + hex(words[2]) + hex(words[3]);
}

/**
 * 纯 JS MD5 实现（RFC 1321）
 * 输入为 Uint8Array，输出为 4 个 32-bit integer 的数组
 */
function md5(input: Uint8Array): [number, number, number, number] {
  /** MD5 每轮移位量（常量） */
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
             5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
             4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
             6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

  /** MD5 常量表：floor(abs(sin(i + 1)) * 2^32) */
  const K: number[] = [];
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  }

  /** 填充消息至 512-bit 对齐 */
  const msgLen = input.length;
  const padLen = (msgLen % 64 < 56) ? (56 - msgLen % 64) : (120 - msgLen % 64);
  const padded = new Uint8Array(msgLen + padLen + 8);
  padded.set(input);
  padded[msgLen] = 0x80;

  /** 写入原始消息长度（低 64 位，little-endian） */
  const bitLen = msgLen * 8;
  const lenView = new DataView(padded.buffer, padded.byteLength - 8, 8);
  lenView.setUint32(0, bitLen, true);      // 低 32 位
  lenView.setUint32(4, Math.floor(bitLen / 0x100000000), true); // 高 32 位

  /** 初始化 MD5 寄存器 */
  let a = 0x67452301;
  let b = 0xEFCDAB89;
  let c = 0x98BADCFE;
  let d = 0x10325476;

  /** 逐 512-bit 块处理 */
  const view = new DataView(padded.buffer);
  for (let offset = 0; offset < padded.length; offset += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] = view.getUint32(offset + i * 4, true);
    }

    let [aa, bb, cc, dd] = [a, b, c, d];

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (bb & cc) | (~bb & dd);
        g = i;
      } else if (i < 32) {
        f = (dd & bb) | (~dd & cc);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = bb ^ cc ^ dd;
        g = (3 * i + 5) % 16;
      } else {
        f = cc ^ (bb | ~dd);
        g = (7 * i) % 16;
      }
      const temp = dd;
      dd = cc;
      cc = bb;
      bb = (bb + leftRotate(aa + f + K[i] + M[g], S[i])) >>> 0;
      aa = temp;
    }

    a = (a + aa) >>> 0;
    b = (b + bb) >>> 0;
    c = (c + cc) >>> 0;
    d = (d + dd) >>> 0;
  }

  return [a, b, c, d];
}

/** 32-bit 循环左移 */
function leftRotate(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/**
 * Uint8Array 转 Base64 字符串
 * 替代 Node.js Buffer.toString('base64')
 */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
