import type { CardSize, PluginManifest } from '../types/plugin'
import { PLUGIN_CATALOG } from './registry'
import type { OccupiedBox } from './layout'
import { cardSize, findFreePosition, occupiedBoxOf } from './layout'

/** 用户安装某个插件后的**全局**状态（与工作台无关，持久化到 localStorage） */
export interface InstalledPlugin {
  manifest: PluginManifest
  enabled: boolean
}

/**
 * 一个窗口实例（桌面上的一张卡片）。
 *
 * ⚠ 这是「多窗口」改造的核心：以前 Workspace.slots 的键是**插件 id**，
 * 于是一个插件在一个工作台里天然只能有一个 slot（想开第二个就被覆盖）。
 * 现在改成窗口实例数组，同一个插件可以出现多次，各自独立的
 * 位置 / 尺寸 / 可见性 / 配置。
 *
 * 位置与尺寸（SlotLayout）内联在这里，不再单独一层 —— 它们本来就是
 * 「属于某个窗口」的属性，绑在一起才不会有「窗口没了 slot 还在」的悬空数据。
 */
export interface WindowInstance extends SlotLayout {
  /** 窗口实例 id（唯一）。一切「针对这张卡片」的操作都用它做键 */
  id: string
  /** 这个窗口显示的是哪个插件 */
  pluginId: string
  /**
   * 该窗口自己的配置（齿轮设置面板写入）。
   *
   * 每个窗口独立：最典型的用法就是「两个世界时钟看不同时区」
   * 「两个倒计时盯不同的事」。若共享配置，两个窗口长得一模一样，
   * 多开就没有意义了。
   */
  config?: Record<string, string>
}

/**
 * 一个插件在某个工作台里的布局。
 *
 * 与 InstalledPlugin 分开存的原因：工作台是「布局快照」，
 * 同一批已安装插件在不同工作台里可以摆在不同位置、显示不同的子集。
 * 「装没装」「启用没启用」是全局的，「摆在哪儿」是工作台自己的。
 */
export interface SlotLayout {
  /** 是否显示在该工作台的桌面上 */
  visible: boolean
  size: CardSize
  /** 桌面绝对定位坐标（自由拖拽模式） */
  x?: number
  y?: number
  /** 自由缩放后的实际像素尺寸（拖拽右下角设定） */
  w?: number
  h?: number
  /** 顶部栏是否收起（收起后仅保留右上角的 ↑ 恢复按钮） */
  collapsed?: boolean
}

/**
 * 工作台：一份插件布局快照。
 *
 * 像浏览器标签页一样可以新建 / 关闭 / 重命名，其中一个可以设为默认
 * （下次打开应用时进入的那个）。
 */
export interface Workspace {
  id: string
  name: string
  /** 该工作台上的全部窗口（有序；同一插件可以出现多次） */
  windows: WindowInstance[]
}

/** 新窗口在某工作台里的初始布局 */
export function defaultSlot(size: CardSize, visible: boolean): SlotLayout {
  return { visible, size }
}

/**
 * 合并视图：窗口布局 + 所属插件的全局信息。
 *
 * 组件（PluginCard / Desktop）消费的就是这个类型。
 * 注意 `id` 是**窗口实例 id**（不是插件 id）—— 卡片的位置、尺寸、
 * 可见性、收起、配置全都以它为准，这样同一插件的多个窗口才能各自独立。
 * 需要插件级信息时用 `pluginId` 或 `manifest.id`（两者恒等）。
 */
export interface PluginView extends SlotLayout {
  /** 窗口实例 id */
  id: string
  /** 所属插件 id */
  pluginId: string
  manifest: PluginManifest
  /** 插件是否启用（全局，同一插件的所有窗口共享） */
  enabled: boolean
  /** 该窗口自己的配置 */
  config?: Record<string, string>
}

/** 侧边栏显示形态 */
export type SidebarMode = 'detailed' | 'mini' | 'hidden'

