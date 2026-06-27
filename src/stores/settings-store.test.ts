/**
 * settings-store.ts 单元测试
 * 验证设置相关 Jotai atom 的初始值和读写
 */
import { describe, it, expect } from 'vitest';
import { createStore } from 'jotai';
import {
  bilingualAtom,
  subtitleFontSizeAtom,
  audioSourceAtom,
  asrConfigAtom,
  llmConfigAtom,
} from './settings-store';
import type { ASRConfig } from '../services/asr/types';
import type { LLMConfig } from '../services/llm/types';

describe('settings-store', () => {
  describe('bilingualAtom', () => {
    it('初始值为 false', () => {
      const store = createStore();
      expect(store.get(bilingualAtom)).toBe(false);
    });

    it('切换为 true', () => {
      const store = createStore();
      store.set(bilingualAtom, true);
      expect(store.get(bilingualAtom)).toBe(true);
    });
  });

  describe('subtitleFontSizeAtom', () => {
    it('初始值为 md', () => {
      const store = createStore();
      expect(store.get(subtitleFontSizeAtom)).toBe('md');
    });

    it('切换为 lg', () => {
      const store = createStore();
      store.set(subtitleFontSizeAtom, 'lg');
      expect(store.get(subtitleFontSizeAtom)).toBe('lg');
    });
  });

  describe('audioSourceAtom', () => {
    it('初始值为 system', () => {
      const store = createStore();
      expect(store.get(audioSourceAtom)).toBe('system');
    });

    it('切换为 microphone', () => {
      const store = createStore();
      store.set(audioSourceAtom, 'microphone');
      expect(store.get(audioSourceAtom)).toBe('microphone');
    });
  });

  describe('asrConfigAtom', () => {
    it('初始值为 null', () => {
      const store = createStore();
      expect(store.get(asrConfigAtom)).toBeNull();
    });

    it('写入 ASR 配置', () => {
      const store = createStore();
      const config: ASRConfig = {
        provider: 'iflytek',
        credentials: { appId: 'test', apiKey: 'key' },
      };
      store.set(asrConfigAtom, config);
      expect(store.get(asrConfigAtom)).toEqual(config);
    });
  });

  describe('llmConfigAtom', () => {
    it('初始值为 null', () => {
      const store = createStore();
      expect(store.get(llmConfigAtom)).toBeNull();
    });

    it('写入 LLM 配置', () => {
      const store = createStore();
      const config: LLMConfig = {
        provider: 'deepseek',
        credentials: { apiKey: 'sk-test' },
      };
      store.set(llmConfigAtom, config);
      expect(store.get(llmConfigAtom)).toEqual(config);
    });
  });
});
