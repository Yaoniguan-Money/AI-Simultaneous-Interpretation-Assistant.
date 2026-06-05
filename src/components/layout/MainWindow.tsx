import { useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { APP_NAME, APP_TAGLINE } from '../../../shared/app-config';
import {
  asrConfigAtom,
  bilingualAtom,
  llmConfigAtom,
} from '../../stores/settings-store';
import { useTranslationSession } from '../../hooks/useTranslationSession';

/** 主控制窗口组件 */
export function MainWindow(): JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('');
  const [bilingual, setBilingual] = useAtom(bilingualAtom);

  /** 从 Jotai 读取 ASR/LLM 配置（PR13 设置页面写入） */
  const asrConfig = useAtomValue(asrConfigAtom);
  const llmConfig = useAtomValue(llmConfigAtom);

  /** 翻译会话 Hook —— 串联音频→ASR→LLM→字幕 */
  const { isTranslating, error, isConfigured, start, stop } = useTranslationSession(
    asrConfig,
    llmConfig,
  );

  /** 加载应用版本信息 */
  const loadVersion = async (): Promise<void> => {
    try {
      const version = await window.electronAPI?.getVersion();
      setAppVersion(version ?? '未知');
    } catch {
      setAppVersion('获取失败');
    }
  };

  /** 开始翻译：先显示浮窗，再启动管线 */
  const handleStart = async (): Promise<void> => {
    if (!isConfigured) {
      return;
    }
    await window.electronAPI?.showOverlay();
    await start();
  };

  /** 停止翻译：停管线，隐藏浮窗 */
  const handleStop = async (): Promise<void> => {
    stop();
    await window.electronAPI?.hideOverlay();
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 bg-gray-900">
      <h1 className="text-2xl font-bold text-white mb-2">
        {'🎙️ '}{APP_NAME}
      </h1>
      <p className="text-gray-400 text-sm mb-6">
        {APP_TAGLINE}
      </p>

      {/* 状态信息 */}
      {!isConfigured && (
        <p className="text-yellow-400 text-xs mb-4">
          ⚠ API Key 未配置，请前往设置页面配置
        </p>
      )}
      {error && (
        <p className="text-red-400 text-xs mb-4">
          {error}
        </p>
      )}

      <div className="flex gap-3 mb-8">
        <button
          onClick={handleStart}
          disabled={!isConfigured || isTranslating}
          className="px-6 py-2 bg-primary rounded-lg text-white font-medium
                     hover:bg-primary-hover transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ▶ 开始翻译
        </button>
        <button
          onClick={handleStop}
          disabled={!isTranslating}
          className="px-6 py-2 bg-gray-700 rounded-lg text-gray-300 font-medium
                     hover:bg-gray-600 transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ⏹ 停止
        </button>
      </div>

      {/* 双语字幕开关 */}
      <label className="flex items-center gap-2 mb-4 cursor-pointer text-gray-300 text-sm">
        <input
          type="checkbox"
          checked={bilingual}
          onChange={(e) => setBilingual(e.target.checked)}
          className="w-4 h-4 rounded accent-primary"
        />
        双语字幕（原文 + 译文）
      </label>

      <div className="w-full space-y-2">
        <button className="w-full text-left px-4 py-3 bg-gray-800 rounded-lg
                           hover:bg-gray-700 transition-colors text-white">
          📋 翻译历史
        </button>
        <button className="w-full text-left px-4 py-3 bg-gray-800 rounded-lg
                           hover:bg-gray-700 transition-colors text-white">
          ⚙️ API 设置
        </button>
        <button className="w-full text-left px-4 py-3 bg-gray-800 rounded-lg
                           hover:bg-gray-700 transition-colors text-white">
          🎬 演示模式
        </button>
      </div>

      {/* 版本信息 */}
      <button
        onClick={loadVersion}
        className="mt-auto text-xs text-gray-600 hover:text-gray-400 transition-colors"
      >
        {appVersion ? `v${appVersion}` : '点击查看版本'}
      </button>
    </div>
  );
}
