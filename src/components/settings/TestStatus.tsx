/** 测试连接状态 */
export type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

/**
 * 测试连接按钮 + 状态徽章 + 错误信息
 * 供 ASR/LLM 设置面板共用，支持展示具体失败原因
 */
export function TestStatusBadge({
  status,
  onTest,
  errorMessage,
}: {
  status: TestStatus;
  onTest: () => void;
  /** 失败时的具体错误信息，不为空时在徽章下方展示 */
  errorMessage?: string;
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          onClick={onTest}
          disabled={status === 'testing'}
          className="px-4 py-2 rounded-btn border border-border text-xs font-medium text-black
                     hover:bg-surface-hover transition-colors disabled:opacity-50"
        >
          {status === 'testing' ? '测试中...' : '测试连接'}
        </button>
        {status === 'ok' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-chip
                           bg-accent-green-bg text-accent-green-text text-[10px] font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green-text" />
            Connected
          </span>
        )}
        {status === 'fail' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-chip
                           bg-accent-red-bg text-accent-red-text text-[10px] font-bold uppercase tracking-wider">
            Failed
          </span>
        )}
      </div>
      {status === 'fail' && errorMessage && (
        <p className="mt-1.5 text-[10px] text-accent-red-text leading-relaxed break-all">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
