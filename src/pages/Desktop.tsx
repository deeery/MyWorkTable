import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { PluginCard } from '../components/PluginCard'

/** 桌面：可见插件卡片网格，支持拖拽排序 */
export function Desktop() {
  const { installed, settings, reorder, setVisible } = useApp()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const visible = installed.filter((p) => p.visible)

  return (
    <>
      <div className="page-title">桌面</div>
      <div className="page-desc">
        已启用 {visible.filter((p) => p.enabled).length} / {visible.length} 个插件 · 拖拽卡片可排序 · 点击 ⤢ 切换尺寸
      </div>

      {visible.length === 0 ? (
        <div className="empty-tip">
          桌面还是空的，去「插件」页面添加几个吧～
        </div>
      ) : (
        <div className="plugin-grid" style={{ gridTemplateColumns: `repeat(${settings.desktopColumns}, 1fr)` }}>
          {visible.map((p) => (
            <PluginCard
              key={p.manifest.id}
              plugin={p}
              dragging={dragId === p.manifest.id}
              dragOver={overId === p.manifest.id && dragId !== p.manifest.id}
              onDragStart={() => setDragId(p.manifest.id)}
              onDragEnter={() => setOverId(p.manifest.id)}
              onDrop={() => {
                if (dragId && dragId !== p.manifest.id) reorder(dragId, p.manifest.id)
                setDragId(null)
                setOverId(null)
              }}
            />
          ))}
        </div>
      )}

      {installed.some((p) => !p.visible) && (
        <div className="panel" style={{ marginTop: 20 }}>
          <h3>隐藏的插件</h3>
          {installed.filter((p) => !p.visible).map((p) => (
            <div key={p.manifest.id} className="setting-row">
              <span className="label">{p.manifest.icon} {p.manifest.name}</span>
              <button className="btn small" onClick={() => setVisible(p.manifest.id, true)}>显示到桌面</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
