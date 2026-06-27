import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { asrConfigAtom, llmConfigAtom } from '../stores/settings-store';

/**
 * 凭证持久化 Hook
 * 监听 asrConfigAtom / llmConfigAtom 变化，通过 IPC 加密保存
 * 组件挂载时从本地加载已存储的凭证并恢复
 * 仅在 MainWindow 中调用一次
 */
export function useCredentialPersistence(): void {
  const asrConfig = useAtomValue(asrConfigAtom);
  const llmConfig = useAtomValue(llmConfigAtom);
  const loadedRef = useRef(false);

  /** 挂载时加载已保存凭证 */
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const load = async (): Promise<void> => {
      const raw = await window.electronAPI?.loadCredentials();
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw) as {
          asrConfig: typeof asrConfig;
          llmConfig: typeof llmConfig;
        };

        /** 通过直接调用 setAtom 恢复——这里需要访问 hooks 外的 atom setter。
         *  简化为：如果 store 有保存值且当前 atom 为空，则写入。
         *  实际通过 Jotai 的 store API 实现异步写入。*/
        if (parsed.asrConfig && !asrConfig) {
          // 直接操作 Jotai store（通过默认 store）
          import('jotai').then(({ getDefaultStore }) => {
            const store = getDefaultStore();
            store.set(asrConfigAtom, parsed.asrConfig);
            if (parsed.llmConfig && !llmConfig) {
              store.set(llmConfigAtom, parsed.llmConfig);
            }
          });
        } else if (parsed.llmConfig && !llmConfig) {
          import('jotai').then(({ getDefaultStore }) => {
            const store = getDefaultStore();
            store.set(llmConfigAtom, parsed.llmConfig);
          });
        }
      } catch {
        /** 解密失败或 JSON 格式错误，静默处理 */
      }
    };

    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 配置变化时加密保存 */
  useEffect(() => {
    if (!loadedRef.current) return;

    const save = async (): Promise<void> => {
      if (!asrConfig && !llmConfig) return;
      const data = JSON.stringify({ asrConfig, llmConfig });
      await window.electronAPI?.saveCredentials(data);
    };

    /** 防抖：500ms 内连续变化只保存最后一次 */
    const timer = setTimeout(save, 500);
    return () => clearTimeout(timer);
  }, [asrConfig, llmConfig]);
}
