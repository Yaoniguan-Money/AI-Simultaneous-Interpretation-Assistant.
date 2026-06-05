import { atom } from 'jotai';
import type { ASRConfig } from '../services/asr/types';
import type { LLMConfig } from '../services/llm/types';

/** 双语字幕开关 */
export const bilingualAtom = atom<boolean>(false);

/** ASR 配置 —— null 表示未配置，PR13 API 设置页面写入 */
export const asrConfigAtom = atom<ASRConfig | null>(null);

/** LLM 配置 —— null 表示未配置，PR13 API 设置页面写入 */
export const llmConfigAtom = atom<LLMConfig | null>(null);
