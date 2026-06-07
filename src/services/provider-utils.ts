import type { ASRResult } from './asr/types';

/**
 * 供应商通用工具函数
 * 消除 IFlyTekASR、AliyunASR、DeepgramASR、CustomASR 中的重复模式
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

/**
 * ASR 结果队列消费器——所有 ASR 供应商共用的核心逻辑
 *
 * 从 FIFO 队列中分离 interim 与 final 结果：
 * - 优先返回最新 final（供分句器用）
 * - 无 final 时返回最新 interim（供 UI 展示）
 * - interim 暂存到 pendingInterim，调用方通过 drainInterimResults() 拉取
 *
 * @param queue 识别结果 FIFO 队列（原地修改——调用 shift() 消费）
 * @param pendingInterim 暂存队列（原地修改——push 未消费的 interim）
 */
export function consumeAsrResultQueue(
  queue: ASRResult[],
  pendingInterim: ASRResult[],
): ASRResult {
  let latestInterim: ASRResult | null = null;
  let latestFinal: ASRResult | null = null;

  while (queue.length > 0) {
    const r = queue.shift()!;
    if (r.isFinal && r.text) {
      latestFinal = r;
    } else if (r.text) {
      latestInterim = r;
    }
  }

  if (latestInterim) {
    pendingInterim.push(latestInterim);
  }

  return latestFinal ?? latestInterim ?? emptyAsrResult(false);
}

/** ASR 空结果快捷构造器——所有供应商共用 */
export function emptyAsrResult(isFinal: boolean): ASRResult {
  return { text: '', isFinal, confidence: 0, startTime: 0, endTime: 0 };
}
