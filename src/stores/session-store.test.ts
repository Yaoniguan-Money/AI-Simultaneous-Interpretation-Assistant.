/**
 * session-store.ts 单元测试
 * 验证 Jotai atom 的初始值、读写和订阅
 */
import { describe, it, expect } from 'vitest';
import { createStore } from 'jotai';
import {
  subtitleStackAtom,
  historyAtom,
  activeSubtitleIdAtom,
  meetingMinutesAtom,
} from './session-store';
import type { SubtitleEntry } from '../types/subtitle';
import type { MeetingMinutes } from '../services/llm/types';

function mkSubtitle(id: string, text: string, index: number): SubtitleEntry {
  return {
    id,
    text,
    translation: text,
    index,
    startMs: 0,
    endMs: 1000,
    isComplete: true,
    isPreview: false,
  };
}

describe('session-store', () => {
  describe('subtitleStackAtom', () => {
    it('初始值为空数组', () => {
      const store = createStore();
      expect(store.get(subtitleStackAtom)).toEqual([]);
    });

    it('写入后读取', () => {
      const store = createStore();
      const entry = mkSubtitle('a', 'Hello', 0);
      store.set(subtitleStackAtom, [entry]);
      expect(store.get(subtitleStackAtom)).toEqual([entry]);
    });

    it('追加条目', () => {
      const store = createStore();
      const e1 = mkSubtitle('a', 'Hello', 0);
      const e2 = mkSubtitle('b', 'World', 1);
      store.set(subtitleStackAtom, (prev) => [...prev, e1]);
      store.set(subtitleStackAtom, (prev) => [...prev, e2]);
      expect(store.get(subtitleStackAtom)).toHaveLength(2);
    });
  });

  describe('historyAtom', () => {
    it('初始值为空数组', () => {
      const store = createStore();
      expect(store.get(historyAtom)).toEqual([]);
    });
  });

  describe('activeSubtitleIdAtom', () => {
    it('初始值为 null', () => {
      const store = createStore();
      expect(store.get(activeSubtitleIdAtom)).toBeNull();
    });

    it('写入后读取', () => {
      const store = createStore();
      store.set(activeSubtitleIdAtom, 42);
      expect(store.get(activeSubtitleIdAtom)).toBe(42);
    });
  });

  describe('meetingMinutesAtom', () => {
    it('初始状态为 idle', () => {
      const store = createStore();
      expect(store.get(meetingMinutesAtom)).toEqual({ status: 'idle' });
    });

    it('过渡到 generating 状态', () => {
      const store = createStore();
      store.set(meetingMinutesAtom, { status: 'generating' });
      expect(store.get(meetingMinutesAtom)).toEqual({ status: 'generating' });
    });

    it('过渡到 done 状态并携带数据', () => {
      const store = createStore();
      const data: MeetingMinutes = {
        topic: '测试',
        keyTopics: ['A'],
        discussionPoints: [],
        decisions: [],
        actionItems: [],
        summary: 'summary',
      };
      store.set(meetingMinutesAtom, { status: 'done', data });
      expect(store.get(meetingMinutesAtom)).toEqual({ status: 'done', data });
    });

    it('过渡到 error 状态', () => {
      const store = createStore();
      store.set(meetingMinutesAtom, { status: 'error', error: '请求失败' });
      expect(store.get(meetingMinutesAtom)).toEqual({ status: 'error', error: '请求失败' });
    });

    it('过渡到 empty 状态', () => {
      const store = createStore();
      store.set(meetingMinutesAtom, { status: 'empty' });
      expect(store.get(meetingMinutesAtom)).toEqual({ status: 'empty' });
    });
  });
});
