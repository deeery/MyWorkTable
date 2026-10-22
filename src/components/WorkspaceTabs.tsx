import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import {
  IconClose,
  IconDuplicate,
  IconPencil,
  IconPlus,
  IconStar,
  IconStarOutline,
} from './icons'

/**
 * 顶部栏（工作台选择条）
 * ------------------------------------------------------------
 * 这是**唯一**的顶部栏 —— 原来每页各有一条「页面标题 + 描述」，
 * 已全部移除：那一条只是为了说明当前在哪一页，而侧边栏的高亮
 * 已经把这件事说清楚了，纯属占地方。
 *
 * 现在顶部栏只做一件事：选工作台。因此它平时也不该占地方 ——
 * 鼠标不在上面时自动缩成一条细线（保留几像素的感应区，
 * 鼠标移上去立刻展开），可选「锁定」让它一直展开。
 *
 * 交互：
 *   - 点标签切换工作台
 *   - 双击标签重命名（内联输入框，回车确认 / Esc 取消）
 *   - 标签上的 × 关闭（只剩一个时禁用）
 *   - 标签上的 ☆ 设为默认（已默认的显示为实心 ★）
 *   - 右键标签 → 复制一份 / 重命名 / 设为默认 / 关闭
 *   - 右侧 🔒/🔓 锁定展开（锁定后不再自动缩入）
 */
export function WorkspaceTabs() {
  const {
    workspaces, activeWorkspace, settings, setTopbarMode,
    switchWorkspace, addWorkspace, removeWorkspace, renameWorkspace,
    setDefaultWorkspace, duplicateWorkspace,
  } = useApp()

  const locked = settings.topbarMode === 'locked'

  /** 正在重命名的标签 id 与草稿值 */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** 右键菜单：{ id, x, y } */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  /**
   * 鼠标是否停在顶部栏上。
   * 用 JS 状态而不是纯 CSS :hover —— 收起后只剩一条 6px 的线，
   * 纯 :hover 撑不开（CSS 没法在 hover 时把父元素从 6px 变回 40px
   * 再让子元素重新布局）。这里用 onMouseEnter/Leave 明确控制。
   */
  const [hovered, setHovered] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  // 展开条件：锁定，或鼠标在上面，或正在重命名/开右键菜单
  // （后两种必须保持展开，否则输入框会被缩没）
  const expanded = locked || hovered || editingId !== null || menu !== null

  useEffect(() => {
    if (editingId && barRef.current) {
      const input = barRef.current.querySelector<HTMLInputElement>('.ws-tab-input')
      input?.focus()
      input?.select()
    }
  }, [editingId])

  // 右键菜单点外部关闭
  useEffect(() => {
    if (!menu) return
    const onDown = () => setMenu(null)
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menu])

  const startRename = (id: string, name: string) => {
    setEditingId(id)
    setDraft(name)
  }

  const commitRename = () => {
    if (editingId) renameWorkspace(editingId, draft)
    setEditingId(null)
  }

  return (
    <div
      ref={barRef}
      className={`ws-bar${expanded ? ' expanded' : ''}${locked ? ' locked' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={expanded ? undefined : '鼠标移上来展开工作台选择'}
    >
      {/* 收起态的细线：视觉提示「这里有东西，可以拉下来」 */}
      <div className="ws-line" aria-hidden="true" />

      <div className="ws-inner">
        <div className="ws-tabs">
          {workspaces.map((w) => {
            const active = w.id === activeWorkspace
            const editing = editingId === w.id
            return (
              <div
                key={w.id}
                className={`ws-tab${active ? ' on' : ''}${editing ? ' editing' : ''}`}
                onClick={() => { if (!editing) switchWorkspace(w.id) }}
                onDoubleClick={() => startRename(w.id, w.name)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ id: w.id, x: e.clientX, y: e.clientY })
                }}
                title={editing ? '回车确认 · Esc 取消' : `${w.name}（双击重命名 · 右键更多）`}
              >
                {editing ? (
                  <input
                    className="ws-tab-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      else if (e.key === 'Escape') setEditingId(null)
                      // 别让输入框里的按键冒泡到全局快捷键
                      e.stopPropagation()
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="ws-tab-name">{w.name}</span>
                    {/* 默认工作台标记：实心星，点它即设为默认 */}
                    <button
                      className={`ws-tab-star${active ? ' on' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setDefaultWorkspace(w.id) }}
                      title={active ? '当前为默认工作台（下次打开进入这个）' : '设为默认工作台'}
                    >
                      {active ? <IconStar size={11} /> : <IconStarOutline size={11} />}
                    </button>
                    {workspaces.length > 1 && (
                      <button
                        className="ws-tab-close"
                        onClick={(e) => { e.stopPropagation(); removeWorkspace(w.id) }}
                        title="关闭这个工作台"
                      >
                        <IconClose size={11} />
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}

          <button
            className="ws-add"
            onClick={() => addWorkspace()}
            title="新建工作台（一张空桌面，从插件坞添加插件）"
          >
            <IconPlus size={13} />
          </button>
        </div>

        <span style={{ flex: 1 }} />

        {/* 锁定：锁定后不再自动缩入，方便频繁切换工作台 */}
        <button
          className={`ws-lock${locked ? ' on' : ''}`}
          onClick={() => setTopbarMode(locked ? 'auto' : 'locked')}
          title={locked ? '已锁定（一直展开）· 点击改为自动缩入' : '自动缩入 · 点击锁定为一直展开'}
          aria-pressed={locked}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <rect x="5" y="10.5" width="14" height="9.5" rx="2"
              fill="none" stroke="currentColor" strokeWidth="1.9" />
            {/* 锁扣：锁上时闭合，未锁时向右敞开 */}
            {locked ? (
              <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" fill="none" stroke="currentColor" strokeWidth="1.9" />
            ) : (
              <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0" fill="none" stroke="currentColor" strokeWidth="1.9" />
            )}
          </svg>
        </button>
      </div>

      {menu && (
        <div
          className="ws-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={() => { startRename(menu.id, workspaces.find((w) => w.id === menu.id)?.name ?? ''); setMenu(null) }}>
            <IconPencil size={13} /> 重命名
          </button>
          <button onClick={() => { setDefaultWorkspace(menu.id); setMenu(null) }}>
            <IconStar size={13} /> 设为默认工作台
          </button>
          <button onClick={() => { duplicateWorkspace(menu.id); setMenu(null) }}>
            <IconDuplicate size={13} /> 复制一份
          </button>
          <div className="ws-menu-sep" />
          <button
            className="danger"
            disabled={workspaces.length <= 1}
            onClick={() => { removeWorkspace(menu.id); setMenu(null) }}
          >
            <IconClose size={13} /> 关闭工作台
          </button>
        </div>
      )}
    </div>
  )
}
