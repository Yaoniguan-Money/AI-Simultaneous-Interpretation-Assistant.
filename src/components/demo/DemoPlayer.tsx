import { useSetAtom } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { subtitleStackAtom } from '../../stores/session-store';
import type { SubtitleEntry, SubtitleCorrection } from '../../types/subtitle';

/** 演示时间轴条目 */
interface DemoTimelineEntry {
  /** 字幕出现时间（秒） */
  time: number;
  /** 英文原文 */
  original: string;
  /** 中文翻译 */
  translation: string;
  /** 打字机效果的持续时间（秒），0 表示瞬时完成 */
  typewriterDuration?: number;
  /** 修正事件（在字幕出现后 delaySeconds 秒触发） */
  correction?: SubtitleCorrection & { delaySeconds: number };
}

/**
 * 内建演示时间轴——模拟 Python GC 技术演讲
 * 零 API 调用，纯预计算数据
 */
const DEMO_TIMELINE: DemoTimelineEntry[] = [
  {
    time: 2.0, original: "Today we are going to talk about Python's garbage collection mechanism.",
    translation: "今天我们将要讨论 Python 的垃圾回收机制。", typewriterDuration: 1.5,
  },
  {
    time: 6.5, original: "This is one of the core concepts every Python developer should understand.",
    translation: "这是每个 Python 开发者都应该理解的核心概念之一。", typewriterDuration: 1.2,
    /** 演示修正：2 秒后更新为更准确的翻译 */
    correction: { oldText: "这是每个 Python 开发者都应该理解的核心概念之一。",
      newText: "这是 Python 开发者必须掌握的核心底层机制之一。", reason: "根据上下文，GC 属于底层机制而非一般概念", delaySeconds: 2.0 },
  },
  {
    time: 12.0, original: "Reference counting is the primary garbage collection strategy in CPython.",
    translation: "引用计数是 CPython 中的主要垃圾回收策略。", typewriterDuration: 1.0,
  },
  {
    time: 17.0, original: "When an object's reference count drops to zero, it is immediately deallocated.",
    translation: "当对象的引用计数降为零时，它会被立即释放。", typewriterDuration: 1.0,
  },
  {
    time: 22.0, original: "However, reference counting alone cannot handle circular references.",
    translation: "然而，仅靠引用计数无法处理循环引用。", typewriterDuration: 0.8,
  },
  {
    time: 27.0, original: "That is where the generational garbage collector comes into play.",
    translation: "这就是分代垃圾回收器发挥作用的地方。", typewriterDuration: 0.8,
  },
];

