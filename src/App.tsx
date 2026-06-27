import { OverlayWindow } from './components/layout/OverlayWindow';
import { MainWindow } from './components/layout/MainWindow';

/** 应用根组件 — 根据 hash 路由到主窗口或悬浮窗 */
function App(): JSX.Element {
  const isOverlay = window.location.hash === '#overlay';

  if (isOverlay) {
    return <OverlayWindow />;
  }
  return <MainWindow />;
}

export default App;
