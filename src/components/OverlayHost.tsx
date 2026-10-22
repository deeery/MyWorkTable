import { useEffect, useRef, useState } from 'react'
import type { PluginView } from '../core/storage'
import { resolveAppUrl } from '../core/url'

/**
 * 悬浮插件宿主
 * ------------------------------------------------------------
 * 渲染声明了 manifest.overlay 的插件（如桌宠 #51）。
 *
 * 与 IframeHost 的区别：
 *   - 容器是 fixed 定位，直接贴在视口上，不参与桌面画布布局
 *     （桌面画布有 transform: scale，普通卡片会被缩放变形，
 *      而悬浮插件要「贴在屏幕上」的稳定感）
 *   - 自带拖动：按住内容拖动整个容器
 *   - 位置持久化到 localStorage（按插件 id 分开存）
 *
 * 拖动的两种来源：
 *   1. 用户直接拖 iframe 之外的容器边缘 —— 但 iframe 会吞鼠标事件，
 *      所以容器本身留了一圈可拖的边距
 *   2. 插件内部把鼠标位移 postMessage 出来（pl:pet-move）——
 *      桌宠就是这么做的：它自己在 iframe 里监听鼠标，
 *      把增量发出来由宿主移动容器
 */
export function OverlayHost({ plugin }: { plugin: PluginView }) {
  const m = plugin.manifest
  const ov = m.overlay!
  /**
   * 位置按**窗口 id** 存，不是插件 id ——
   * 同一插件开多个悬浮实例时（两只猫），它们要能各在各的位置。
   */
  const posKey = `workbench:overlay:${plugin.id}`

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(posKey)
      if (raw) {
        const p = JSON.parse(raw) as { x?: number; y?: number }
        if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y }
      }
    } catch { /* 损坏数据就用默认位置 */ }
    return { x: ov.x ?? 200, y: ov.y ?? 300 }
  })
  const [dragging, setDragging] = useState(false)

  const posRef = useRef(pos)
  posRef.current = pos

  // 位置持久化：拖动结束才写，避免拖动过程中疯狂写 localStorage
  useEffect(() => {
    if (dragging) return
    try { localStorage.setItem(posKey, JSON.stringify(pos)) } catch { /* 忽略 */ }
  }, [pos, dragging, posKey])

  /* 容器自身的拖动（抓边缘那圈） */
  const dragRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const s = dragRef.current
      if (!s) return
      // 夹到视口内，别把桌宠拖出屏幕找不回来
      const w = ov.width ?? 160
      const h = ov.height ?? 150
      setPos({
        x: Math.min(Math.max(-w / 3, s.px + (e.clientX - s.mx)), window.innerWidth - w / 2),
        y: Math.min(Math.max(0, s.py + (e.clientY - s.my)), window.innerHeight - h / 2),
      })
    }
    const onUp = () => { setDragging(false); dragRef.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging, ov.width, ov.height])

  /**
   * 插件内部发来的拖动消息。
   *
   * 桌宠在 iframe 里监听鼠标（那里才能拿到准确的按下/移动/抬起），
   * 但 iframe 不能移动自己的父元素 —— 所以把位移发出来，宿主来挪容器。
   * 注意 pl:pet-move 传的是**绝对视口坐标**，直接用作新位置。
   */
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data
      if (!d || typeof d.type !== 'string') return
      if (d.type === 'pl:pet-drag-start') {
        setDragging(true)
      } else if (d.type === 'pl:pet-move') {
        const w = ov.width ?? 160
        const h = ov.height ?? 150
        setPos({
          x: Math.min(Math.max(-w / 3, Number(d.dx) - w / 2), window.innerWidth - w / 2),
          y: Math.min(Math.max(0, Number(d.dy) - h / 2), window.innerHeight - h / 2),
        })
      } else if (d.type === 'pl:pet-drag-end') {
        setDragging(false)
      } else if (d.type === 'pl:pet-walk') {
        // 随机走动：插件给的是增量，这里累加并夹到视口内
        const w = ov.width ?? 160
        const h = ov.height ?? 150
        setPos((p) => ({
          x: Math.min(Math.max(0, p.x + Number(d.dx || 0)), Math.max(0, window.innerWidth - w)),
          y: Math.min(Math.max(0, p.y + Number(d.dy || 0)), Math.max(0, window.innerHeight - h)),
        }))
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [ov.width, ov.height])

  if (!plugin.enabled) return null

  return (
    <div
      className={`overlay-host${dragging ? ' dragging' : ''}`}
      style={{
        left: pos.x,
        top: pos.y,
        width: ov.width ?? 160,
        height: ov.height ?? 150,
      }}
      /* 容器边缘那圈留白可拖；中间是 iframe，事件进不去 */
      onMouseDown={(e) => {
        // 只有点在容器自己（不是 iframe）上时才由宿主拖
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        dragRef.current = { mx: e.clientX, my: e.clientY, px: posRef.current.x, py: posRef.current.y }
        setDragging(true)
      }}
      title={`${m.name} · 拖动移动`}
    >
      <iframe
        className="overlay-frame"
        src={resolveAppUrl(m.entry)}
        title={m.name}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  )
}
