import type { ASRConfig, ASRProvider, ASRResult } from './types';
import { ensureConfigured } from '../provider-utils';
import crypto from 'crypto';

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
 * 讯飞语音听写 REST API 实现
 * 通过 HTTP POST 上传音频，返回识别文本
 */
export class IFlyTekASR implements ASRProvider {
  readonly name = 'iflytek';

  private config: ASRConfig | null = null;
  private abortController: AbortController | null = null;

  async configure(config: ASRConfig): Promise<void> {
    this.validateConfig(config);
    this.config = { ...config };
  }

  async recognize(audio: Buffer): Promise<ASRResult> {
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
      // 最小有效音频片段：1 秒静音 PCM 16kHz 16bit mono
      const testAudio = Buffer.alloc(32000, 0);
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
    return Buffer.from(JSON.stringify(param)).toString('base64');
  }

  /** 计算讯飞鉴权 checksum */
  private computeChecksum(apiSecret: string, timestamp: string, paramBase64: string): string {
    return crypto
      .createHash('md5')
      .update(apiSecret + timestamp + paramBase64)
      .digest('hex');
  }

  /** 将音频数据编码为 form 请求体 */
  private buildFormBody(audio: Buffer): URLSearchParams {
    const params = new URLSearchParams();
    params.set(PROTOCOL.FORM_AUDIO_FIELD, audio.toString('base64'));
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
