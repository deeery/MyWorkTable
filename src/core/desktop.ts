/**
 * 桌面壳桥接（Electron）
 * ------------------------------------------------------------
 * 前端通过 window.workbenchDesktop 与桌面壳通信；在浏览器中运行时该对象不存在，
 * 所有调用都会安全降级为 no-op，因此同一份代码可同时跑在浏览器与桌面壳里。
 *
 * 暴露的能力（见 desktop/preload.cjs）：
 *   showContextMenu(payload)  弹出原生右键菜单
 *   onCommand(handler)        订阅菜单命令
 */

export type ContextMenuKind = 'card' | 'blank' | 'text'

/** 卡片右键菜单所需的上下文（供主进程渲染菜单文案/可用性） */
export interface CardMenuData {
  id: string
  name: string
  canRefresh: boolean
  visible: boolean
  enabled: boolean
}

export interface ContextMenuPayload {
  kind: ContextMenuKind
  data?: CardMenuData | Record<string, unknown>
}

/**
 * 主进程下发的菜单命令。
 *
 * ⚠ `id` 是**窗口 id**（卡片右键菜单用窗口 id 发的），不是插件 id。
 * 多窗口之后这一点很关键 —— 用插件 id 会命中同一插件的第一个窗口。
 * 与窗口无关的命令（open-add / reset-view / zoom-*）不带 id。
 */
export type DesktopCommand =
  | { type: 'refresh'; id: string }
  | { type: 'settings'; id: string }
  | { type: 'focus'; id: string }
  | { type: 'reset-size'; id: string }
  | { type: 'toggle-visible'; id: string }
  | { type: 'toggle-enabled'; id: string }
  | { type: 'uninstall'; id: string }
  | { type: 'open-add' }
  | { type: 'reset-view' }
  | { type: 'zoom-in' }
  | { type: 'zoom-out' }
  | { type: 'win-max-changed'; maximized: boolean }

/** 带 id 的卡片级命令（用于收窄联合类型） */
export type CardCommand = Extract<DesktopCommand, { id: string }>

/** 自绘标题栏能驱动的窗口动作（与 preload 的白名单一致） */
export type WindowAction = 'minimize' | 'toggle-maximize' | 'close'

export interface WindowState {
  maximized: boolean
  fullScreen: boolean
}

interface DesktopBridge {
  isDesktop: true
  platform: string
  showContextMenu(payload: ContextMenuPayload): Promise<boolean>
  onCommand(handler: (cmd: DesktopCommand) => void): () => void
  /** 扫描系统安装的应用（返回 { ok, apps }） */
  scanApps(): Promise<{ ok: boolean; apps?: HostApp[]; err?: string }>
  /** 启动一个应用（target 可为命令名 / URL / 路径 / .lnk） */
  launchApp(target: string): Promise<{ ok: boolean; err?: string }>
  /** 窗口控制（最小化 / 最大化切换 / 关闭） */
  winControl(action: WindowAction): Promise<{ ok: boolean; maximized?: boolean; fullScreen?: boolean }>
  /** 读一次窗口状态 */
  winState(): Promise<WindowState>
}

/** 宿主下发的应用条目（供快捷启动器渲染） */
export interface HostApp {
  id: string
  /** 应用名 */
  n: string
  /** 图标（emoji） */
  ic: string
  /** 分类 */
  c: string
  /** 主色 */
  col: string
  /** 拼音首字母（搜索用） */
  py: string
  /** 启动目标 */
  target: string
}

declare global {
  interface Window {
    workbenchDesktop?: DesktopBridge
  }
}

/** 是否运行在桌面壳中 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.workbenchDesktop?.isDesktop
}

/** 弹出原生右键菜单；浏览器环境下返回 false（调用方可自行降级） */
export function showContextMenu(payload: ContextMenuPayload): boolean {
  const api = window.workbenchDesktop
  if (!api) return false
  void api.showContextMenu(payload)
  return true
}

/**
 * 扫描系统安装的应用。
 * 浏览器环境下返回 null，由调用方决定怎么降级（快捷启动器会退回内置清单）。
 */
export async function scanHostApps(): Promise<HostApp[] | null> {
  const api = window.workbenchDesktop
  if (!api) return null
  try {
    const r = await api.scanApps()
    return r.ok ? (r.apps ?? []) : null
  } catch { return null }
}

/** 启动一个应用。返回是否真的交出去了（浏览器环境下为 false） */
export async function launchHostApp(target: string): Promise<{ ok: boolean; err?: string }> {
  const api = window.workbenchDesktop
  if (!api) return { ok: false, err: 'not-desktop' }
  try { return await api.launchApp(target) } catch (e) { return { ok: false, err: String(e) } }
}

/**
 * 订阅桌面壳的菜单命令。
 * 返回取消订阅函数；在浏览器环境下返回一个 no-op。
 */
export function onDesktopCommand(handler: (cmd: DesktopCommand) => void): () => void {
  const api = window.workbenchDesktop
  if (!api) return () => {}
  return api.onCommand(handler)
}

/**
 * 驱动真实窗口（自绘标题栏用）。
 * 浏览器环境下返回 null —— 调用方据此隐藏标题栏（见 TitleBar.tsx）。
 */
export async function windowControl(action: WindowAction): Promise<WindowState | null> {
  const api = window.workbenchDesktop
  if (!api?.winControl) return null
  try {
    const r = await api.winControl(action)
    return { maximized: !!r.maximized, fullScreen: !!r.fullScreen }
  } catch { return null }
}

/** 读一次窗口状态；浏览器环境下返回 null */
export async function windowState(): Promise<WindowState | null> {
  const api = window.workbenchDesktop
  if (!api?.winState) return null
  try { return await api.winState() } catch { return null }
}
