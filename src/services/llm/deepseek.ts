import type {
  AnalysisResult,
  Correction,
  LLMConfig,
  LLMProvider,
  Token,
  TranslationRequest,
  TranslationResult,
} from './types';
import { ensureConfigured } from '../provider-utils';

/**
 * DeepSeek API 协议常量
 */
const PROTOCOL = {
  /** 默认端点 */
  ENDPOINT: 'https://api.deepseek.com/v1/chat/completions',
  /** 默认模型 */
  MODEL: 'deepseek-chat',
  /** 默认最大输出 token 数 */
  MAX_TOKENS: 1024,
  /** 翻译默认温度 */
  TRANSLATE_TEMPERATURE: 0.3,
  /** 分析默认温度 */
  ANALYZE_TEMPERATURE: 0.1,
  /** 翻译系统提示词模板 */
  TRANSLATE_SYSTEM_PROMPT: buildTranslatePrompt(),
  /** 分析系统提示词模板 */
  ANALYZE_SYSTEM_PROMPT: buildAnalyzePrompt(),
} as const;

/** 凭证字段名 */
const CRED_KEY = { apiKey: 'apiKey' } as const;

/** OpenAI 兼容 API 的 stream chunk 结构 */
interface StreamChunk {
  choices?: { delta?: { content?: string } }[];
}

/**
 * DeepSeek V4 Flash（OpenAI 兼容）LLM 实现
 * 通过 HTTPS SSE 流式接口实现翻译和分析
 */
export class DeepSeekLLM implements LLMProvider {
  readonly name = 'deepseek';

  /**
   * LLM 常见拒绝/占位响应模式——这些不是有效翻译，必须丢弃
   * 当 LLM 收到空输入或无法理解的文本时可能返回此类响应
   */
  private static readonly REJECTION_PATTERNS: ReadonlySet<string> = new Set([
    '请提供需要翻译的英语',
    '请提供需要翻译的文本',
    '请提供需要翻译的',
    '请提供英语',
    '请提供文本',
    '请输入需要翻译',
    '抱歉，我无法翻译',
    'I cannot translate',
    'Please provide text',
    'Please provide the text',
  ]);

  private config: LLMConfig | null = null;
  private abortController: AbortController | null = null;

  async configure(config: LLMConfig): Promise<void> {
    this.validateConfig(config);
    this.config = { ...config };
  }

