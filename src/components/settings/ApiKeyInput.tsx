import { useEffect, useState } from 'react';

/** 密钥输入框 Props */
interface ApiKeyInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * 可切换明文/遮罩的密钥输入框
 * 输入时维护本地状态，失焦时写入 onChange，减少 atom 写入频率
 */
export function ApiKeyInput({ label, value, onChange, placeholder }: ApiKeyInputProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  /** 本地缓存值，失焦时写入 atom */
  const [localValue, setLocalValue] = useState(value);

  /** 外部 value 变化时同步本地状态（如切换提供商） */
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  /** 失焦时将本地值写入 atom */
  const handleBlur = (): void => {
    if (localValue !== value) {
      onChange(localValue);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
        {label}
      </label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="w-full px-3 py-2.5 rounded-input border border-border bg-surface
                     font-mono text-sm text-text-primary
                     focus:outline-none focus:border-border-active transition-colors"
        />
        <button
          onClick={() => setVisible(!visible)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted
                     hover:text-text-primary transition-colors"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}
