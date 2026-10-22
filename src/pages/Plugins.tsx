import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { PLUGIN_CATALOG } from '../core/registry'
import type { PluginManifest } from '../types/plugin'
import { IconPlus } from '../components/icons'

const CATEGORY_LABEL: Record<string, string> = {
  tool: '工具', data: '数据', info: '信息', fun: '趣味', other: '其他',
}

/**
 * 插件页：市场 + 已安装管理
 *
 * 这一页管的是**插件**（装/卸/启停），不是窗口 ——
 * 窗口的增删在桌面（插件坞 + 卡片上的 ⧉/✕）。
 * 所以这里的「上桌面」按钮改成了「新建窗口」：点击即多开一个窗口，
 * 与插件坞的行为一致；关窗口请在桌面上点卡片右上角的 ✕。
 */
export function Plugins() {
  const { installedGlobal, installed, install, uninstall, setEnabled, openWindow, countWindows } = useApp()
  const [tab, setTab] = useState<'market' | 'installed'>('installed')
  const installedIds = new Set(installedGlobal.map((p) => p.manifest.id))
  // 当前工作台上的窗口总数（用于页签上的提示）。
  // 必须 filter(visible)：`installed` 里每个插件都带一条 visible:false 的
  // 占位窗口（插件坞靠它按需建窗），直接取 length 会把占位窗也算进去 ——
  // 装了 6 个插件、只开 3 个窗口时会显示「11 个窗口」。
  const windowCount = installed.filter((p) => p.visible).length

  return (
    <>
      <div className="tab-row">
        <button className={`btn small${tab === 'installed' ? ' on' : ''}`} onClick={() => setTab('installed')}>
          已安装（{installedGlobal.length}）· 当前工作台 {windowCount} 个窗口
        </button>
        <button className={`btn small${tab === 'market' ? ' on' : ''}`} onClick={() => setTab('market')}>
          插件市场（{PLUGIN_CATALOG.length}）
        </button>
      </div>

      {tab === 'market' ? (
        <div className="market-grid">
          {PLUGIN_CATALOG.map((m) => (
            <MarketCard key={m.id} m={m} installed={installedIds.has(m.id)} onInstall={() => install(m)} />
          ))}
        </div>
      ) : (
        <div className="market-grid">
          {installedGlobal.length === 0 && <div className="empty-tip">尚未安装任何插件，去插件市场逛逛。</div>}
          {installedGlobal.map((p) => {
            const m = p.manifest
            const n = countWindows(m.id)
            return (
              <div key={m.id} className="market-card">
                <div className="head">
                  <span className="icon">{m.icon}</span>
                  <div>
                    <div className="name">{m.name} <span className="ver">v{m.version}</span></div>
                    <div className="ver">{m.author ?? 'workbench'} · {CATEGORY_LABEL[m.category]}</div>
                  </div>
                </div>
                <div className="desc">{m.description}</div>
                <div className="foot">
                  <span className={`badge ${m.renderMode}`}>{m.renderMode === 'iframe' ? 'iframe 沙箱' : 'ES Module'}</span>
                  <span className="badge">{refreshLabel(m)}</span>
                  {n > 0 && <span className="badge on">已开 {n} 个窗口</span>}
                  <span style={{ flex: 1 }} />
                  <button className="btn small" onClick={() => setEnabled(m.id, !p.enabled)}>
                    {p.enabled ? '停用' : '启用'}
                  </button>
                  {/* 点击即新建一个窗口，可重复点以开多个 */}
                  <button
                    className="btn small"
                    onClick={() => openWindow(m.id)}
                    title="新建一个该插件的窗口（可重复点开多个）"
                  >
                    <IconPlus size={12} /> 新建窗口
                  </button>
                  <button className="btn small danger" onClick={() => uninstall(m.id)}>卸载</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function refreshLabel(m: PluginManifest) {
  const ms = m.refresh.intervalMs
  if (ms === 0) return '手动刷新'
  if (ms === -1) return '静态'
  if (ms >= 60000) return `每 ${ms / 60000} 分钟`
  return `每 ${ms / 1000} 秒`
}

function MarketCard({ m, installed, onInstall }: { m: PluginManifest; installed: boolean; onInstall: () => void }) {
  return (
    <div className="market-card">
      <div className="head">
        <span className="icon">{m.icon}</span>
        <div>
          <div className="name">{m.name} <span className="ver">v{m.version}</span></div>
          <div className="ver">{m.author ?? 'workbench'} · {CATEGORY_LABEL[m.category]}</div>
        </div>
      </div>
      <div className="desc">{m.description}</div>
      <div className="foot">
        <span className={`badge ${m.renderMode}`}>{m.renderMode === 'iframe' ? 'iframe 沙箱' : 'ES Module'}</span>
        <span className="badge">{refreshLabel(m)}</span>
        {m.permissions?.storage && <span className="badge">storage</span>}
        {m.permissions?.notify && <span className="badge">notify</span>}
        <span style={{ flex: 1 }} />
        {installed ? (
          <span className="badge on">已安装</span>
        ) : (
          <button className="btn small primary" onClick={onInstall}>安装</button>
        )}
      </div>
    </div>
  )
}
