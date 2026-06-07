import { useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { APP_NAME, APP_TAGLINE, DEMO_VIDEO_URL } from '../../../shared/app-config';
import {
  asrConfigAtom,
  audioSourceAtom,
  bilingualAtom,
  llmConfigAtom,
  subtitleFontSizeAtom,
} from '../../stores/settings-store';
import type { SubtitleFontSize } from '../../types';
import { useTranslationSession } from '../../hooks/useTranslationSession';
import { useCredentialPersistence } from '../../hooks/useCredentialPersistence';
import { useSubtitleSync } from '../../hooks/useSubtitleSync';
import { ASRSettings } from '../settings/ASRSettings';
import { LLMSettings } from '../settings/LLMSettings';
import { HistoryPanel } from '../history/HistoryPanel';
import { DemoPlayer } from '../demo/DemoPlayer';

/** 当前显示的视图 */
type ActiveView = 'main' | 'settings' | 'history' | 'demo';

/** 主控制窗口组件 */
export function MainWindow(): JSX.Element {
  const [activeView, setActiveView] = useState<ActiveView>('main');
  const [appVersion, setAppVersion] = useState<string>('');
  const [bilingual, setBilingual] = useAtom(bilingualAtom);
  const [audioSource, setAudioSource] = useAtom(audioSourceAtom);
  const [fontSize, setFontSize] = useAtom(subtitleFontSizeAtom);

  const asrConfig = useAtomValue(asrConfigAtom);
  const llmConfig = useAtomValue(llmConfigAtom);

  /** 凭证持久化：保存/恢复加密的 API Key */
  useCredentialPersistence();

  /** 字幕同步：监听 subtitleStackAtom 变化并通过 IPC 推送到 OverlayWindow */
  useSubtitleSync();

  const { isTranslating, isStarting, error, isConfigured, start, stop } = useTranslationSession(
    asrConfig,
    llmConfig,
    audioSource,
  );

  const loadVersion = async (): Promise<void> => {
    try {
      const version = await window.electronAPI?.getVersion();
      setAppVersion(version ?? '未知');
    } catch {
      setAppVersion('获取失败');
    }
  };

  /** 启动翻译——先 start() 再 showOverlay()，确保 getDisplayMedia 在用户手势有效期内调用 */
  const handleStart = async (): Promise<void> => {
    if (!isConfigured) return;
    await start();
    await window.electronAPI?.showOverlay();
  };

  const handleStop = async (): Promise<void> => {
    stop();
    await window.electronAPI?.hideOverlay();
  };

  return (
    <div className="h-full flex flex-col p-3"
         style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(99,102,241,0.04) 0%, transparent 70%), #FFFFFF' }}>
      {/* 毛玻璃主卡片 */}
      <div className="flex-1 flex flex-col min-h-0 rounded-2xl border border-border
                      bg-[rgba(255,255,255,0.72)] backdrop-blur-2xl p-7"
           style={{ backdropFilter: 'blur(24px) saturate(1.4)', WebkitBackdropFilter: 'blur(24px) saturate(1.4)' }}>

        {/* 视图内容区 */}
        {activeView === 'settings' ? (
          <SettingsView onBack={() => setActiveView('main')} />
        ) : activeView === 'history' ? (
          <HistoryPanel onBack={() => setActiveView('main')} />
        ) : activeView === 'demo' ? (
          <DemoPlayer onBack={() => setActiveView('main')} />
        ) : (
          <MainView
            isTranslating={isTranslating}
            isStarting={isStarting}
            isConfigured={isConfigured}
            error={error}
            bilingual={bilingual}
            audioSource={audioSource}
            fontSize={fontSize}
            onBilingualChange={setBilingual}
            onAudioSourceChange={setAudioSource}
            onFontSizeChange={setFontSize}
            onStart={handleStart}
            onStop={handleStop}
            onNavigate={setActiveView}
          />
        )}

        {/* 版本号 */}
        <button
          onClick={loadVersion}
          className="mt-auto pt-3 text-[10px] text-text-faded font-mono hover:text-text-muted transition-colors text-center"
        >
          {appVersion ? `v${appVersion}` : '点击查看版本'}
        </button>
      </div>
    </div>
  );
}

// ---- 子视图 ----

