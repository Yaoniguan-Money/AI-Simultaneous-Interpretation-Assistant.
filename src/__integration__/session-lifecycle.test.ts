/**
 * 会话生命周期集成测试
 * 模拟完整会话：配置 → 启动 → 处理 → 停止 → 纪要生成
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'jotai';
import {
  subtitleStackAtom,
  historyAtom,
  meetingMinutesAtom,
} from '../stores/session-store';
import type { SubtitleEntry } from '../types/subtitle';

function mkEntry(text: string, translation: string, index: number): SubtitleEntry {
  return {
    id: `id-${index}` as any,
    text,
    translation,
    index,
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
    isComplete: true,
    isPreview: false,
  };
}

describe('集成测试：会话生命周期', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  it('字幕堆栈：构建、推送、清空', () => {
    // 模拟会话开始
    expect(store.get(subtitleStackAtom)).toEqual([]);

    // 推送字幕条目
    const entry1 = mkEntry('Hello', '你好', 0);
    store.set(subtitleStackAtom, (prev) => [...prev, entry1]);
    expect(store.get(subtitleStackAtom)).toHaveLength(1);

    const entry2 = mkEntry('World', '世界', 1);
    store.set(subtitleStackAtom, (prev) => [...prev, entry2]);
    expect(store.get(subtitleStackAtom)).toHaveLength(2);

    // 会话结束清空
    store.set(subtitleStackAtom, []);
    expect(store.get(subtitleStackAtom)).toEqual([]);
  });

  it('翻译历史：累积持久化', () => {
    // 历史累积不因字幕清空而丢失
    const entry1 = mkEntry('Hello', '你好', 0);
    store.set(historyAtom, (prev) => [...prev, entry1]);
    store.set(historyAtom, (prev) => [...prev, mkEntry('World', '世界', 1)]);

    expect(store.get(historyAtom)).toHaveLength(2);

    // 字幕清空不影响历史
    store.set(subtitleStackAtom, []);
    expect(store.get(historyAtom)).toHaveLength(2);
  });

  it('会议纪要状态机：idle → generating → done', () => {
    // 初始 idle
    expect(store.get(meetingMinutesAtom)).toEqual({ status: 'idle' });

    // 开始生成
    store.set(meetingMinutesAtom, { status: 'generating' });
    expect(store.get(meetingMinutesAtom)).toEqual({ status: 'generating' });

    // 生成完成
    const minutesData = {
      topic: '技术评审',
      keyTopics: ['架构', '性能'],
      discussionPoints: [],
      decisions: ['使用 K8s'],
      actionItems: [{ description: '编写文档' }],
      summary: '会议成功。',
    };
    store.set(meetingMinutesAtom, { status: 'done', data: minutesData });
    const state = store.get(meetingMinutesAtom);
    expect(state.status).toBe('done');
    if (state.status === 'done') {
      expect(state.data.topic).toBe('技术评审');
    }
  });

  it('会议纪要状态机：idle → generating → error', () => {
    store.set(meetingMinutesAtom, { status: 'generating' });
    store.set(meetingMinutesAtom, { status: 'error', error: 'LLM 超时' });

    const state = store.get(meetingMinutesAtom);
    expect(state.status).toBe('error');
    if (state.status === 'error') {
      expect(state.error).toBe('LLM 超时');
    }
  });

  it('重置会话：start 后恢复 idle', () => {
    store.set(meetingMinutesAtom, { status: 'done', data: { topic: 'x', keyTopics: [], discussionPoints: [], decisions: [], actionItems: [], summary: '' } });
    store.set(meetingMinutesAtom, { status: 'idle' });

    expect(store.get(meetingMinutesAtom)).toEqual({ status: 'idle' });
  });
});
