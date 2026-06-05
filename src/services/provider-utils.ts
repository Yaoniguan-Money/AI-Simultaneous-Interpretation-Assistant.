/**
 * 供应商通用工具函数
 * 消除 IFlyTekASR 与 DeepSeekLLM 中的重复模式
 */

/** 确保配置已加载，否则抛出明确错误 */
export function ensureConfigured<T>(
  config: T | null,
  providerName: string,
): T {
  if (!config) {
    throw new Error(`请先调用 configure() 配置 ${providerName}`);
  }
  return config;
}