/** 主视图（默认） */
function MainView({
  isTranslating, isStarting, isConfigured, error, bilingual, audioSource, fontSize,
  onBilingualChange, onAudioSourceChange, onFontSizeChange, onStart, onStop, onNavigate,
}: {
  isTranslating: boolean;
  isStarting: boolean;
  isConfigured: boolean;
  error: string | null;
  bilingual: boolean;
  audioSource: string;
  fontSize: SubtitleFontSize;
  onBilingualChange: (v: boolean) => void;
  onAudioSourceChange: (v: 'system' | 'microphone') => void;
  onFontSizeChange: (v: SubtitleFontSize) => void;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onNavigate: (v: ActiveView) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center flex-1">
      {/* 标题 */}
      <div className="text-center mb-7">
        <h1 className="text-[22px] font-bold text-text-primary tracking-[-0.02em]">{APP_NAME}</h1>
        <p className="text-[13px] text-text-muted mt-1">{APP_TAGLINE}</p>
      </div>

      {/* 状态栏——根据翻译会话的生命周期展示不同状态 */}
      {isStarting && !isTranslating && (
        <p className="text-xs text-accent-blue-text mb-3 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue-text animate-pulse" />
          正在启动音频捕获...
        </p>
      )}
      {isTranslating && (
        <p className="text-xs text-accent-green-text mb-3 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green-text animate-pulse" />
          正在翻译中
        </p>
      )}
      {!isConfigured && (
        <p className="text-xs text-accent-yellow-text mb-3">
          API Key 未配置，请前往「API 设置」配置
        </p>
      )}
      {error && (
        <p className="text-xs text-accent-red-text mb-3">{error}</p>
      )}

      {/* 音频源选择 */}
      <div className="flex gap-2 w-full mb-5">
        <button
          onClick={() => onAudioSourceChange('system')}
          className={
            'flex-1 py-3 rounded-btn transition-all text-[13px] font-semibold ' +
            (audioSource === 'system'
              ? 'border-[1.5px] border-border-active bg-white text-text-primary'
              : 'border border-transparent bg-surface-muted text-text-muted hover:bg-surface-hover')
          }
        >
          系统音频
        </button>
        <button
          onClick={() => onAudioSourceChange('microphone')}
          className={
            'flex-1 py-3 rounded-btn transition-all text-[13px] font-semibold ' +
            (audioSource === 'microphone'
              ? 'border-[1.5px] border-border-active bg-white text-text-primary'
              : 'border border-transparent bg-surface-muted text-text-muted hover:bg-surface-hover')
          }
        >
          麦克风
        </button>
      </div>

      {/* 系统音频模式说明——告知用户无需等待选择器弹窗 */}
      {audioSource === 'system' && !isTranslating && !isStarting && (
        <p className="text-[11px] text-text-faded text-center mb-3 -mt-2">
          系统音频将在后台自动捕获，无需选择窗口
        </p>
      )}

      {/* 开始/停止按钮 */}
      <div className="flex gap-2 w-full mb-4">
        <button
          onClick={onStart}
          disabled={!isConfigured || isStarting || isTranslating}
          className="flex-1 py-3.5 rounded-btn bg-black text-white text-[14px] font-semibold
                     hover:bg-[#333] transition-all active:scale-[0.98]
                     disabled:opacity-25 disabled:cursor-not-allowed disabled:scale-100"
        >
          开始翻译
        </button>
        <button
          onClick={onStop}
          disabled={!isTranslating}
          className="flex-1 py-3.5 rounded-btn border border-border bg-white text-text-muted text-[14px] font-semibold
                     hover:bg-surface-hover transition-all
                     disabled:opacity-25 disabled:cursor-not-allowed"
        >
          停止
        </button>
      </div>

      {/* 双语开关 */}
      <label className="flex items-center gap-2.5 mb-6 cursor-pointer text-[13px] text-text-muted">
        <input
          type="checkbox"
          checked={bilingual}
          onChange={(e) => onBilingualChange(e.target.checked)}
          className="w-4 h-4 rounded-[3px] border-[1.5px] border-border
                     checked:bg-black accent-black"
        />
        双语字幕（原文 + 译文）
      </label>

      {/* 字幕字号选择 */}
      <div className="flex gap-2 w-full mb-5">
        {(['sm', 'md', 'lg'] as const).map((size) => {
          const labels: Record<SubtitleFontSize, string> = { sm: '小', md: '中', lg: '大' };
          return (
            <button
              key={size}
              onClick={() => onFontSizeChange(size)}
              className={
                'flex-1 py-2.5 rounded-btn transition-all text-[12px] font-semibold ' +
                (fontSize === size
                  ? 'border-[1.5px] border-border-active bg-white text-text-primary'
                  : 'border border-transparent bg-surface-muted text-text-muted hover:bg-surface-hover')
              }
            >
              {labels[size]}
            </button>
          );
        })}
      </div>

      {/* 菜单卡片 */}
      <div className="w-full space-y-1.5">
        <MenuCard label="翻译历史" onClick={() => onNavigate('history')} />
        <MenuCard label="API 设置" onClick={() => onNavigate('settings')} />
        <MenuCard
          label="演示视频"
          onClick={() => { window.electronAPI?.openExternal(DEMO_VIDEO_URL); }}
        />
      </div>
    </div>
  );
}

/** 菜单卡片 */
function MenuCard({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3.5 rounded-card border border-border bg-surface
                 text-[14px] text-text-primary hover:bg-surface-hover transition-all"
    >
      {label}
    </button>
  );
}

/** 设置视图 */
function SettingsView({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <button
        onClick={onBack}
        className="text-xs text-text-muted hover:text-text-primary transition-colors mb-5"
      >
        返回
      </button>
      <div className="flex flex-col gap-6">
        <ASRSettings />
        <div className="h-px bg-border" />
        <LLMSettings />
        <p className="text-[10px] text-text-faded text-center mt-2">
          所有密钥加密存储在本机，不上传云端
        </p>
      </div>
    </div>
  );
}
