import { useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { APP_NAME, APP_TAGLINE } from '../../../shared/app-config';
import {
  asrConfigAtom,
  audioSourceAtom,
  bilingualAtom,
  llmConfigAtom,
} from '../../stores/settings-store';
import { useTranslationSession } from '../../hooks/useTranslationSession';
import { ASRSettings } from '../settings/ASRSettings';
import { LLMSettings } from '../settings/LLMSettings';

/** 当前显示的视图 */
type ActiveView = 'main' | 'settings' | 'history' | 'demo';

/** 主控制窗口组件 */
export function MainWindow(): JSX.Element {
  const [activeView, setActiveView] = useState<ActiveView>('main');
  const [appVersion, setAppVersion] = useState<string>('');
  const [bilingual, setBilingual] = useAtom(bilingualAtom);
  const [audioSource, setAudioSource] = useAtom(audioSourceAtom);

  const asrConfig = useAtomValue(asrConfigAtom);
  const llmConfig = useAtomValue(llmConfigAtom);

  const { isTranslating, error, isConfigured, start, stop } = useTranslationSession(
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

  const handleStart = async (): Promise<void> => {
    if (!isConfigured) return;
    await window.electronAPI?.showOverlay();
    await start();
  };

  const handleStop = async (): Promise<void> => {
    stop();
    await window.electronAPI?.hideOverlay();
  };

  return (
    <div className="h-full flex flex-col p-3"
         style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(99,102,241,0.04) 0%, transparent 70%), #FFFFFF' }}>
      {/* 毛玻璃主卡片 */}
      <div className="flex-1 flex flex-col rounded-2xl border border-border
                      bg-[rgba(255,255,255,0.72)] backdrop-blur-2xl p-7"
           style={{ backdropFilter: 'blur(24px) saturate(1.4)', WebkitBackdropFilter: 'blur(24px) saturate(1.4)' }}>

        {/* 视图内容区 */}
        {activeView === 'settings' ? (
          <SettingsView onBack={() => setActiveView('main')} />
        ) : activeView === 'history' ? (
          <PlaceholderView title="Translation History" onBack={() => setActiveView('main')} />
        ) : activeView === 'demo' ? (
          <PlaceholderView title="Demo Mode" onBack={() => setActiveView('main')} />
        ) : (
          <MainView
            isTranslating={isTranslating}
            isConfigured={isConfigured}
            error={error}
            bilingual={bilingual}
            audioSource={audioSource}
            onBilingualChange={setBilingual}
            onAudioSourceChange={setAudioSource}
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
          {appVersion ? `v${appVersion}` : 'Click to check version'}
        </button>
      </div>
    </div>
  );
}

// ---- 子视图 ----

/** 主视图（默认） */
function MainView({
  isTranslating, isConfigured, error, bilingual, audioSource, onBilingualChange,
  onAudioSourceChange, onStart, onStop, onNavigate,
}: {
  isTranslating: boolean;
  isConfigured: boolean;
  error: string | null;
  bilingual: boolean;
  audioSource: string;
  onBilingualChange: (v: boolean) => void;
  onAudioSourceChange: (v: 'system' | 'microphone') => void;
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

      {/* 状态栏 */}
      {isTranslating && (
        <p className="text-xs text-accent-green-text mb-3 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green-text animate-pulse" />
          Translating
        </p>
      )}
      {!isConfigured && (
        <p className="text-xs text-accent-yellow-text mb-3">
          API Key not configured. Go to Settings to configure.
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
          System Audio
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
          Microphone
        </button>
      </div>

      {/* 开始/停止按钮 */}
      <div className="flex gap-2 w-full mb-4">
        <button
          onClick={onStart}
          disabled={!isConfigured || isTranslating}
          className="flex-1 py-3.5 rounded-btn bg-black text-white text-[14px] font-semibold
                     hover:bg-[#333] transition-all active:scale-[0.98]
                     disabled:opacity-25 disabled:cursor-not-allowed disabled:scale-100"
        >
          Start Translation
        </button>
        <button
          onClick={onStop}
          disabled={!isTranslating}
          className="flex-1 py-3.5 rounded-btn border border-border bg-white text-text-muted text-[14px] font-semibold
                     hover:bg-surface-hover transition-all
                     disabled:opacity-25 disabled:cursor-not-allowed"
        >
          Stop
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
        Bilingual Subtitles (Original + Translation)
      </label>

      {/* 菜单卡片 */}
      <div className="w-full space-y-1.5">
        <MenuCard label="Translation History" onClick={() => onNavigate('history')} />
        <MenuCard label="API Settings" onClick={() => onNavigate('settings')} />
        <MenuCard label="Demo Mode" onClick={() => onNavigate('demo')} />
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
        Back
      </button>
      <div className="flex flex-col gap-6">
        <ASRSettings />
        <div className="h-px bg-border" />
        <LLMSettings />
        <p className="text-[10px] text-text-faded text-center mt-2">
          All keys encrypted locally &middot; Never uploaded
        </p>
      </div>
    </div>
  );
}

/** 占位视图（翻译历史/演示模式，后续 PR 实现） */
function PlaceholderView({ title, onBack }: { title: string; onBack: () => void }): JSX.Element {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3">
      <p className="text-text-muted text-sm">{title}</p>
      <p className="text-text-faded text-xs">Coming soon</p>
      <button
        onClick={onBack}
        className="text-xs text-text-muted hover:text-text-primary transition-colors mt-4"
      >
        Back
      </button>
    </div>
  );
}
