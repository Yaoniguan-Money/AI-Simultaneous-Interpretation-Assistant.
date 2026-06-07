import type {
  AnalysisResult,
  Correction,
  LLMConfig,
  LLMProvider,
  MeetingMinutes,
  Token,
  TranslatedSentence,
  TranslationRequest,
  TranslationResult,
} from './types';
import { ensureConfigured } from '../provider-utils';

/**
 * OpenAI 兼容 API 共享协议常量
 * 适用于所有使用 /v1/chat/completions + Bearer Token + SSE 流式的供应商
 * DeepSeek、Qwen、Zhipu 均遵循此协议
 */
const PROTOCOL = {
  /** 默认最大输出 token 数 */
  MAX_TOKENS: 1024,
  /** 翻译默认温度 */
  TRANSLATE_TEMPERATURE: 0.3,
  /** 分析默认温度 */
  ANALYZE_TEMPERATURE: 0.1,
  /** 会议纪要默认温度 */
  MINUTES_TEMPERATURE: 0.3,
  /** 会议纪要输入文本最大字符数 */
  MINUTES_MAX_INPUT_CHARS: 6000,
  /** 会议纪要截断时首部保留句数 */
  MINUTES_HEAD_COUNT: 2,
  /** 会议纪要截断时尾部保留句数 */
  MINUTES_TAIL_COUNT: 8,
  /** 翻译系统提示词 */
  TRANSLATE_SYSTEM_PROMPT: buildTranslatePrompt(),
  /** 分析系统提示词 */
  ANALYZE_SYSTEM_PROMPT: buildAnalyzePrompt(),
  /** 会议纪要系统提示词 */
  MINUTES_SYSTEM_PROMPT: buildMinutesPrompt(),
} as const;

/** 凭证字段名 */
const CRED_KEY = { apiKey: 'apiKey' } as const;

/** OpenAI 兼容 API 的 stream chunk 结构 */
interface StreamChunk {
  choices?: { delta?: { content?: string } }[];
}

/**
 * OpenAI 兼容 LLM 通用实现
 *
 * 覆盖 DeepSeek、Qwen（通义千问）、Zhipu（智谱 GLM）和自定义 OpenAI 兼容 API。
 * 所有供应商使用相同的 HTTPS SSE 流式协议，仅在默认端点和默认模型上有差异。
 * 工厂函数负责根据 provider 类型注入不同的默认值。
 *
 * 功能：流式翻译、上下文分析、会议纪要生成、凭证验证。
 */
export class OpenAICompatLLM implements LLMProvider {
  readonly name: string;

  /**
   * LLM 常见拒绝/占位响应模式——这些不是有效翻译，必须丢弃
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

  /**
   * @param providerName 供应商名称（如 'deepseek'、'qwen'），用于日志和错误提示
   * @param defaultEndpoint 默认 API 端点，可通过 LLMConfig.endpoint 覆盖
   * @param defaultModel 默认模型名，可通过 LLMConfig.model 覆盖
   */
  constructor(
    providerName: string,
    private defaultEndpoint: string,
    private defaultModel: string,
  ) {
    this.name = providerName;
  }

  async configure(config: LLMConfig): Promise<void> {
    this.validateConfig(config);
    this.config = { ...config };
  }

  /** 流式翻译——通过 SSE 逐 token 产出结果 */
  async *translate(request: TranslationRequest): AsyncGenerator<TranslationResult> {
    const cfg = ensureConfigured(this.config, `${this.name} LLM`);
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
      throw new Error(`${this.name} API 未返回流式响应体`);
    }

