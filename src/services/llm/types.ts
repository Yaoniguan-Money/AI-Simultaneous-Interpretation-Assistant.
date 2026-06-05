/**
 * LLM（大语言模型）抽象接口类型定义
 * 所有翻译/分析模型供应商必须实现此接口，业务逻辑只依赖接口
 */

/** 支持的 LLM 供应商类型 */
export type LLMProviderType = 'deepseek' | 'qwen' | 'zhipu' | 'custom';

/** LLM 供应商配置 */
export interface LLMConfig {
  provider: LLMProviderType;
  /** 凭证，如 { apiKey: 'sk-xxx' } */
  credentials: Record<string, string>;
  /** API 端点，默认各供应商内置 */
  endpoint?: string;
  /** 模型名，如 'deepseek-chat' */
  model?: string;
  /** 最大输出 token 数，默认 1024 */
  maxTokens?: number;
  /** 生成温度 0.0~2.0，翻译建议 0.1~0.3 */
  temperature?: number;
  /** 请求超时（毫秒），默认 30000 */
  timeout?: number;
}

/** 已翻译的句子记录，用于修正检测的上下文回溯 */
export interface TranslatedSentence {
  index: number;
  original: string;
  translation: string;
}

/** 共享上下文——由 Channel 2 注入，Channel 1 翻译时携带 */
export interface SharedContext {
  domain: string | null;
  domainConfidence: number;
  activeTerms: Map<string, string>;
  recentSummary: string;
}

/** 翻译请求——包含待翻译文本和完整上下文 */
export interface TranslationRequest {
  text: string;
  context: SharedContext;
  /** 前几句翻译记录，用于一致性检测和修正 */
  previousSentences: TranslatedSentence[];
}

/** 翻译修正——当后文上下文推翻前文翻译时生成 */
export interface Correction {
  /** 被修正句子的索引 */
  sentenceIndex: number;
  /** 旧译文 */
  oldTranslation: string;
  /** 新译文 */
  newTranslation: string;
  /** 修正原因简述 */
  reason: string;
}

/** 流式翻译 token */
export interface Token {
  text: string;
  index: number;
}

/** 翻译结果 */
export interface TranslationResult {
  translation: string;
  corrections: Correction[];
  tokens: Token[];
}

/** 领域检测结果 */
export interface DomainInfo {
  name: string;
  confidence: number;
}

/** 术语对 */
export interface TermEntry {
  original: string;
  translation: string;
}

/** Channel 2 分析结果 */
export interface AnalysisResult {
  domain: DomainInfo | null;
  terms: TermEntry[];
  /** 滚动会议摘要 */
  summary: string;
  /** 是否发生话题切换 */
  topicShift: boolean;
}

/** LLM 供应商抽象接口——所有 LLM 实现必须遵守 */
export interface LLMProvider {
  readonly name: string;

  /** 配置并初始化 */
  configure(config: LLMConfig): Promise<void>;

  /** 流式翻译：逐 token 产出翻译结果 */
  translate(request: TranslationRequest): AsyncGenerator<TranslationResult>;

  /** 上下文分析：领域检测、术语提取、摘要生成、话题切换判断 */
  analyze(sentences: string[], history: string[]): Promise<AnalysisResult>;

  /** 释放资源 */
  dispose(): void;

  /** 验证凭证有效性，供设置面板"测试连接" */
  validateCredentials(config: LLMConfig): Promise<boolean>;
}
