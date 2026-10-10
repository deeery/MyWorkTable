import { useRef, useState } from 'react'
import type { InstalledPlugin } from '../core/storage'
import { useApp } from '../state/AppContext'
import { IframeHost } from './IframeHost'
import { ModuleHost } from './ModuleHost'
import { SIZE_MIN_H, SIZE_NEXT, SIZE_SPAN } from './sizes'

/**
 * 插件卡片：标题栏（尺寸切换 / 手动刷新 / 移出桌面）+ 渲染宿主
 * 支持拖拽排序（与桌面网格配合）。
 */
export function PluginCard({
  plugin,
  onDragStart,
  onDragEnter,
  onDrop,
  dragging,
  dragOver,
}: {
  plugin: InstalledPlugin
  onDragStart?: () => void
  onDragEnter?: () => void
  onDrop?: () => void
  dragging?: boolean
  dragOver?: boolean
}) {
  const { setSize, setVisible } = useApp()
  const tickRef = useRef<(() => void) | null>(null)
  const m = plugin.manifest
  const isManual = m.refresh.intervalMs === 0
  const isStatic = m.refresh.intervalMs === -1

  return (
    <div
      className={`plugin-card${dragging ? ' dragging' : ''}${dragOver ? ' drag-over' : ''}`}
      style={{ gridColumn: `span ${SIZE_SPAN[plugin.size]}`, minHeight: SIZE_MIN_H[plugin.size] }}
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDrop?.() }}
      title="拖拽可调整卡片顺序"
    >
      <div className="card-head">
        <span className="icon">{m.icon}</span>
        <span className="title">{m.name}</span>
        <span className="badge">{isStatic ? '静态' : isManual ? '手动' : fmtInterval(m.refresh.intervalMs)}</span>
        <span className="spacer" />
        <button title="切换尺寸" onClick={() => setSize(m.id, SIZE_NEXT[plugin.size] as never)}>⤢ {plugin.size}</button>
        <button title="立即刷新" onClick={() => tickRef.current?.()}>⟳</button>
        <button title="移出桌面" onClick={() => setVisible(m.id, false)}>✕</button>
      </div>
      <div className="card-body">
        {m.renderMode === 'iframe' ? (
          <IframeHost key={`${m.id}:${plugin.enabled}`} plugin={plugin} tickRef={tickRef} />
        ) : (
          <ModuleHost key={`${m.id}:${plugin.enabled}`} plugin={plugin} tickRef={tickRef} />
        )}
      </div>
    </div>
  )
}

function fmtInterval(ms: number) {
  if (ms % 60000 === 0) return `${ms / 60000} 分钟`
  if (ms % 1000 === 0) return `${ms / 1000} 秒`
  return `${ms}ms`
}
