import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { IconClose, IconPlus } from './icons'

/**
 * 插件坞（右下角）
 * ------------------------------------------------------------
 * **桌面唯一的「添加插件」入口**。
 *
 * 这里原本与桌面右下角的「＋新建窗口」按钮并存，两者功能完全重叠
 * （都是「列出插件 → 点一下放到桌面」），只是表现不同：
 *   ＋ 面板：列出全部 + 描述 + 状态徽标，不可拖动、无搜索
 *   插件坞：最多 10 个 + 可拖动排序 + 可搜索，但信息较简
 * 两个入口做同一件事，用户还得猜该点哪个。现在合并成一个：
 * 以插件坞为底，吸收「＋」面板的描述与徽标。
 *
 * 能力：
 *   - 最多同时显示 10 个（超出用搜索找）
 *   - 可拖动排序（拖到另一个上即插到它前面）
 *   - 支持搜索插件名
 *   - 点一下放到桌面并置顶（已在桌面的直接置顶）
 *   - 默认收起成一个圆形按钮，不占桌面空间
 */

/**
 * 坞里最多**同时显示**的项目数。
 *
 * 这是「10 项」的**唯一真源**：以 CSS 变量 `--dock-rows` 传给样式，
 * 列表区高度 = 10 行 + 9 个间距（见 global.css 的 .dock-list）。
 * 想改成 8 项或 12 项，只改这一个数字即可。
 *
 * ⚠ 早先这个数字是用来 `filtered.slice(0, MAX_ITEMS)` **截断列表**的，
 * 第 11 个之后的插件直接不渲染，再提示「还有 N 个未显示 —— 用搜索框找」——
 * 用户想装第 11 个插件还得先猜名字去搜，很别扭。
 * 现在全部渲染，靠滚动查看。
 */
const MAX_ITEMS = 10

/**
 * 外部唤起插件坞的事件名。
 *
 * 桌面右键菜单的「新建窗口」由桌面壳主进程下发 open-add 命令，
 * 由 Desktop 接收 —— 但插件坞挂在 App 层，两者不在同一棵子树里。
 * 用一个 window 级 CustomEvent 打通，比为此加一份 context state 轻。
 */
export const OPEN_DOCK_EVENT = 'workbench:open-dock'

