import type { PageKey } from '../App'
import { useApp } from '../state/AppContext'
import type { SidebarMode } from '../core/storage'

const ICONS: Record<PageKey, JSX.Element> = {
  desktop: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>
  ),
  plugins: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4" /><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3.2" /><path d="M19 12a7 7 0 0 0-.14-1.4l2.1-1.63-2-3.46-2.48 1a7 7 0 0 0-2.42-1.4L13.6 2.5h-4l-.46 2.6a7 7 0 0 0-2.42 1.4l-2.48-1-2 3.46 2.1 1.64A7 7 0 0 0 5 12c0 .48.05.94.14 1.4l-2.1 1.63 2 3.46 2.48-1a7 7 0 0 0 2.42 1.4l.46 2.61h4l.46-2.6a7 7 0 0 0 2.42-1.4l2.48 1 2-3.47-2.1-1.64c.09-.46.14-.92.14-1.4Z" /></svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></svg>
  ),
}

const NAV: Array<{ key: PageKey; label: string }> = [
  { key: 'desktop', label: '桌面' },
  { key: 'plugins', label: '插件' },
  { key: 'settings', label: '设置' },
  { key: 'profile', label: '我的' },
]

/** 侧边栏形态循环顺序 */
const MODE_CYCLE: SidebarMode[] = ['detailed', 'mini', 'hidden']

const MODE_LABEL: Record<SidebarMode, string> = {
  detailed: '详细',
  mini: '迷你',
  hidden: '隐藏',
}

/** 按「详细 → 迷你 → 隐藏 → 详细」循环切换侧边栏形态 */
function useSidebarCycle() {
  const { settings, setSidebarMode } = useApp()
  const mode = settings.sidebarMode
  const cycle = () => {
    const i = MODE_CYCLE.indexOf(mode)
    setSidebarMode(MODE_CYCLE[(i + 1) % MODE_CYCLE.length])
  }
  return { mode, cycle }
}

/**
 * 侧边栏形态切换按钮。
 *
 * 图形为「一个矩形，左侧有一条分隔线，线右区域填实」—— 直观表达
 * 「左侧栏 + 主区域」的结构；三种形态用右侧主区域的大小与左侧栏的显隐来区分：
 *   - 详细：整块填实
 *   - 迷你：只填左侧窄条
 *   - 隐藏：只描边、内部留空
 *
 * 该按钮在任何形态下都保持可见（隐藏侧边栏时它仍在原位），否则无法恢复。
 *
 * 注：这里原本还有一个「隐藏顶部栏」按钮，现已移除 ——
 * 顶部栏改成「鼠标离开自动缩成一条细线」后，整条隐藏既无必要，
 * 又会和自动缩入互相打架。顶部栏自己的锁定开关接管了这件事。
 */
function SidebarToggle({ mode, onCycle }: { mode: SidebarMode; onCycle: () => void }) {
  const next = MODE_CYCLE[(MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length]
  return (
    <button
      className="sidebar-toggle"
      onClick={onCycle}
      title={`侧边栏：${MODE_LABEL[mode]}（点击切换为「${MODE_LABEL[next]}」）`}
      aria-label={`侧边栏形态：${MODE_LABEL[mode]}，点击切换`}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        {/* 外框 */}
        <rect
          x="3" y="4" width="18" height="16" rx="2.5"
          fill="none" stroke="currentColor" strokeWidth="1.8"
        />
        {/* 左侧栏分隔线 */}
        <line
          x1="9.5" y1="4" x2="9.5" y2="20"
          stroke="currentColor" strokeWidth="1.8"
        />
        {/* 主区域填充：详细=填满、迷你=仅左栏、隐藏=留空 */}
        {mode === 'detailed' && (
          <rect x="10.4" y="5.2" width="9.2" height="13.6" rx="1.2" fill="currentColor" opacity="0.85" />
        )}
        {mode === 'mini' && (
          <rect x="4.4" y="5.2" width="4.2" height="13.6" rx="1.2" fill="currentColor" opacity="0.85" />
        )}
      </svg>
    </button>
  )
}

export function Sidebar({ page, onNavigate }: { page: PageKey; onNavigate: (p: PageKey) => void }) {
  const { profile } = useApp()
  const { mode, cycle } = useSidebarCycle()

  // 隐藏形态：整个侧边栏收起，但切换按钮保留在标题栏上方（见 SidebarRestore）
  if (mode === 'hidden') return null

  return (
    <aside className={`sidebar${mode === 'mini' ? ' mini' : ''}`}>
      {/* 标题栏上方：侧边栏形态切换按钮 */}
      <div className="sidebar-top">
        <SidebarToggle mode={mode} onCycle={cycle} />
      </div>

      <div className="sidebar-brand">
        <div className="logo">🧩</div>
        {mode === 'detailed' && (
          <div>
            Workbench
            <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--sidebar-fg)' }}>插件式工作台 v0.1</div>
          </div>
        )}
      </div>

      <nav>
        {NAV.map((item) => (
          <div
            key={item.key}
            className={`nav-item${page === item.key ? ' active' : ''}`}
            onClick={() => onNavigate(item.key)}
            title={mode === 'mini' ? item.label : undefined}
          >
            {ICONS[item.key]}
            {mode === 'detailed' && item.label}
          </div>
        ))}
      </nav>

      {/* 左下角登录状态 */}
      <div className="sidebar-footer">
        <div className="login-status" onClick={() => onNavigate('profile')} title="点击管理账号">
          <div className={`avatar${profile ? '' : ' guest'}`}>{profile ? profile.avatar : '访'}</div>
          {mode === 'detailed' && (
            <div className="meta">
              <div className="name">{profile ? profile.name : '未登录'}</div>
              <div className="sub">
                <span className={`dot ${profile ? 'on' : 'off'}`} />
                {profile ? '已登录' : '游客模式'}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

/**
 * 侧边栏隐藏时，仍需把切换按钮留在界面上（否则无法恢复）。
 * 由 App 渲染在标题栏上方、左上角。
 */
export function SidebarRestore() {
  const { mode, cycle } = useSidebarCycle()
  if (mode !== 'hidden') return null
  return (
    <div className="sidebar-restore">
      <SidebarToggle mode={mode} onCycle={cycle} />
    </div>
  )
}