/**
 * 顶部栏（工作台选择条）的收起策略。
 *
 * 顶部栏现在只有一个作用：选工作台。它平时不该占地方，
 * 所以鼠标离开就自动缩成一条细线，靠近再展开。
 * 用户也可以「锁定」让它一直保持展开 —— 频繁切换工作台时更方便。
 */
export type TopbarMode = 'auto' | 'locked'

/** 背景样式 id */
export type BackgroundId = 'plain' | 'dots' | 'grid' | 'mesh' | 'image' | 'video'

export interface AppSettings {
  theme: 'light' | 'dark'
  /** 全局刷新倍率（>1 降频省电，<1 提频） */
  refreshMultiplier: number
  /** 侧边栏形态：详细（图标+文字）/ 迷你（仅图标）/ 隐藏 */
  sidebarMode: SidebarMode
  /**
   * 界面显示比例（0.5 ~ 2）。以 CSS zoom 施加在根元素上，
   * 浏览器与 Electron 桌面壳通用；卡片描边宽度也会随之补偿。
   */
  displayScale: number
  /** 顶部栏收起策略：auto（鼠标离开自动缩成细线）/ locked（锁定常展开） */
  topbarMode: TopbarMode
  /** 背景样式 */
  background: BackgroundId
  /** 自定义背景图（data URL 或 http(s) URL）；background 为 'image' 时生效 */
  bgImage?: string
  /** 自定义背景视频（URL）；background 为 'video' 时生效 */
  bgVideo?: string
}

/** 显示比例允许范围 */
export const MIN_DISPLAY_SCALE = 0.5
export const MAX_DISPLAY_SCALE = 2

export interface UserProfile {
  name: string
  avatar: string
  signedInAt: number
}

const LS_KEY = 'workbench:state:v1'

interface PersistedState {
  installed: InstalledPlugin[]
  workspaces: Workspace[]
  /** 当前工作台 id */
  activeWorkspace: string
  settings: AppSettings
  profile: UserProfile | null
}

/**
 * 为缺失坐标的窗口补齐位置。
 *
 * 必须按顺序逐个累加 occupied：早期实现在 map 内部调用 defaultPosition，
 * 读到的始终是「尚未补齐」的原数组，且未落位的窗口本就被排除在 occupied
 * 之外，结果多个窗口会被分配到完全相同的坐标而重叠。
 */
export function placeMissing(list: PluginView[]): { list: PluginView[]; changed: boolean } {
  const result = list.map((p) => ({ ...p }))
  const occupied: OccupiedBox[] = []
  for (const p of result) {
    const box = occupiedBoxOf(p)
    if (box) occupied.push(box)
  }

  let changed = false
  for (const p of result) {
    if (!p.visible || (p.x != null && p.y != null)) continue
    const { w, h } = cardSize(p.size, p.w, p.h)
    const pos = findFreePosition(occupied, w, h)
    p.x = pos.x
    p.y = pos.y
    occupied.push({ x: pos.x, y: pos.y, w, h })
    changed = true
  }
  return { list: result, changed }
}

const DEFAULT_SETTINGS: AppSettings = {
  // 深色是默认：本产品定位是开发者工具 / 桌面工作台，深色是主场。
  // 设计令牌见 src/styles/global.css 顶部（:root 即深色，[data-theme='light'] 覆盖）。
  theme: 'dark',
  refreshMultiplier: 1,
  sidebarMode: 'detailed',
  displayScale: 1,
  // 默认锁定（一直展开）：顶部栏只做工作台选择，展开态才看得出有几个
  // 工作台、当前在哪个。自动缩入虽省空间，但新用户一进来只看到一条细线，
  // 不知道那里能点。想省空间的用户自己去解锁即可。
  topbarMode: 'locked',
  background: 'plain',
}

