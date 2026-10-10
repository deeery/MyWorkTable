import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { PLUGIN_CATALOG } from '../core/registry'
import type { PluginManifest } from '../types/plugin'

const CATEGORY_LABEL: Record<string, string> = {
  tool: '工具', data: '数据', info: '信息', fun: '趣味', other: '其他',
}

/** 插件页：市场 + 已安装管理 */
export function Plugins() {
  const { installed, install, uninstall, setEnabled, setVisible } = useApp()
  const [tab, setTab] = useState<'market' | 'installed'>('installed')
  const installedIds = new Set(installed.map((p) => p.manifest.id))

  return (
    <>
      <div className="page-title">插件</div>
      <div className="page-desc">安装、启停与卸载插件。所有插件遵循统一的 manifest 协议与渲染规范。</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn small${tab === 'installed' ? ' primary' : ''}`} onClick={() => setTab('installed')}>
          已安装（{installed.length}）
        </button>
        <button className={`btn small${tab === 'market' ? ' primary' : ''}`} onClick={() => setTab('market')}>
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
          {installed.length === 0 && <div className="empty-tip">尚未安装任何插件，去插件市场逛逛。</div>}
          {installed.map((p) => {
            const m = p.manifest
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
                  <span style={{ flex: 1 }} />
                  <button className="btn small" onClick={() => setEnabled(m.id, !p.enabled)}>
                    {p.enabled ? '停用' : '启用'}
                  </button>
                  <button className="btn small" onClick={() => setVisible(m.id, !p.visible)}>
                    {p.visible ? '隐藏' : '上桌面'}
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
