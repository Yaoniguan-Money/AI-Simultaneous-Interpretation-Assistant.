import { useAtom } from 'jotai';
import type { ASRConfig, ASRProviderType } from '../../services/asr/types';
import { createASRProvider } from '../../services/asr/factory';
import { asrConfigAtom } from '../../stores/settings-store';
import { useConnectionTest } from '../../hooks/useConnectionTest';
import { ApiKeyInput } from './ApiKeyInput';
import { TestStatusBadge } from './TestStatus';

/** 可选的 ASR 提供商 */
const PROVIDERS: { key: ASRProviderType; label: string; sub: string }[] = [
  { key: 'iflytek', label: 'iFlyTek', sub: 'Recommended' },
  { key: 'aliyun', label: 'Aliyun', sub: 'ASR' },
  { key: 'deepgram', label: 'Deepgram', sub: 'Overseas' },
  { key: 'custom', label: 'Custom', sub: 'WebSocket' },
];

/** 默认配置模板 */
function defaultConfig(provider: ASRProviderType): ASRConfig {
  return { provider, credentials: {}, language: 'en' };
}

/** ASR 提供商配置面板 */
export function ASRSettings(): JSX.Element {
  const [config, setConfig] = useAtom(asrConfigAtom);
  const { testStatus, errorMessage, testConnection, resetStatus } = useConnectionTest(
    asrConfigAtom,
    createASRProvider,
    '请先填写 ASR 凭证再测试',
  );

  const current = config ?? defaultConfig('iflytek');

  /** 切换提供商 */
  const selectProvider = (key: ASRProviderType): void => {
    setConfig(defaultConfig(key));
    resetStatus();
  };

  /** 更新凭证字段 */
  const updateCred = (field: string, value: string): void => {
    setConfig((prev) => {
      const base = prev ?? defaultConfig('iflytek');
      return { ...base, credentials: { ...base.credentials, [field]: value } };
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs font-bold text-text-muted uppercase tracking-[0.06em]">
        语音识别 (ASR)
      </h3>

      {/* 提供商选择 */}
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

      {/* 输入字段——不同提供商显示不同字段 */}
      {current.provider === 'iflytek' && (
        <>
          <ApiKeyInput label="App ID" value={current.credentials['appId'] ?? ''} onChange={(v) => updateCred('appId', v)} />
          <ApiKeyInput label="API Key" value={current.credentials['apiKey'] ?? ''} onChange={(v) => updateCred('apiKey', v)} />
          <ApiKeyInput label="API Secret" value={current.credentials['apiSecret'] ?? ''} onChange={(v) => updateCred('apiSecret', v)} />
        </>
      )}
      {current.provider === 'aliyun' && (
        <>
          <ApiKeyInput label="AccessKey ID" value={current.credentials['accessKeyId'] ?? ''} onChange={(v) => updateCred('accessKeyId', v)} />
          <ApiKeyInput label="AccessKey Secret" value={current.credentials['accessKeySecret'] ?? ''} onChange={(v) => updateCred('accessKeySecret', v)} />
        </>
      )}
      {current.provider === 'deepgram' && (
        <ApiKeyInput label="API Key" value={current.credentials['apiKey'] ?? ''} onChange={(v) => updateCred('apiKey', v)} />
      )}
      {current.provider === 'custom' && (
        <ApiKeyInput label="WebSocket Endpoint" value={current.credentials['endpoint'] ?? ''} onChange={(v) => updateCred('endpoint', v)} />
      )}

      {/* 测试连接 */}
      <TestStatusBadge status={testStatus} onTest={testConnection} errorMessage={errorMessage} />
    </div>
  );
}
