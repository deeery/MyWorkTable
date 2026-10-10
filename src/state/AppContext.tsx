import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { CardSize, PluginManifest } from '../types/plugin'
import type { AppSettings, InstalledPlugin, UserProfile } from '../core/storage'
import { loadPersisted, persist } from '../core/storage'
import { scheduler } from '../core/scheduler'

interface AppContextValue {
  settings: AppSettings
  installed: InstalledPlugin[]
  profile: UserProfile | null
  // 插件管理
  install: (m: PluginManifest) => void
  uninstall: (id: string) => void
  setEnabled: (id: string, on: boolean) => void
  setVisible: (id: string, on: boolean) => void
  setSize: (id: string, size: CardSize) => void
  reorder: (fromId: string, toId: string) => void
  // 设置
  setTheme: (t: AppSettings['theme']) => void
  setRefreshMultiplier: (m: number) => void
  setDesktopColumns: (n: number) => void
  // 账号
  login: (name: string) => void
  logout: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(loadPersisted, [])
  const [settings, setSettings] = useState<AppSettings>(initial.settings)
  const [installed, setInstalled] = useState<InstalledPlugin[]>(initial.installed)
  const [profile, setProfile] = useState<UserProfile | null>(initial.profile)

  // 持久化
  useEffect(() => persist({ installed, settings, profile }), [installed, settings, profile])

  // 全局刷新倍率接入调度器
  useEffect(() => scheduler.setMultiplier(settings.refreshMultiplier), [settings.refreshMultiplier])

  // 主题 class
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  const value: AppContextValue = {
    settings,
    installed,
    profile,
    install: (m) =>
      setInstalled((list) =>
        list.some((p) => p.manifest.id === m.id)
          ? list
          : [...list, { manifest: m, enabled: true, visible: !!m.defaultVisible, size: m.defaultSize ?? 'M' }],
      ),
    uninstall: (id) => setInstalled((l) => l.filter((p) => p.manifest.id !== id)),
    setEnabled: (id, on) => setInstalled((l) => l.map((p) => (p.manifest.id === id ? { ...p, enabled: on } : p))),
    setVisible: (id, on) => setInstalled((l) => l.map((p) => (p.manifest.id === id ? { ...p, visible: on } : p))),
    setSize: (id, size) => setInstalled((l) => l.map((p) => (p.manifest.id === id ? { ...p, size } : p))),
    reorder: (fromId, toId) =>
      setInstalled((l) => {
        const from = l.findIndex((p) => p.manifest.id === fromId)
        const to = l.findIndex((p) => p.manifest.id === toId)
        if (from < 0 || to < 0 || from === to) return l
        const copy = [...l]
        const [moved] = copy.splice(from, 1)
        copy.splice(to, 0, moved)
        return copy
      }),
    setTheme: (t) => setSettings((s) => ({ ...s, theme: t })),
    setRefreshMultiplier: (m) => setSettings((s) => ({ ...s, refreshMultiplier: m })),
    setDesktopColumns: (n) => setSettings((s) => ({ ...s, desktopColumns: n })),
    login: (name) => setProfile({ name, avatar: name.slice(0, 1).toUpperCase(), signedInAt: Date.now() }),
    logout: () => setProfile(null),
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用')
  return ctx
}
