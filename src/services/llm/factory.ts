import type { LLMConfig, LLMProvider } from './types';
import { DeepSeekLLM } from './deepseek';

/**
 * LLM 供应商工厂函数
 * 根据配置中的 provider 字段创建对应实例
 * 新增供应商只需添加一个 case
 */
export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'deepseek':
      return new DeepSeekLLM();
    // 后续 PR 扩展：case 'qwen': return new QwenLLM();
    // 后续 PR 扩展：case 'zhipu': return new ZhipuLLM();
    // 后续 PR 扩展：case 'custom': return new OpenAICompatLLM();
    default:
      throw new Error(`不支持的 LLM 供应商: ${config.provider}`);
  }
}