/** 背景样式清单（设置页的背景选择器据此渲染） */
export const BACKGROUNDS: Array<{ id: BackgroundId; name: string; desc: string }> = [
  { id: 'plain', name: '纯色', desc: '跟随主题的纯净底色，最省资源' },
  { id: 'dots', name: '点阵', desc: '细点网格，有质感又不抢内容' },
  { id: 'grid', name: '网格', desc: '淡格线，像一张无限大的坐标纸' },
  { id: 'mesh', name: '光晕', desc: '两团柔和色块，氛围感最强' },
  { id: 'image', name: '自定义图片', desc: '选一张本地图片作为背景' },
  { id: 'video', name: '自定义视频', desc: '选一段视频作为动态背景' },
]

/** 生成一个短 id（工作台标识，不要求全局唯一性，本地够用） */
export function newId(prefix = 'ws'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** 默认工作台的名字（新建时自动编号用） */
export function nextWorkspaceName(list: Workspace[]): string {
  for (let i = 1; i < 999; i++) {
    const name = i === 1 ? '默认工作台' : `工作台 ${i}`
    if (!list.some((w) => w.name === name)) return name
  }
  return '工作台'
}

/**
 * 把持久化里可能缺失/损坏的工作台补全成新的「窗口数组」结构。
 *
 * 兼容三种历史形态（按新旧排序，全部归一到 windows 数组）：
 *   1. 最新：workspace.windows = WindowInstance[]
 *   2. 中间：workspace.slots = Record<插件id, SlotLayout>
 *   3. 最旧：没有 workspaces，installed 里连布局一起放（由 migrateFlat 处理）
 *
 * 第 2 种是「一个插件只能一个窗口」时代的产物。迁移时每个 slot 变成一个
 * 窗口实例，插件 id 保留在 pluginId 上，用户看到的桌面与升级前完全一致。
 */
function normalizeWorkspaces(raw: unknown, installed: InstalledPlugin[]): Workspace[] {
  const list = Array.isArray(raw) ? (raw as Array<Partial<Workspace> & { slots?: Record<string, Partial<SlotLayout>> }>) : []
  const known = new Set(installed.map((p) => p.manifest.id))
  const defaultSizeOf = (pluginId: string): CardSize => {
    const p = installed.find((x) => x.manifest.id === pluginId)
    return (p?.manifest.defaultSize ?? 'M') as CardSize
  }

  const out: Workspace[] = []
  for (const w of list) {
    if (!w || typeof w.id !== 'string') continue
    const windows: WindowInstance[] = []

    if (Array.isArray(w.windows)) {
      // 形态 1：已是窗口数组
      for (const raw2 of w.windows as Partial<WindowInstance>[]) {
        if (!raw2 || typeof raw2.pluginId !== 'string') continue
        // 插件已卸载的窗口直接丢掉，否则会渲染出一张没有内容的空卡
        if (!known.has(raw2.pluginId)) continue
        windows.push({
          id: typeof raw2.id === 'string' && raw2.id ? raw2.id : newId('win'),
          pluginId: raw2.pluginId,
          visible: !!raw2.visible,
          size: (raw2.size ?? defaultSizeOf(raw2.pluginId)) as CardSize,
          ...(typeof raw2.x === 'number' ? { x: raw2.x } : {}),
          ...(typeof raw2.y === 'number' ? { y: raw2.y } : {}),
          ...(typeof raw2.w === 'number' ? { w: raw2.w } : {}),
          ...(typeof raw2.h === 'number' ? { h: raw2.h } : {}),
          ...(raw2.collapsed ? { collapsed: true } : {}),
          ...(raw2.config && typeof raw2.config === 'object' ? { config: raw2.config } : {}),
        })
      }
    } else if (w.slots && typeof w.slots === 'object') {
      // 形态 2：Record<插件id, SlotLayout> → 每个 slot 一个窗口
      for (const p of installed) {
        const s = (w.slots as Record<string, Partial<SlotLayout>>)[p.manifest.id]
        if (!s) continue
        windows.push({
          id: newId('win'),
          pluginId: p.manifest.id,
          visible: !!s.visible,
          size: (s.size ?? p.manifest.defaultSize ?? 'M') as CardSize,
          ...(typeof s.x === 'number' ? { x: s.x } : {}),
          ...(typeof s.y === 'number' ? { y: s.y } : {}),
          ...(typeof s.w === 'number' ? { w: s.w } : {}),
          ...(typeof s.h === 'number' ? { h: s.h } : {}),
          ...(s.collapsed ? { collapsed: true } : {}),
        })
      }
    }

    out.push({
      id: w.id,
      name: typeof w.name === 'string' && w.name.trim() ? w.name : '工作台',
      windows,
    })
  }
  return out
}

/**
 * 补齐/校正从 localStorage 读回的设置，避免旧版本或损坏数据导致字段缺失
 */
function normalizeSettings(raw: unknown): AppSettings {
  const s = (raw ?? {}) as Partial<AppSettings>
  const m = Number(s.refreshMultiplier)
  const mode = s.sidebarMode
  const scale = Number(s.displayScale)
  const bg = s.background
  const bgOk = (v: unknown): v is BackgroundId =>
    v === 'plain' || v === 'dots' || v === 'grid' || v === 'mesh' || v === 'image' || v === 'video'
  return {
    theme: s.theme === 'dark' ? 'dark' : 'light',
    refreshMultiplier: Number.isFinite(m) && m > 0 ? m : DEFAULT_SETTINGS.refreshMultiplier,
    sidebarMode: mode === 'mini' || mode === 'hidden' || mode === 'detailed' ? mode : DEFAULT_SETTINGS.sidebarMode,
    displayScale: Number.isFinite(scale)
      ? Math.min(MAX_DISPLAY_SCALE, Math.max(MIN_DISPLAY_SCALE, scale))
      : DEFAULT_SETTINGS.displayScale,
    /**
     * 顶部栏收起策略。
     *
     * 历史上这个字段的语义换过两次：
     *   visible / hidden  → 整条显示 / 整条不显示
     *   auto / locked     → 鼠标离开缩成细线 / 一直展开
     *
     * 默认值现在是 locked。旧数据里的 visible/hidden 都是「上一版的默认」
     * 而不是用户刻意选的（当时根本没有锁定这个概念），所以一律映射到
     * 新默认 locked —— 否则老用户升级后看到的还是细线，会觉得「没变化」。
     * 只有显式选了 auto 的才保持 auto。
     */
    topbarMode: s.topbarMode === 'auto' ? 'auto' : 'locked',
    background: bgOk(bg) ? bg : DEFAULT_SETTINGS.background,
    // 自定义图片/视频：只接受 data URL（本地文件转存）或 http(s)，
    // 其余一律丢掉，避免把 file:// 路径或脚本写进 style
    bgImage: typeof s.bgImage === 'string' && /^(data:image\/|https?:)/i.test(s.bgImage) ? s.bgImage : undefined,
    bgVideo: typeof s.bgVideo === 'string' && /^(data:video\/|https?:)/i.test(s.bgVideo) ? s.bgVideo : undefined,
  }
}

/**
 * 用当前目录中的 manifest 覆盖已持久化的副本。
 *
 * 持久化的是安装当时的 manifest 快照；若不刷新，升级后新增的能力
 * （如 settings 声明、compact 声明）对老用户不可见，会一直显示
 * 「没有可配置项」。插件的用户数据（config）不受影响。
 */
function syncManifests(list: InstalledPlugin[]): { list: InstalledPlugin[]; changed: boolean } {
  const byId = new Map(PLUGIN_CATALOG.map((m) => [m.id, m]))
  let changed = false
  const result = list.map((p) => {
    const latest = byId.get(p.manifest.id)
    if (!latest) return p
    if (JSON.stringify(latest) === JSON.stringify(p.manifest)) return p
    changed = true
    return { ...p, manifest: latest }
  })
  return { list: result, changed }
}

/**
 * 从旧的「扁平 installed」结构迁移出工作台。
 *
 * 旧结构把布局（visible/x/y/w/h/size/collapsed）和全局信息（manifest/enabled/
 * config）混在一个数组里。拆开之后，旧数据整体成为一个「默认工作台」的
 * 布局快照 —— 用户升级后看到的桌面与升级前完全一致，不会丢位置。
 *
 * 注意 config 的归属变了：旧结构里它是**插件级**的，新结构里它是
 * **窗口级**的（每个窗口独立设置）。迁移时把它挂到该插件唯一的那一个
 * 窗口上，用户原有配置不丢。
 */
function migrateFlat(flat: Array<InstalledPlugin & Partial<SlotLayout> & { config?: Record<string, string> }>): {
  installed: InstalledPlugin[]
  workspaces: Workspace[]
} {
  const installed: InstalledPlugin[] = []
  const windows: WindowInstance[] = []
  for (const p of flat) {
    const id = p.manifest.id
    installed.push({
      manifest: p.manifest,
      enabled: p.enabled !== false,
    })
    windows.push({
      id: newId('win'),
      pluginId: id,
      visible: p.visible !== false,
      size: (p.size ?? p.manifest.defaultSize ?? 'M') as CardSize,
      ...(typeof p.x === 'number' ? { x: p.x } : {}),
      ...(typeof p.y === 'number' ? { y: p.y } : {}),
      ...(typeof p.w === 'number' ? { w: p.w } : {}),
      ...(typeof p.h === 'number' ? { h: p.h } : {}),
      ...(p.collapsed ? { collapsed: true } : {}),
      ...(p.config ? { config: p.config } : {}),
    })
  }
  return {
    installed,
    workspaces: [{ id: newId(), name: '默认工作台', windows }],
  }
}

/** 全新安装时的初始状态：按 defaultVisible 建一个默认工作台 */
function freshState(): PersistedState {
  const installed: InstalledPlugin[] = []
  const windows: WindowInstance[] = []
  for (const m of PLUGIN_CATALOG.filter((x) => x.defaultVisible)) {
    installed.push({ manifest: m, enabled: true })
    windows.push({
      id: newId('win'),
      pluginId: m.id,
      ...defaultSlot((m.defaultSize ?? 'M') as CardSize, true),
    })
  }
  const ws: Workspace = { id: newId(), name: '默认工作台', windows }
  return {
    installed,
    workspaces: [ws],
    activeWorkspace: ws.id,
    settings: { ...DEFAULT_SETTINGS },
    profile: null,
  }
}

export function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState & { installed?: unknown[] }
      if (!Array.isArray(parsed.installed)) throw new Error('bad state shape')

      /**
       * 兼容两种历史结构：
       *   - 新：installed 里只有 manifest/enabled/config，另有 workspaces
       *   - 旧：installed 里连布局一起放（visible/x/y/…）
       * 用「有没有 workspaces 数组」区分，旧的走迁移。
       */
      const hasWorkspaces = Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0
      let installed: InstalledPlugin[]
      let workspaces: Workspace[]

      if (hasWorkspaces) {
        const synced = syncManifests(parsed.installed as InstalledPlugin[])
        installed = synced.list
        workspaces = normalizeWorkspaces(parsed.workspaces, installed)
      } else {
        const synced = syncManifests(parsed.installed as Array<InstalledPlugin & Partial<SlotLayout>>)
        const mig = migrateFlat(synced.list as Array<InstalledPlugin & Partial<SlotLayout>>)
        installed = mig.installed
        workspaces = mig.workspaces
      }

      if (!workspaces.length) {
        workspaces = [{ id: newId(), name: '默认工作台', windows: [] }]
      }
      // 当前工作台失效（被删掉/数据损坏）时回落到第一个
      let active = typeof parsed.activeWorkspace === 'string' ? parsed.activeWorkspace : ''
      if (!workspaces.some((w) => w.id === active)) active = workspaces[0].id

      const settings = normalizeSettings(parsed.settings)

      /**
       * 给每个工作台补上「新装插件」的默认窗口并落位。
       *
       * ⚠ 这里只给「在该工作台一个窗口都没有」的插件补一个默认窗口，
       * 且默认 visible: false（不上桌面）。原因：
       *  - 不补的话，用户新装的插件在所有老工作台里都找不到入口
       *  - 但也不能凭空出现在桌面上 —— 用户没点过「新建窗口」，
       *    突然多出一张卡片很突兀
       * 已经有窗口的插件绝不再补，否则每次加载都会多出一张卡。
       */
      let dirty = !hasWorkspaces
      for (const w of workspaces) {
        for (const p of installed) {
          const pid = p.manifest.id
          if (w.windows.some((x) => x.pluginId === pid)) continue
          w.windows.push({
            id: newId('win'),
            pluginId: pid,
            ...defaultSlot((p.manifest.defaultSize ?? 'M') as CardSize, false),
          })
          dirty = true
        }
        const views = buildViews(installed, w)
        const placed = placeMissing(views)
        if (placed.changed) {
          // 把落位结果写回对应的窗口实例
          for (const v of placed.list) {
            const target = w.windows.find((x) => x.id === v.id)
            if (!target) continue
            Object.assign(target, slotOf(v))
          }
          dirty = true
        }
      }

      const state: PersistedState = { installed, workspaces, activeWorkspace: active, settings, profile: parsed.profile ?? null }
      if (dirty) persist(state)
      return state
    }
  } catch { }

  const s = freshState()
  // 初次生成也要落位，否则第一屏所有卡片都叠在原点
  for (const w of s.workspaces) {
    const placed = placeMissing(buildViews(s.installed, w))
    for (const v of placed.list) {
      const target = w.windows.find((x) => x.id === v.id)
      if (target) Object.assign(target, slotOf(v))
    }
  }
  persist(s)
  return s
}

