import { useState } from 'react';
import { useAtom } from 'jotai';
import { APP_NAME, APP_TAGLINE } from '../../../shared/app-config';
import { bilingualAtom } from '../../stores/settings-store';

/** 主控制窗口组件 */
export function MainWindow(): JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('');
  const [bilingual, setBilingual] = useAtom(bilingualAtom);

  /** 加载应用版本信息 */
  const loadVersion = async (): Promise<void> => {
    try {
      const version = await window.electronAPI?.getVersion();
      setAppVersion(version ?? '未知');
    } catch {
      setAppVersion('获取失败');
    }
  };

  /** 显示字幕悬浮窗 */
  const showOverlay = async (): Promise<void> => {
    await window.electronAPI?.showOverlay();
  };

  /** 隐藏字幕悬浮窗 */
  const hideOverlay = async (): Promise<void> => {
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

      <div className="flex gap-3 mb-8">
        <button
          onClick={showOverlay}
          className="px-6 py-2 bg-primary rounded-lg text-white font-medium
                     hover:bg-primary-hover transition-colors"
        >
          ▶ 开始翻译
        </button>
        <button
          onClick={hideOverlay}
          className="px-6 py-2 bg-gray-700 rounded-lg text-gray-300 font-medium
                     hover:bg-gray-600 transition-colors"
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
