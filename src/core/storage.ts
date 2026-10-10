import type { CardSize, PluginManifest } from '../types/plugin'
import { PLUGIN_CATALOG } from './registry'

/** 用户安装某个插件后的运行时状态（持久化到 localStorage） */
export interface InstalledPlugin {
  manifest: PluginManifest
  enabled: boolean
  /** 是否显示在桌面 */
  visible: boolean
  size: CardSize
}

export interface AppSettings {
  theme: 'light' | 'dark'
  /** 全局刷新倍率（>1 降频省电，<1 提频） */
  refreshMultiplier: number
  /** 桌面网格列数 */
  desktopColumns: number
}

export interface UserProfile {
  name: string
  avatar: string
  signedInAt: number
}

const LS_KEY = 'workbench:state:v1'

interface PersistedState {
  installed: InstalledPlugin[]
  settings: AppSettings
  profile: UserProfile | null
}

export function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw) as PersistedState
  } catch { /* 损坏则重置 */ }
  // 首次启动：预装目录中 defaultVisible 的插件，开箱即用
  return {
    installed: PLUGIN_CATALOG
      .filter((m) => m.defaultVisible)
      .map((m) => ({
        manifest: m,
        enabled: true,
        visible: true,
        size: (m.defaultSize ?? 'M') as CardSize,
      })),
    settings: { theme: 'light', refreshMultiplier: 1, desktopColumns: 4 },
    profile: null,
  }
}

export function persist(state: PersistedState) {
  localStorage.setItem(LS_KEY, JSON.stringify(state))
}