/**
 * 把「插件全局信息」与「某工作台的窗口」合并成组件消费的视图。
 *
 * 这是整个机制的枢纽：组件层只认 PluginView，`id` 是**窗口实例 id**。
 * 同一个插件在工作台里有几个窗口，就会产生几个视图，各自独立的
 * 位置 / 尺寸 / 可见性 / 配置 —— 这就是多窗口的实现方式。
 */
export function buildViews(installed: InstalledPlugin[], ws: Workspace): PluginView[] {
  const byId = new Map(installed.map((p) => [p.manifest.id, p]))
  const out: PluginView[] = []
  for (const w of ws.windows) {
    const p = byId.get(w.pluginId)
    // 插件被卸载但窗口还在（数据损坏）时跳过，避免渲染空卡
    if (!p) continue
    out.push({
      id: w.id,
      pluginId: w.pluginId,
      manifest: p.manifest,
      enabled: p.enabled,
      visible: w.visible,
      size: w.size,
      ...(w.x != null ? { x: w.x } : {}),
      ...(w.y != null ? { y: w.y } : {}),
      ...(w.w != null ? { w: w.w } : {}),
      ...(w.h != null ? { h: w.h } : {}),
      ...(w.collapsed ? { collapsed: true } : {}),
      ...(w.config ? { config: w.config } : {}),
    })
  }
  return out
}

/** 从视图反推回布局部分（写回窗口实例时用） */
export function slotOf(v: PluginView): SlotLayout {
  return {
    visible: v.visible,
    size: v.size,
    ...(v.x != null ? { x: v.x } : {}),
    ...(v.y != null ? { y: v.y } : {}),
    ...(v.w != null ? { w: v.w } : {}),
    ...(v.h != null ? { h: v.h } : {}),
    ...(v.collapsed ? { collapsed: true } : {}),
  }
}

export function persist(state: PersistedState) {
  localStorage.setItem(LS_KEY, JSON.stringify(state))
}

/** 插件私有 KV 的 key 前缀（与 ModuleHost 注入的 storage 命名空间一致） */
export function pluginStoragePrefix(id: string): string {
  return `plugin:${id}:`
}

/**
 * 清除某个插件的全部私有 KV。
 * 规范要求卸载插件时一并清理其运行数据，否则 localStorage 会永久残留。
 */
export function clearPluginStorage(id: string): number {
  const prefix = pluginStoragePrefix(id)
  const doomed: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(prefix)) doomed.push(key)
  }
  doomed.forEach((k) => localStorage.removeItem(k))
  return doomed.length
}