export function PluginDock() {
  const {
    installed, installedGlobal, dockOrder, moveInDock,
    openWindow, countWindows, setEnabled,
  } = useApp()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  /** 拖动中的插件 id 与悬停目标 */
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  // 桌面右键菜单的「新建窗口」→ 打开插件坞
  useEffect(() => {
    const h = () => setOpen(true)
    window.addEventListener(OPEN_DOCK_EVENT, h)
    return () => window.removeEventListener(OPEN_DOCK_EVENT, h)
  }, [])

  // 面板打开时按 Esc 收起
  useEffect(() => {
    if (!open) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setQ('') }
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [open])

  /**
   * 坞里列的是**已安装插件**（每个插件一条），不是窗口。
   *
   * 早先这里用的是当前工作台的窗口视图，多窗口之后会把同一个插件
   * 列出好几遍（开了 3 个时钟就出现 3 条「世界时钟」）—— 但坞的用途是
   * 「选一个插件来新建窗口」，所以每个插件只该有一条。
   */
  const ordered = useMemo(() => {
    const byId = new Map(installedGlobal.map((p) => [p.manifest.id, p]))
    const inOrder: typeof installedGlobal = []
    for (const id of dockOrder) {
      const p = byId.get(id)
      if (p) { inOrder.push(p); byId.delete(id) }
    }
    // 剩下的按安装顺序补在后面
    for (const p of installedGlobal) if (byId.has(p.manifest.id)) inOrder.push(p)
    return inOrder
  }, [installedGlobal, dockOrder])

  /** 搜索过滤（名字 / 描述 / id） */
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return ordered
    return ordered.filter((p) =>
      p.manifest.name.toLowerCase().includes(s) ||
      p.manifest.id.toLowerCase().includes(s) ||
      (p.manifest.description ?? '').toLowerCase().includes(s),
    )
  }, [ordered, q])

  /**
   * 列表**全部渲染**，可见高度交给 CSS 锁成 10 行（见 .dock-list）。
   *
   * 这里不再 slice —— 滚动条让用户能看到全部插件，
   * 比「截断 + 提示去搜索」直接得多。
   */
  const shown = filtered

  const onDrop = (toId: string) => {
    if (dragId && dragId !== toId) moveInDock(dragId, toId)
    setDragId(null)
    setOverId(null)
  }

  if (!open) {
    return (
      <div className="dock-wrap">
        <button
          className="dock-launch"
          onClick={() => setOpen(true)}
          title={`新建窗口（从 ${installed.length} 个已安装插件里选）`}
        >
          <span className="dock-launch-ico"><IconPlus size={18} /></span>
          <span className="dock-launch-n">{installedGlobal.length}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="dock-wrap">
      <button
        className="dock-launch on"
        onClick={() => { setOpen(false); setQ('') }}
        title="收起"
      >
        <span className="dock-launch-ico"><IconPlus size={18} /></span>
        <span className="dock-launch-n">{installedGlobal.length}</span>
      </button>

      {/*
        把 MAX_ITEMS 以 CSS 变量交给样式 —— 「最多显示 10 项」只在
        这一个地方定义，样式按它算列表高度，不会两处数字对不上。
      */}
      <div className="dock" style={{ '--dock-rows': MAX_ITEMS } as React.CSSProperties}>
        <div className="dock-head">
          <span className="dock-title">新建窗口</span>
          <span className="dock-sub">
            {q.trim()
              ? `${filtered.length} 个匹配`
              : `${installedGlobal.length} 个插件 · 点击新建窗口`}
          </span>
          <span style={{ flex: 1 }} />
          <button className="dock-x" onClick={() => { setOpen(false); setQ('') }} title="收起"><IconClose size={13} /></button>
        </div>

      <div className="dock-search">
        <input
          type="search"
          value={q}
          placeholder="搜索插件…"
          onChange={(e) => setQ(e.target.value)}
        />
        {q && <button className="dock-clear" onClick={() => setQ('')} title="清空"><IconClose size={12} /></button>}
      </div>

      {shown.length === 0 ? (
        <div className="dock-empty">
          {installed.length === 0 ? '还没有安装任何插件' : `没有匹配「${q}」的插件`}
        </div>
      ) : (
        <div className="dock-list">
          {shown.map((p) => {
            const id = p.manifest.id
            // 该插件在当前工作台已开几个窗口。多窗口之后「已在桌面」
            // 这个说法不够用了 —— 开了 2 个就是 2 个窗口
            const openCount = countWindows(id)
            const enabled = p.enabled
            return (
              <div
                key={id}
                className={`dock-item${openCount > 0 ? ' on' : ''}${dragId === id ? ' dragging' : ''}${overId === id ? ' over' : ''}${!enabled ? ' off' : ''}`}
                draggable
                onDragStart={(e) => {
                  setDragId(id)
                  e.dataTransfer.effectAllowed = 'move'
                  // 必须 setData，否则 Firefox 不触发 drop
                  e.dataTransfer.setData('text/plain', id)
                }}
                onDragOver={(e) => {
                  if (!dragId || dragId === id) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setOverId(id)
                }}
                onDrop={(e) => { e.preventDefault(); onDrop(id) }}
                onDragEnd={() => { setDragId(null); setOverId(null) }}
                onClick={() => {
                  /**
                   * 点击 = **新建一个该插件的窗口**。
                   *
                   * 多窗口之后这里不再做「已在桌面就置顶」的分支 ——
                   * 每次点击都实实在在多开一个窗口，这才符合
                   * 「给同一个插件创建多个窗口」的预期。
                   * 停用的插件先启用，否则建出来是个空壳。
                   * 建完收起面板，让用户直接看到新窗口。
                   */
                  if (!enabled) setEnabled(id, true)
                  openWindow(id)
                  setOpen(false)
                  setQ('')
                }}
                title={`${p.manifest.name} · 点击新建窗口${openCount ? `（已开 ${openCount} 个）` : ''}`}
              >
                <span className="dock-ico">{p.manifest.icon}</span>
                <span className="dock-body">
                  <span className="dock-name">
                    {p.manifest.name}
                    {/* 状态徽标：从原「＋」面板吸收过来的，一眼看出
                        哪些已在桌面、哪些是悬浮插件、哪些被停用了 */}
                    {p.manifest.overlay && <span className="dock-badge">悬浮</span>}
                    {openCount > 0 && (
                      <span className="dock-badge on">
                        {openCount > 1 ? `已开 ${openCount} 个` : '已开 1 个'}
                      </span>
                    )}
                    {!enabled && <span className="dock-badge">已停用</span>}
                  </span>
                  {/* 描述也一并吸收：坞里原来只有名字，光看名字
                      未必想得起这个插件是干什么的 */}
                  {p.manifest.description && (
                    <span className="dock-desc">{p.manifest.description}</span>
                  )}
                </span>
                <span className="dock-dot" title={openCount > 0 ? `已开 ${openCount} 个窗口` : '未开窗口'} />
              </div>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}
