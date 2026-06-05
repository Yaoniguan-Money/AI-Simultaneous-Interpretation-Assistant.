import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/** 修正提示标记——显示后 2 秒自动消失 */
export function CorrectionBadge({ reason }: { reason: string }): JSX.Element {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="text-subtitle-sm text-subtitle-faded text-center"
        >
          ✎ 根据上下文已修正
          {reason ? `：${reason}` : ''}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
