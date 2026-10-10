import { useApp } from '../state/AppContext'

/** 设置页：主题 / 刷新倍率 / 桌面布局 */
export function Settings() {
  const { settings, setTheme, setRefreshMultiplier, setDesktopColumns } = useApp()
  const multiplierLabel =
    settings.refreshMultiplier === 1 ? '标准' :
    settings.refreshMultiplier > 1 ? `省电（${settings.refreshMultiplier}×）` : `高频（${settings.refreshMultiplier}×）`

  return (
    <>
      <div className="page-title">设置</div>
      <div className="page-desc">全局设置即刻生效并自动持久化到本地。</div>

      <div className="panel">
        <h3>外观</h3>
        <div className="setting-row">
          <div>
            <div className="label">主题模式</div>
            <div className="hint">切换后所有插件将收到 workbench:theme / onThemeChange 通知</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn small${settings.theme === 'light' ? ' primary' : ''}`} onClick={() => setTheme('light')}>浅色</button>
            <button className={`btn small${settings.theme === 'dark' ? ' primary' : ''}`} onClick={() => setTheme('dark')}>深色</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>刷新调度</h3>
        <div className="setting-row">
          <div>
            <div className="label">全局刷新倍率：{multiplierLabel}</div>
            <div className="hint">缩放所有插件的实际刷新周期（页面不可见时自动暂停调度以省资源）</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range" min="0.25" max="4" step="0.25"
              value={settings.refreshMultiplier}
              onChange={(e) => setRefreshMultiplier(Number(e.target.value))}
            />
            <span style={{ minWidth: 40, textAlign: 'right' }}>{settings.refreshMultiplier}×</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>桌面布局</h3>
        <div className="setting-row">
          <div>
            <div className="label">网格列数：{settings.desktopColumns} 列</div>
            <div className="hint">插件卡片尺寸 S / M / L / XL 分别占 1 / 1 / 2 / 3 列</div>
          </div>
          <select value={settings.desktopColumns} onChange={(e) => setDesktopColumns(Number(e.target.value))}>
            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div className="panel">
        <h3>关于插件协议</h3>
        <div className="setting-row">
          <div className="hint" style={{ lineHeight: 1.8 }}>
            本工作台采用 <b>Plugin Protocol v1</b>：插件以 <b>manifest</b> 声明入口、渲染模式
            （iframe 沙箱 / ES Module）、刷新策略与权限；宿主统一调度刷新、下发主题，并以
            postMessage / PluginContext 两种通道通信。完整规范见项目 <code>docs/PLUGIN_SPEC.md</code>。
          </div>
        </div>
      </div>
    </>
  )
}
