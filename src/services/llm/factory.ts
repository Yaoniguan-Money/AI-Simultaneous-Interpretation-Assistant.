import type { LLMConfig, LLMProvider } from './types';
import { OpenAICompatLLM } from './openai-compat';

/** 各供应商默认端点与模型 */
const PROVIDER_DEFAULTS: Record<string, { endpoint: string; model: string }> = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
  },
  qwen: {
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
  },
  zhipu: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
  },
};

/**
 * LLM 供应商工厂函数
 * 根据配置中的 provider 字段创建对应实例
 * DeepSeek / Qwen / Zhipu / Custom 均使用 OpenAI 兼容协议，共享同一实现
 */
export function createLLMProvider(config: LLMConfig): LLMProvider {
  const defaults = PROVIDER_DEFAULTS[config.provider];

  if (defaults) {
    /** 内置供应商：使用预设默认值，用户可通过 config 覆盖 */
    return new OpenAICompatLLM(config.provider, defaults.endpoint, defaults.model);
  }

  if (config.provider === 'custom') {
    /** 自定义供应商：端点由用户必填，模型默认 'gpt-3.5-turbo' 作为兜底 */
    return new OpenAICompatLLM('custom', config.endpoint ?? '', config.model ?? '');
  }

  throw new Error(`不支持的 LLM 供应商: ${config.provider}`);
}
