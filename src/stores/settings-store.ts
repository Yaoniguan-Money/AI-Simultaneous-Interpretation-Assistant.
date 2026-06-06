import { atom } from 'jotai';
import type { ASRConfig } from '../services/asr/types';
import type { LLMConfig } from '../services/llm/types';
import type { AudioSource } from '../hooks/useAudioCapture';
import type { SubtitleFontSize } from '../types';

/** 双语字幕开关 */
export const bilingualAtom = atom<boolean>(false);

/** 字幕字号：sm(14px) / md(18px) / lg(24px)，默认 md */
export const subtitleFontSizeAtom = atom<SubtitleFontSize>('md');

/** 音频捕获源：system 或 microphone */
export const audioSourceAtom = atom<AudioSource>('system');

/** ASR 配置 —— null 表示未配置，PR13 API 设置页面写入 */
export const asrConfigAtom = atom<ASRConfig | null>(null);

/** LLM 配置 —— null 表示未配置，PR13 API 设置页面写入 */
export const llmConfigAtom = atom<LLMConfig | null>(null);
