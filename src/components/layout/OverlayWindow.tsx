import { useAtomValue } from 'jotai';
import { bilingualAtom } from '../../stores/settings-store';

/**
 * 字幕悬浮窗组件
 * 纯文字，无背景无遮挡——透明窗口 + 纯白文字
 * 双语模式：原文在上，译文在下
 * 单语模式：仅译文
 */
export function OverlayWindow(): JSX.Element {
  const bilingual = useAtomValue(bilingualAtom);

  /** 当前翻译 — 大字白色 */
  const currentText = '';

  /** 原文 — 双语模式时显示 */
  const originalText = '';

  return (
    <div className="w-full h-full flex flex-col items-center justify-end pointer-events-none pb-4">
      {/* 英文原文 — 双语模式 */}
      {bilingual && originalText && (
        <p className="text-subtitle-sm text-subtitle-faded text-center leading-relaxed max-w-full break-words px-6">
          {originalText}
        </p>
      )}
      {/* 中文翻译 — 始终显示 */}
      {currentText && (
        <p className="text-subtitle-md text-subtitle-text font-medium text-center leading-relaxed max-w-full break-words px-6">
          {currentText}
        </p>
      )}
    </div>
  );
}