    yield* this.readSSEStream(response.body.getReader());
  }

  /** 上下文分析：领域检测、术语提取、摘要生成 */
  async analyze(sentences: string[], history: string[]): Promise<AnalysisResult> {
    const cfg = ensureConfigured(this.config, `${this.name} LLM`);
    const endpoint = cfg.endpoint ?? this.defaultEndpoint;
    const model = cfg.model ?? this.defaultModel;
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

  /** 根据完整翻译历史生成结构化会议纪要 */
  async generateMinutes(
    history: TranslatedSentence[],
    durationSeconds: number,
  ): Promise<MeetingMinutes> {
    const cfg = ensureConfigured(this.config, `${this.name} LLM`);
    if (!history || history.length === 0) {
      throw new Error('翻译历史为空，无法生成会议纪要');
    }

    const endpoint = cfg.endpoint ?? this.defaultEndpoint;
    const model = cfg.model ?? this.defaultModel;
    const temperature = cfg.temperature ?? PROTOCOL.MINUTES_TEMPERATURE;

    const userContent = this.buildMinutesUserPrompt(history, durationSeconds);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.buildHeaders(cfg),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: PROTOCOL.MINUTES_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        stream: false,
        temperature,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    return await this.parseMinutesResponse(response);
  }

  dispose(): void {
    this.abortController?.abort('用户停止翻译');
    this.abortController = null;
    this.config = null;
  }

  /** 验证凭证有效性：发送最短测试请求，401/403→无效 */
  async validateCredentials(config: LLMConfig): Promise<boolean> {
    try {
      await this.configure(config);
      const endpoint = config.endpoint ?? this.defaultEndpoint;
      const model = config.model ?? this.defaultModel;

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

  private async sendTranslateRequest(
    cfg: LLMConfig,
    request: TranslationRequest,
    signal: AbortSignal,
  ): Promise<Response> {
    const endpoint = cfg.endpoint ?? this.defaultEndpoint;
    const model = cfg.model ?? this.defaultModel;
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
        const sanitized = this.sanitizeTranslation(fullText);
        if (sanitized) {
          yield { translation: sanitized, corrections: [], tokens };
        }
      }
    }

    const corrections = this.extractCorrections(fullText);
    yield { translation: this.cleanOutput(fullText), corrections, tokens: [] };
  }

  private buildHeaders(cfg: LLMConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.credentials[CRED_KEY.apiKey]}`,
    };
  }

  private buildTranslationSystemPrompt(request: TranslationRequest): string {
    const parts = [PROTOCOL.TRANSLATE_SYSTEM_PROMPT];

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

  private parseStreamChunk(data: string): string | null {
    try {
      const parsed = JSON.parse(data) as StreamChunk;
      return parsed.choices?.[0]?.delta?.content ?? null;
    } catch {
      return null;
    }
  }

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
   * 清理 LLM 输出中的思考文字/分析过程
   * 通过中文字符占比过滤 + 拒绝模式检测 + 前缀裁剪作为防御
   */
  private sanitizeTranslation(text: string): string {
    if (!text) return text;

    const cjkCount = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
    const totalChars = text.replace(/\s/g, '').length;
    if (totalChars === 0 || cjkCount / totalChars < 0.1) return '';

    if (OpenAICompatLLM.isRejectionResponse(text)) return '';

    const firstCjk = text.search(/[一-鿿]/);
    if (firstCjk > 0) {
      return text.slice(firstCjk).trim();
    }
    return text.trim();
  }

  private static isRejectionResponse(text: string): boolean {
    for (const pattern of OpenAICompatLLM.REJECTION_PATTERNS) {
      if (text.includes(pattern)) return true;
    }
    return false;
  }

  private cleanOutput(raw: string): string {
    return this.sanitizeTranslation(
      raw.replace(/【修正】[\s\S]+$/, ''),
    );
  }

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

  private validateConfig(config: LLMConfig): void {
    if (!config.credentials[CRED_KEY.apiKey]) {
      throw new Error(`${this.name} LLM 缺少 apiKey`);
    }
  }

  private async handleHttpError(response: Response): Promise<never> {
    if (response.status === 401 || response.status === 403) {
      throw new Error('API Key 无效或已过期，请更新密钥');
    }
    throw new Error(`${this.name} API HTTP ${response.status}: ${response.statusText}`);
  }

  // ---- 会议纪要辅助 ----

  private buildMinutesUserPrompt(
    history: TranslatedSentence[],
    durationSeconds: number,
  ): string {
    const minutes = Math.floor(durationSeconds / 60);
    const truncated = this.truncateHistory(history);

    const transcriptLines = truncated.map((s) =>
      `[${s.index}] 原文: ${s.original}\n    译文: ${s.translation}`,
    );

    return [
      `以下是一场约 ${minutes} 分钟的英文会议的中文翻译记录：`,
      '',
      ...transcriptLines,
      '',
      '请根据以上翻译记录，生成一份结构化的中文会议纪要。要求：',
      '1. 以 JSON 格式返回，不要包含其他文字',
      '2. 所有内容用中文输出',
      '3. topic: 根据讨论内容推断会议主题（一句话）',
      '4. keyTopics: 列出 2-5 个关键议题',
      '5. discussionPoints: 每个议题下列出关键观点（topic + points 数组）',
      '6. decisions: 列出会议中明确做出的决定',
      '7. actionItems: 列出待办事项（description + 可选 assignee）',
      '8. summary: 一段话总结会议核心内容和结论',
      '如果某项没有足够信息，返回空数组或空字符串，不要编造内容。',
    ].join('\n');
  }

  private truncateHistory(history: TranslatedSentence[]): TranslatedSentence[] {
    const maxChars = PROTOCOL.MINUTES_MAX_INPUT_CHARS;
    const totalChars = history.reduce(
      (sum, s) => sum + s.original.length + s.translation.length,
      0,
    );
    if (totalChars <= maxChars) return history;

    const head = history.slice(0, PROTOCOL.MINUTES_HEAD_COUNT);
    const tail = history.slice(-PROTOCOL.MINUTES_TAIL_COUNT);
    if (head.length + tail.length >= history.length) return history;
    return [...head, ...tail];
  }

  private async parseMinutesResponse(response: Response): Promise<MeetingMinutes> {
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? '{}';

    try {
      const parsed = JSON.parse(content) as {
        topic?: string;
        keyTopics?: string[];
        discussionPoints?: { topic: string; points: string[] }[];
        decisions?: string[];
        actionItems?: { description: string; assignee?: string }[];
        summary?: string;
      };

      return {
        topic: parsed.topic ?? '',
        keyTopics: parsed.keyTopics ?? [],
        discussionPoints: parsed.discussionPoints ?? [],
        decisions: parsed.decisions ?? [],
        actionItems: parsed.actionItems ?? [],
        summary: parsed.summary ?? '',
      };
    } catch {
      throw new Error('会议纪要 JSON 解析失败：LLM 返回格式异常');
    }
  }
}

// ---- 系统提示词（供应商无关，中文通用） ----

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

function buildMinutesPrompt(): string {
  return [
    '你是一个专业的会议记录员。你的任务是根据英文会议的翻译记录，生成结构化的中文会议纪要。',
    '要求：',
    '1. 只输出 JSON，不要包含任何思考过程、解释或 markdown 标记',
    '2. 所有内容使用中文——因为用户是中文读者',
    '3. 从翻译记录中提取事实，不要编造不存在的内容',
    '4. 如果某项信息不足，对应字段返回空数组或空字符串',
    '5. JSON 结构：',
    '{',
    '  "topic": "会议主题（一句话）",',
    '  "keyTopics": ["议题1", "议题2"],',
    '  "discussionPoints": [{"topic": "议题", "points": ["观点1", "观点2"]}],',
    '  "decisions": ["决定1", "决定2"],',
    '  "actionItems": [{"description": "待办事项", "assignee": "负责人（如有）"}],',
    '  "summary": "一段话总结"',
    '}',
  ].join('\n');
}
