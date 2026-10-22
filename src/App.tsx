import { useState } from 'react'
import { Sidebar, SidebarRestore } from './components/Sidebar'
import { Backdrop } from './components/Backdrop'
import { OverlayHost } from './components/OverlayHost'
import { PluginDock } from './components/PluginDock'
import { TitleBar } from './components/TitleBar'
import { WorkspaceTabs } from './components/WorkspaceTabs'
import { useApp } from './state/AppContext'
import { Desktop } from './pages/Desktop'
import { Plugins } from './pages/Plugins'
import { Settings } from './pages/Settings'
import { Profile } from './pages/Profile'

export type PageKey = 'desktop' | 'plugins' | 'settings' | 'profile'

export default function App() {
  const [page, setPage] = useState<PageKey>('desktop')
  const { installed } = useApp()

  /**
   * 悬浮插件（manifest.overlay）：贴在最上层，不占桌面卡片。
   * 只有启用且「在桌面」的才渲染 —— 用户把它移出桌面就该消失。
   */
  const overlays = installed.filter((p) => p.manifest.overlay && p.enabled && p.visible)

  return (
    <>
      {/* 背景层固定在最底层（z-index 0），内容层 .app-shell 压在其上 */}
      <Backdrop />
      {/* 自绘标题栏：只在桌面壳里渲染（浏览器里没有真实窗口，画了也没用） */}
      <TitleBar />
      <div className="app-shell">
        <Sidebar page={page} onNavigate={setPage} />
        <main className="main">
          {/* 侧边栏隐藏时，把形态切换按钮留在标题栏上方，保证始终可恢复 */}
          <SidebarRestore />
          {page === 'desktop' && (
            <>
              {/* 工作台标签栏：每个工作台是一份独立的布局快照 */}
              <WorkspaceTabs />
              <Desktop />
            </>
          )}
          {page === 'plugins' && <Plugins />}
          {page === 'settings' && <Settings />}
          {page === 'profile' && <Profile onNavigate={setPage} />}
        </main>
      </div>
      {/* 悬浮插件层：桌宠这类「贴在最上层」的插件。
          key 用窗口 id —— 同一插件也能开多个悬浮实例（两只猫）。 */}
      {overlays.map((p) => (
        <OverlayHost key={p.id} plugin={p} />
      ))}
      {/* 插件坞：右下角快速入口（最多 10 个，可拖动排序、可搜索） */}
      <PluginDock />
    </>
  )
}