/** DemoPlayer 组件——按预计算时间轴驱动字幕渲染 */
export function DemoPlayer({ onBack }: { onBack: () => void }): JSX.Element {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const setSubtitleStack = useSetAtom(subtitleStackAtom);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idCounterRef = useRef(0);
  const elapsedRef = useRef(0);
  /** 已触发事件防重 Set——play 时清空以保证重播可用 */
  const triggeredRef = useRef(new Set<number>());
  const totalDuration = 32; // 秒

  /** 清空字幕 + 停止定时器 */
  const cleanup = useCallback((): void => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setSubtitleStack([]);
    setIsPlaying(false);
    setCurrentTime(0);
    setProgress(0);
    idCounterRef.current = 0;
    elapsedRef.current = 0;
    triggeredRef.current.clear();
  }, [setSubtitleStack]);

  /** 开始播放——防重入：已有定时器则跳过 */
  const play = useCallback((): void => {
    if (timerRef.current) return;
    setIsPlaying(true);
    setCurrentTime(0);
    idCounterRef.current = 0;
    triggeredRef.current.clear();
    setSubtitleStack([]);

    timerRef.current = setInterval(() => runTimelineStep(), 100);
  }, [cleanup, setSubtitleStack]);

  /**
   * 时间轴步进——每 100ms 执行一次
   * 检查预计算时间轴，将到达触发时间的条目写入字幕 atom
   */
  const runTimelineStep = useCallback((): void => {
    elapsedRef.current += 0.1;
    const t = Math.round(elapsedRef.current * 10) / 10;

    if (t >= totalDuration) { cleanup(); return; }

    setCurrentTime(t);
    setProgress(Math.round((t / totalDuration) * 100));

    for (const entry of DEMO_TIMELINE) {
      const matchTime = Math.abs(t - entry.time) < 0.15;
      if (matchTime && !triggeredRef.current.has(Math.round(entry.time * 10))) {
        triggeredRef.current.add(Math.round(entry.time * 10));
        const id = ++idCounterRef.current;

        const subEntry: SubtitleEntry = {
          id, timestamp: Date.now(), original: entry.original,
          translation: entry.translation,
          isComplete: !entry.typewriterDuration,
          correction: null,
        };
        setSubtitleStack((prev) => [...prev, subEntry]);

        /** 打字机效果：duration 秒后标记完成 */
        if (entry.typewriterDuration && entry.typewriterDuration > 0) {
          setTimeout(() => {
            setSubtitleStack((prev) =>
              prev.map((e) => e.id === id ? { ...e, isComplete: true } : e),
            );
          }, entry.typewriterDuration * 1000);
        }

        /** 修正事件：delaySeconds 秒后触发修正动画 */
        if (entry.correction) {
          const corr = entry.correction;
          setTimeout(() => {
            setSubtitleStack((prev) =>
              prev.map((e) =>
                e.id === id ? { ...e, translation: corr.newText, correction: corr } : e,
              ),
            );
          }, corr.delaySeconds * 1000);
        }

        break;
      }
    }
  }, [cleanup, setSubtitleStack]);

  /** 组件卸载清理 */
  useEffect(() => () => cleanup(), [cleanup]);

  return (
    <div className="flex-1 flex flex-col">
      <button
        onClick={() => { cleanup(); onBack(); }}
        className="text-xs text-text-muted hover:text-text-primary transition-colors mb-4"
      >
        返回
      </button>

      {/* 模拟视频区域 */}
      <div className="flex-1 rounded-card border border-border bg-[#0d1117] mb-4
                      flex items-center justify-center relative overflow-hidden">
        <div className="text-center">
          <p className="text-[#C9D1D9] text-sm font-mono mb-2">
            {/* Python code snippet */}
            <span className="text-[#8B949E]"># Python 垃圾回收演示</span><br />
            <span className="text-[#FF7B72]">import</span> <span className="text-[#C9D1D9]">gc</span><br />
            <span className="text-[#C9D1D9]">a = [</span><span className="text-[#A5D6FF]">1</span><span className="text-[#C9D1D9]">, </span><span className="text-[#A5D6FF]">2</span><span className="text-[#C9D1D9]">, </span><span className="text-[#A5D6FF]">3</span><span className="text-[#C9D1D9]">]</span><br />
            <span className="text-[#C9D1D9]">b = a &nbsp;</span><span className="text-[#8B949E]"># b 引用了与 a 相同的列表</span><br />
            <span className="text-[#FF7B72]">del</span> <span className="text-[#C9D1D9]">a &nbsp;</span><span className="text-[#8B949E]"># 引用计数降低，但列表仍被 b 引用</span><br />
            <span className="text-[#C9D1D9]">print(</span><span className="text-[#D2A8FF]">gc.get_referrers</span><span className="text-[#C9D1D9]">(b))</span>
          </p>
        </div>

        {/* 播放中叠加水印 */}
        {isPlaying && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5
                          px-2 py-1 rounded-full bg-[rgba(0,0,0,0.4)] backdrop-blur">
            <span className="w-2 h-2 rounded-full bg-[#34D399] animate-pulse" />
            <span className="text-[10px] text-[#34D399] font-medium">演示播放中</span>
          </div>
        )}
      </div>

      {/* 控制栏 */}
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={isPlaying ? cleanup : play}
          className="px-5 py-2 rounded-btn bg-black text-white text-xs font-semibold
                     hover:bg-[#333] transition-colors"
        >
          {isPlaying ? '停止' : '播放演示'}
        </button>
        <div className="flex-1 h-1.5 rounded-full bg-surface-muted overflow-hidden">
          <div
            className="h-full bg-black rounded-full transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-text-faded font-mono w-10 text-right">
          {formatTime(currentTime)}
        </span>
      </div>

      <p className="text-[10px] text-text-faded text-center">
        离线演示 &middot; 无需 API Key &middot; 打字机效果 + 修正动画
      </p>
    </div>
  );
}

/** mm:ss 格式 */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
