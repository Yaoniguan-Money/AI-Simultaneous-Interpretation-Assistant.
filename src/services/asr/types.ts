/**
 * ASR（语音识别）抽象接口类型定义
 * 所有语音识别供应商必须实现此接口，业务逻辑只依赖接口而非具体实现
 */

/** 支持的 ASR 供应商类型 */
export type ASRProviderType = 'iflytek' | 'aliyun' | 'deepgram' | 'custom';

/** ASR 供应商配置——不同供应商需要不同凭证字段 */
export interface ASRConfig {
  provider: ASRProviderType;
  /** 凭证键值对，如 { appId, apiSecret }，字段名随供应商而异 */
  credentials: Record<string, string>;
  /** 接口端点，如 https://raasr.xfyun.cn/v2/api/xxx */
  endpoint?: string;
  /** 识别语言，如 'en' | 'zh' */
  language?: string;
  /** 请求超时（毫秒），默认 10000 */
  timeout?: number;
}

/** ASR 识别结果 */
export interface ASRResult {
  /** 识别文本 */
  text: string;
  /** 是否为最终结果（false 表示中间结果） */
  isFinal: boolean;
  /** 置信度 0.0 ~ 1.0 */
  confidence: number;
  /** 音频起始时间戳（毫秒） */
  startTime: number;
  /** 音频结束时间戳（毫秒） */
  endTime: number;
}

/** 语音识别器抽象接口——所有供应商必须实现 */
export interface ASRProvider {
  /** 供应商名称，用于日志和 UI 展示 */
  readonly name: string;

  /** 配置并初始化，调用 API 前必须先调用此方法 */
  configure(config: ASRConfig): Promise<void>;

  /** 发送一段音频数据进行识别，返回识别结果 */
  recognize(audio: Buffer): Promise<ASRResult>;

  /** 释放资源（如有 WebSocket 连接等） */
  dispose(): void;

  /** 验证凭证是否有效，供设置面板"测试连接"使用 */
  validateCredentials(config: ASRConfig): Promise<boolean>;
}
