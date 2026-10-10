/**
 * ============================================================
 *  Workbench 插件协议（Plugin Protocol v1）
 *  ------------------------------------------------------------
 *  每个插件以一份 PluginManifest 描述自身能力，
 *  主框架据此决定：如何渲染、如何通信、以何频率刷新。
 *  详见 docs/PLUGIN_SPEC.md
 * ============================================================
 */

/** 插件渲染模式 */
export type RenderMode = 'iframe' | 'module'

/** 卡片尺寸（占桌面网格的列数） */
export type CardSize = 'S' | 'M' | 'L' | 'XL'

/** 刷新策略 */
export interface RefreshPolicy {
  /**
   * 刷新周期（毫秒）。特殊值：
   *  - 0     ：手动刷新（仅用户点击刷新按钮时触发）
   *  - -1    ：永不刷新（静态插件）
   */
  intervalMs: number
  /** 页面不可见时是否暂停调度（默认 true） */
  pauseWhenHidden?: boolean
}

/** 插件声明所需的宿主能力（最小权限原则） */
export interface PluginPermissions {
  /** 读取用户基础资料（昵称/头像） */
  readProfile?: boolean
  /** 读写本地 KV 存储（命名空间隔离） */
  storage?: boolean
  /** 打开外部链接 */
  openUrl?: boolean
  /** 发送桌面通知 */
  notify?: boolean
}

/** 插件清单 —— 插件与宿主之间的唯一契约 */
export interface PluginManifest {
  /** 全局唯一 id，建议反向域名格式，如 com.example.clock */
  id: string
  name: string
  version: string
  description: string
  author?: string
  icon: string // emoji 或单字符
  category: 'tool' | 'data' | 'info' | 'fun' | 'other'
  /** 渲染模式：iframe=沙箱隔离；module=同进程动态 import */
  renderMode: RenderMode
  /**
   * 入口：
   *  - iframe 模式：插件的 HTML 页面 URL
   *  - module 模式：导出插件工厂的 ES Module URL
   */
  entry: string
  refresh: RefreshPolicy
  permissions?: PluginPermissions
  /** 默认卡片尺寸 */
  defaultSize?: CardSize
  /** 桌面默认是否可见（false 则仅出现在插件页，用户自行添加） */
  defaultVisible?: boolean
}

/* ---------------- Module 插件运行时接口 ---------------- */

/** 宿主注入给插件的上下文 */
export interface PluginContext {
  manifest: PluginManifest
  /** 命名空间化的本地 KV（需声明 permissions.storage） */
  storage: {
    get<T = unknown>(key: string): T | null
    set(key: string, value: unknown): void
  }
  /** 当前主题 */
  getTheme(): 'light' | 'dark'
  /** 请求宿主打开链接（需声明 permissions.openUrl） */
  openUrl(url: string): void
  /** 用户资料（需声明 permissions.readProfile） */
  getProfile(): { name: string; avatar: string } | null
  /** 发送通知（需声明 permissions.notify） */
  notify(title: string, body: string): void
}

/** module 插件必须导出的工厂函数签名 */
export interface PluginFactory {
  (ctx: PluginContext): PluginInstance
}

/** module 插件实例生命周期 */
export interface PluginInstance {
  /** 挂载到卡片容器。必须在此完成 DOM 渲染 */
  mount(container: HTMLElement): void
  /** 卸载。必须清理定时器/监听器/DOM */
  unmount(): void
  /** 每次调度 tick 到达时回调（频率 = manifest.refresh.intervalMs） */
  onTick?(): void
  /** 主题切换回调 */
  onThemeChange?(theme: 'light' | 'dark'): void
  /** 卡片尺寸变化回调（容器已重排，插件可自适应） */
  onResize?(width: number, height: number): void
}

/* ---------------- iframe 插件 postMessage 协议 ---------------- */

/** 宿主 → 插件 */
export type HostMessage =
  | { type: 'workbench:init'; payload: { theme: 'light' | 'dark'; locale: string; width: number } }
  | { type: 'workbench:tick'; payload: { ts: number } }
  | { type: 'workbench:theme'; payload: { theme: 'light' | 'dark' } }
  | { type: 'workbench:resize'; payload: { width: number; height: number } }

/** 插件 → 宿主 */
export type PluginMessage =
  | { type: 'plugin:ready'; payload: { id: string } }
  | { type: 'plugin:resize'; payload: { height: number } }
  | { type: 'plugin:openUrl'; payload: { url: string } }
  | { type: 'plugin:storage'; payload: { action: 'get' | 'set'; key: string; value?: unknown } }
  | { type: 'plugin:profile'; payload: null }
  | { type: 'plugin:notify'; payload: { title: string; body: string } }
