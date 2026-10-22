import { useState } from 'react'
import { useApp } from '../state/AppContext'
import type { PageKey } from '../App'

/** 我的：账号信息与登录/登出（演示用本地 Mock） */
export function Profile({ onNavigate }: { onNavigate: (p: PageKey) => void }) {
  const { profile, login, logout, installed } = useApp()
  const [name, setName] = useState('')

  const enabledCount = installed.filter((p) => p.enabled).length

  return (
    <>
      <div className="panel">
        {profile ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%', fontSize: 22, fontWeight: 700, color: '#fff',
                background: 'linear-gradient(135deg, #37d0a4, #2ea86f)', display: 'grid', placeItems: 'center',
              }}>{profile.avatar}</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{profile.name}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
                  登录于 {new Date(profile.signedInAt).toLocaleString('zh-CN')}
                </div>
              </div>
            </div>
            <button className="btn danger" onClick={logout}>退出登录</button>
          </>
        ) : (
          <>
            <h3>登录</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text" placeholder="输入昵称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && name.trim() && login(name.trim())}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg)', outline: 'none',
                }}
              />
              <button className="btn primary" disabled={!name.trim()} onClick={() => login(name.trim())}>登录</button>
            </div>
            <div className="hint" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10 }}>
              游客模式下插件仍可使用，但无账号同步能力。
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h3>本地数据概览</h3>
        <div className="setting-row">
          <span className="label">已安装插件</span><span className="badge">{installed.length} 个</span>
        </div>
        <div className="setting-row">
          <span className="label">启用中</span><span className="badge on">{enabledCount} 个</span>
        </div>
        <div className="setting-row">
          <span className="label">存储位置</span><span className="badge">localStorage · workbench:state:v1</span>
        </div>
      </div>

      <div className="panel">
        <h3>快速跳转</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn small" onClick={() => onNavigate('desktop')}>前往桌面</button>
          <button className="btn small" onClick={() => onNavigate('plugins')}>管理插件</button>
          <button className="btn small" onClick={() => onNavigate('settings')}>调整设置</button>
        </div>
      </div>
    </>
  )
}