  /** 流式翻译——通过 SSE 逐 token 产出结果 */
  async *translate(request: TranslationRequest): AsyncGenerator<TranslationResult> {
    const cfg = ensureConfigured(this.config, 'DeepSeek LLM');
    if (!request.text || request.text.trim().length === 0) {
      yield { translation: '', corrections: [], tokens: [] };
      return;
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const response = await this.sendTranslateRequest(cfg, request, signal);

    if (!response.ok) {
      await this.handleHttpError(response);
    }
    if (!response.body) {
      throw new Error('DeepSeek API 未返回流式响应体');
    }

    yield* this.readSSEStream(response.body.getReader());
  }

  /** 上下文分析：领域检测、术语提取、摘要生成 */
  async analyze(sentences: string[], history: string[]): Promise<AnalysisResult> {
    const cfg = ensureConfigured(this.config, 'DeepSeek LLM');
    const endpoint = cfg.endpoint ?? PROTOCOL.ENDPOINT;
    const model = cfg.model ?? PROTOCOL.MODEL;
    const temperature = cfg.temperature ?? PROTOCOL.ANALYZE_TEMPERATURE;

    const content = [
      '请分析以下会议内容：',
      '',
      '【上文摘要】',
      ...history.map((h, i) => `${i + 1}. ${h}`),
      '',
      '【最新句子】',
      ...sentences.map((s, i) => `${i + 1}. ${s}`),
      '',
      '请以 JSON 格式返回分析结果，不要包含其他文字。',
    ].join('\n');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.buildHeaders(cfg),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: PROTOCOL.ANALYZE_SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        stream: false,
        temperature,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    return await this.parseAnalysisResponse(response);
  }

  dispose(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.config = null;
  }

  /**
   * 验证凭证有效性
   * 向 API 端点发送最短测试请求（max_tokens=1），
   * 通过响应状态码判定凭证是否有效：401/403 → 无效，其他非 ok → 网络异常
   */
  async validateCredentials(config: LLMConfig): Promise<boolean> {
    try {
      /** configure() 内部校验 config.credentials.apiKey 是否存在 */
      await this.configure(config);
      const endpoint = config.endpoint ?? PROTOCOL.ENDPOINT;
      const model = config.model ?? PROTOCOL.MODEL;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(config),
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
          stream: false,
        }),
      });

      if (response.status === 401 || response.status === 403) return false;
      return response.ok;
    } catch {
      return false;
    }
  }

  // ---- 请求构建 ----

  /** 构造并发送翻译 HTTP 请求 */
  private async sendTranslateRequest(
    cfg: LLMConfig,
    request: TranslationRequest,
    signal: AbortSignal,
  ): Promise<Response> {
    const endpoint = cfg.endpoint ?? PROTOCOL.ENDPOINT;
    const model = cfg.model ?? PROTOCOL.MODEL;
    const temperature = cfg.temperature ?? PROTOCOL.TRANSLATE_TEMPERATURE;
    const maxTokens = cfg.maxTokens ?? PROTOCOL.MAX_TOKENS;

    const systemPrompt = this.buildTranslationSystemPrompt(request);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: request.text },
    ];

    return fetch(endpoint, {
      method: 'POST',
      headers: this.buildHeaders(cfg),
      body: JSON.stringify({ model, messages, stream: true, temperature, max_tokens: maxTokens }),
      signal,
    });
  }

  /** 逐行读取 SSE 流，累积翻译文本并逐 token yield */
  private async *readSSEStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): AsyncGenerator<TranslationResult> {
    const decoder = new TextDecoder();
    let fullText = '';
    let tokenIndex = 0;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        const content = this.parseStreamChunk(data);
        if (!content) continue;

        const tokens: Token[] = [];
        for (const char of content) {
          tokens.push({ text: char, index: tokenIndex++ });
        }
        fullText += content;
        /** 中间帧也做清洗——避免思考文字在流式字幕中逐字出现 */
        const sanitized = this.sanitizeTranslation(fullText);
        if (sanitized) {
          yield { translation: sanitized, corrections: [], tokens };
        }
      }
    }

    /** 流结束后尝试提取修正 */
    const corrections = this.extractCorrections(fullText);
    yield { translation: this.cleanOutput(fullText), corrections, tokens: [] };
  }

  /** 构建 Bearer Token 鉴权请求头 */
  private buildHeaders(cfg: LLMConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.credentials[CRED_KEY.apiKey]}`,
    };
  }

  /** 构建翻译系统提示词，注入领域和术语上下文 */
  private buildTranslationSystemPrompt(request: TranslationRequest): string {
    const parts = [PROTOCOL.TRANSLATE_SYSTEM_PROMPT];

    /** 注入 Channel 2 提供的领域和术语 */
    const ctx = request.context;
    if (ctx.domain) {
      parts.push(`【当前领域】${ctx.domain} (置信度: ${ctx.domainConfidence})`);
    }
    if (ctx.activeTerms.size > 0) {
      const terms = [...ctx.activeTerms.entries()]
        .map(([en, zh]) => `"${en}" → "${zh}"`)
        .join(', ');
      parts.push(`【术语映射】${terms}`);
    }

    /** 注入前文翻译历史，用于修正检测 */
    if (request.previousSentences.length > 0) {
      parts.push('【前文翻译记录】');
      for (const s of request.previousSentences) {
        parts.push(`原文: "${s.original}" | 已译: "${s.translation}"`);
      }
      parts.push('如果新上下文表明之前的翻译有误，请在输出末尾以【修正】标记指出。');
    }

    return parts.join('\n');
  }

  // ---- 响应解析 ----

  /** 从 SSE chunk 中提取内容片段 */
  private parseStreamChunk(data: string): string | null {
    try {
      const parsed = JSON.parse(data) as StreamChunk;
      return parsed.choices?.[0]?.delta?.content ?? null;
    } catch {
      return null;
    }
  }

  /** 从 AI 完整输出中提取修正标记 */
  private extractCorrections(raw: string): Correction[] {
    const match = raw.match(/【修正】([\s\S]+)$/);
    if (!match) return [];

    try {
      const parsed = JSON.parse(match[1].trim()) as {
        sentenceIndex: number;
        oldTranslation: string;
        newTranslation: string;
        reason: string;
      }[];
      return parsed.map((c) => ({
        sentenceIndex: c.sentenceIndex,
        oldTranslation: c.oldTranslation,
        newTranslation: c.newTranslation,
        reason: c.reason,
      }));
    } catch {
      return [];
    }
  }

  /**
   * 清理 LLM 输出中可能混入的思考过程/分析文字
   * 防御层——主要依赖系统提示词的"只输出翻译"指令来防止，
   * 此方法通过中文字符占比过滤 + 拒绝模式检测 + 前缀裁剪作为兜底
   */
  private sanitizeTranslation(text: string): string {
    if (!text) return text;

    /** 统计 CJK 字符占比，低于阈值视为思考文字 */
    const cjkCount = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
    const totalChars = text.replace(/\s/g, '').length;
    if (totalChars === 0 || cjkCount / totalChars < 0.1) return '';

    /** 检测 LLM 拒绝/占位响应——命中已知模式则丢弃 */
    if (DeepSeekLLM.isRejectionResponse(text)) return '';

    /** 裁剪第一个中文字符前的思考前缀 */
    const firstCjk = text.search(/[一-鿿]/);
    if (firstCjk > 0) {
      return text.slice(firstCjk).trim();
    }
    return text.trim();
  }

  /** 检测文本是否命中 LLM 拒绝/占位响应模式 */
  private static isRejectionResponse(text: string): boolean {
    for (const pattern of DeepSeekLLM.REJECTION_PATTERNS) {
      if (text.includes(pattern)) return true;
    }
    return false;
  }

  /** 去除修正标记并清理思考文字后的纯净译文 */
  private cleanOutput(raw: string): string {
    return this.sanitizeTranslation(
      raw.replace(/【修正】[\s\S]+$/, ''),
    );
  }

  /** 解析分析 API 的 JSON 响应 */
  private async parseAnalysisResponse(response: Response): Promise<AnalysisResult> {
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? '{}';

    try {
      const parsed = JSON.parse(content) as {
        domain?: { name: string; confidence: number };
        terms?: { original: string; translation: string }[];
        summary?: string;
        topicShift?: boolean;
      };

      return {
        domain: parsed.domain ?? null,
        terms: (parsed.terms ?? []).map((t) => ({
          original: t.original,
          translation: t.translation,
        })),
        summary: parsed.summary ?? '',
        topicShift: parsed.topicShift ?? false,
      };
    } catch {
      return { domain: null, terms: [], summary: '', topicShift: false };
    }
  }

  // ---- 工具 ----

  private validateConfig(config: LLMConfig): void {
    if (!config.credentials[CRED_KEY.apiKey]) {
      throw new Error('DeepSeek LLM 缺少 apiKey');
    }
  }

  /** HTTP 错误统一处理，401/403 给出明确提示 */
  private async handleHttpError(response: Response): Promise<never> {
    if (response.status === 401 || response.status === 403) {
      throw new Error('API Key 无效或已过期，请更新密钥');
    }
    throw new Error(`DeepSeek API HTTP ${response.status}: ${response.statusText}`);
  }
}

/** 翻译系统提示词 */
function buildTranslatePrompt(): string {
  return [
    '你是一个专业的英译中同声传译助手。请将以下英语句子翻译为流畅、自然的中文。',
    '要求：',
    '1. 只输出中文翻译文本，不要输出任何思考过程、分析、解释或开场白',
    '2. 保持口语化，符合中文表达习惯',
    '3. 专业术语使用提供的术语映射',
    '4. 如果根据上下文发现前文翻译有误，在末尾以 JSON 数组格式标注修正：',
    '   【修正】[{"sentenceIndex":0,"oldTranslation":"旧译","newTranslation":"新译","reason":"原因"}]',
  ].join('\n');
}

/** 分析系统提示词 */
function buildAnalyzePrompt(): string {
  return [
    '你是一个会议内容分析助手。请分析提供的会议内容，以 JSON 格式返回：',
    '{',
    '  "domain": {"name": "领域名", "confidence": 0.9} | null,',
    '  "terms": [{"original": "英文术语", "translation": "中文翻译"}],',
    '  "summary": "一句话摘要",',
    '  "topicShift": true/false',
    '}',
  ].join('\n');
}
