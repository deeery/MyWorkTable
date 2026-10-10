import type { PageKey } from '../App'
import { useApp } from '../state/AppContext'

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

export function Sidebar({ page, onNavigate }: { page: PageKey; onNavigate: (p: PageKey) => void }) {
  const { profile } = useApp()
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="logo">🧩</div>
        <div>
          Workbench
          <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--sidebar-fg)' }}>插件式工作台 v0.1</div>
        </div>
      </div>

      <nav>
        {NAV.map((item) => (
          <div
            key={item.key}
            className={`nav-item${page === item.key ? ' active' : ''}`}
            onClick={() => onNavigate(item.key)}
          >
            {ICONS[item.key]}
            {item.label}
          </div>
        ))}
      </nav>

      {/* 左下角登录状态 */}
      <div className="sidebar-footer">
        <div className="login-status" onClick={() => onNavigate('profile')} title="点击管理账号">
          <div className={`avatar${profile ? '' : ' guest'}`}>{profile ? profile.avatar : '访'}</div>
          <div className="meta">
            <div className="name">{profile ? profile.name : '未登录'}</div>
            <div className="sub">
              <span className={`dot ${profile ? 'on' : 'off'}`} />
              {profile ? '已登录' : '游客模式'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
