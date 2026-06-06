import { useAtom } from 'jotai';
import { useRef } from 'react';
import type { LLMConfig, LLMProviderType } from '../../services/llm/types';
import { createLLMProvider } from '../../services/llm/factory';
import { llmConfigAtom } from '../../stores/settings-store';
import { useConnectionTest } from '../../hooks/useConnectionTest';
import { ApiKeyInput } from './ApiKeyInput';
import { TestStatusBadge } from './TestStatus';

/** 可选的 LLM 提供商 */
const PROVIDERS: { key: LLMProviderType; label: string; sub: string }[] = [
  { key: 'deepseek', label: 'DeepSeek', sub: 'Recommended' },
  { key: 'qwen', label: 'Qwen', sub: 'Aliyun' },
  { key: 'zhipu', label: 'Zhipu GLM', sub: 'GLM' },
  { key: 'custom', label: 'Custom', sub: 'OpenAI Compat' },
];

/** 默认配置模板 */
function defaultConfig(provider: LLMProviderType): LLMConfig {
  return { provider, credentials: {}, model: provider === 'deepseek' ? 'deepseek-chat' : undefined };
}

/** LLM 提供商配置面板 */
export function LLMSettings(): JSX.Element {
  const [config, setConfig] = useAtom(llmConfigAtom);
  const { testStatus, errorMessage, testConnection, resetStatus } = useConnectionTest(
    llmConfigAtom,
    createLLMProvider,
    '请先填写 LLM API Key 再测试',
  );
  /** Model 输入框 ref，用于 onBlur 时读取值 */
  const modelInputRef = useRef<HTMLInputElement>(null);

  const current = config ?? defaultConfig('deepseek');

  const selectProvider = (key: LLMProviderType): void => {
    setConfig(defaultConfig(key));
    resetStatus();
  };

  const updateCred = (field: string, value: string): void => {
    setConfig((prev) => {
      const base = prev ?? defaultConfig('deepseek');
      return { ...base, credentials: { ...base.credentials, [field]: value } };
    });
  };

  const updateModel = (model: string): void => {
    setConfig((prev) => {
      const base = prev ?? defaultConfig('deepseek');
      return { ...base, model };
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs font-bold text-text-muted uppercase tracking-[0.06em]">
        翻译模型 (LLM)
      </h3>

      <div className="flex gap-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.key}
            onClick={() => selectProvider(p.key)}
            className={
              'flex-1 py-2.5 rounded-card border-[1.5px] text-center transition-all text-xs ' +
              (current.provider === p.key
                ? 'bg-white border-border-active text-text-primary font-semibold'
                : 'bg-surface-muted border-transparent text-text-muted hover:bg-surface-hover')
            }
          >
            <div>{p.label}</div>
            <div className="text-[10px] text-text-muted mt-0.5">{p.sub}</div>
          </button>
        ))}
      </div>

      <ApiKeyInput label="API Key" value={current.credentials['apiKey'] ?? ''} onChange={(v) => updateCred('apiKey', v)} placeholder="sk-..." />

      {current.provider === 'custom' && (
        <ApiKeyInput label="Endpoint" value={current.endpoint ?? ''} onChange={(v) => setConfig((prev) => { const base = prev ?? defaultConfig('custom'); return { ...base, endpoint: v }; })} placeholder="https://api.example.com/v1" />
      )}

      {current.provider !== 'zhipu' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Model</label>
          <input
            ref={modelInputRef}
            type="text"
            defaultValue={current.model ?? defaultConfig(current.provider).model ?? ''}
            onBlur={() => { const v = modelInputRef.current?.value ?? ''; if (v) updateModel(v); }}
            placeholder="deepseek-chat"
            className="w-full px-3 py-2.5 rounded-input border border-border bg-surface
                       font-mono text-sm text-text-primary
                       focus:outline-none focus:border-border-active transition-colors"
          />
        </div>
      )}

      <TestStatusBadge status={testStatus} onTest={testConnection} errorMessage={errorMessage} />
    </div>
  );
}
