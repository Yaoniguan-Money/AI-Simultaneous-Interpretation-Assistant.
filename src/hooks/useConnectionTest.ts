import { getDefaultStore, type Atom } from 'jotai';
import { useState, useEffect, useCallback } from 'react';
import type { TestStatus } from '../components/settings/TestStatus';

/**
 * Provider 最小验证接口
 * 不依赖具体供应商类型，只要实现了 validateCredentials + dispose 即可
 */
interface TestableProvider {
  validateCredentials(config: unknown): Promise<boolean>;
  dispose(): void;
}

/**
 * 连接测试共享 Hook
 *
 * 封装测试连接的状态管理、错误信息展示和 5 秒自动重置逻辑。
 * ASRSettings 和 LLMSettings 共用此 Hook，消除 30+ 行重复代码。
 *
 * @param configAtom   - Jotai atom，用于绕过 React 闭包直接读取最新配置
 * @param createProvider - 工厂函数，根据配置创建对应的 provider 实例
 * @param emptyMessage   - 配置为空时的提示文案（由调用方注入，避免硬编码）
 */
export function useConnectionTest<T>(
  configAtom: Atom<T | null>,
  createProvider: (config: T) => TestableProvider,
  emptyMessage: string,
): {
  testStatus: TestStatus;
  errorMessage: string;
  testConnection: () => Promise<void>;
  /** 重置状态为 idle，切换提供商时调用 */
  resetStatus: () => void;
} {
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  /** 执行连接测试：失焦 → 读 atom → 校验配置 → 调工厂 → 验证凭证 */
  const testConnection = useCallback(async () => {
    /** 强制失焦确保 ApiKeyInput 本地值写入 atom */
    (document.activeElement as HTMLElement)?.blur();
    const latestConfig = getDefaultStore().get(configAtom);

    /** 配置为空时给出明确提示，不再静默返回 */
    if (!latestConfig) {
      setTestStatus('fail');
      setErrorMessage(emptyMessage);
      return;
    }

    setTestStatus('testing');
    setErrorMessage('');

    try {
      const provider = createProvider(latestConfig);
      const ok = await provider.validateCredentials(latestConfig);
      /** 验证返回值：确保 validateCredentials 明确返回 boolean true/false */
      console.log('[useConnectionTest] validateCredentials result:', ok, 'typeof:', typeof ok);
      provider.dispose();
      if (ok) {
        setTestStatus('ok');
      } else {
        setTestStatus('fail');
        setErrorMessage('连接失败，请检查凭证是否正确');
      }
    } catch (err) {
      setTestStatus('fail');
      /** 错误信息透传至 UI，用户可据此排查 */
      setErrorMessage(err instanceof Error ? err.message : '连接失败');
    }
  }, [configAtom, createProvider, emptyMessage]);

  /** 测试结果 5 秒后自动消失，同时清除错误信息 */
  useEffect(() => {
    if (testStatus === 'ok' || testStatus === 'fail') {
      const timer = setTimeout(() => {
        setTestStatus('idle');
        setErrorMessage('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [testStatus]);

  /** 切换提供商时手动重置状态 */
  const resetStatus = useCallback(() => {
    setTestStatus('idle');
    setErrorMessage('');
  }, []);

  return { testStatus, errorMessage, testConnection, resetStatus };
}
