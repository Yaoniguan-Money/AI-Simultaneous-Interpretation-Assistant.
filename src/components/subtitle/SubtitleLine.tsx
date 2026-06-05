import { motion, AnimatePresence } from 'framer-motion';
import type { SubtitleEntry } from '../../types/subtitle';
import { CorrectionBadge } from './CorrectionBadge';

/** 单条字幕行——流式显示 + 修正动画 */
export function SubtitleLine({
  entry,
  showOriginal,
}: {
  entry: SubtitleEntry;
  showOriginal: boolean;
}): JSX.Element {
  const hasCorrection = entry.correction !== null;

  return (
    <div className="flex flex-col items-center gap-0.5">
      {/* 英文原文（双语模式） */}
      {showOriginal && entry.original && (
        <p className="text-subtitle-sm text-subtitle-faded text-center leading-relaxed max-w-full break-words px-6">
          {entry.original}
        </p>
      )}

      {/* 中文翻译 */}
      {hasCorrection ? (
        <CorrectionTransition entry={entry} />
      ) : (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: entry.isComplete ? 1 : 0.9 }}
          transition={{ duration: 0.2 }}
          className="text-subtitle-md text-subtitle-text font-medium text-center leading-relaxed max-w-full break-words px-6"
        >
          {entry.translation}
        </motion.p>
      )}

      {/* 修正提示 */}
      {hasCorrection && entry.correction && (
        <CorrectionBadge reason={entry.correction.reason} />
      )}
    </div>
  );
}

/** 修正过渡动画：旧文字灰淡出 → 新文字淡入 */
function CorrectionTransition({ entry }: { entry: SubtitleEntry }): JSX.Element | null {
  if (!entry.correction) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div key={`corr-${entry.id}`} className="flex flex-col items-center">
        {/* 旧译文——0.2s 变灰淡出 */}
        <motion.p
          initial={{ opacity: 1, color: '#FFFFFF' }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="text-subtitle-sm line-through text-subtitle-faded text-center leading-relaxed max-w-full break-words px-6"
        >
          {entry.correction.oldText}
        </motion.p>
        {/* 新译文——0.2s 淡入 */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, delay: 0.2 }}
          className="text-subtitle-md text-subtitle-text font-medium text-center leading-relaxed max-w-full break-words px-6"
        >
          {entry.translation}
        </motion.p>
      </motion.div>
    </AnimatePresence>
  );
}
