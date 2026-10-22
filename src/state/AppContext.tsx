import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { CardSize, PluginManifest } from '../types/plugin'
import type { AppSettings, InstalledPlugin, PluginView, SlotLayout, UserProfile, WindowInstance, Workspace } from '../core/storage'
import {
  loadPersisted, persist, clearPluginStorage,
  MAX_DISPLAY_SCALE, MIN_DISPLAY_SCALE,
  buildViews, defaultSlot, newId, nextWorkspaceName, slotOf,
} from '../core/storage'
import type { OccupiedBox } from '../core/layout'
import { cardSize, findFreePosition, occupiedBoxOf } from '../core/layout'
import { scheduler } from '../core/scheduler'

/**
 * 应用状态（含多窗口支持）
 * ------------------------------------------------------------
 * 键的约定 —— 这是多窗口改造后最容易搞混的地方：
 *
 *   winId     窗口实例 id。**卡片级**操作全用它：
 *             位置 / 尺寸 / 可见性 / 收起 / 该窗口的配置 / 聚焦 / 关闭
 *   pluginId  插件 id。**插件级**操作才用它：
 *             启用停用 / 安装卸载 / 新建窗口 / 插件坞排序
 *
 * 一个插件可以对应多个 winId，所以「关闭」必须是关窗口而不是关插件。
 */
interface AppContextValue {
  settings: AppSettings
  /** 当前工作台的窗口视图（组件消费的就是这个） */
  installed: PluginView[]
  /** 全部已安装插件（不分工作台） */
  installedGlobal: InstalledPlugin[]
  /** 工作台列表 */
  workspaces: Workspace[]
  /** 当前工作台 id */
  activeWorkspace: string
  profile: UserProfile | null
  /** 当前聚焦的**窗口** id */
  focusedId: string | null

  // 工作台管理
  switchWorkspace: (id: string) => void
  addWorkspace: (name?: string) => string
  removeWorkspace: (id: string) => void
  renameWorkspace: (id: string, name: string) => void
  /** 设为默认工作台（下次打开应用时进入的那个） */
  setDefaultWorkspace: (id: string) => void
  /** 把当前工作台的布局复制一份成新工作台 */
  duplicateWorkspace: (id: string) => string

  // 窗口管理
  /**
   * 新建一个窗口（= 把该插件的卡片建到当前工作台）。
   * 返回新窗口 id。已在桌面上的窗口不受影响 —— 这是多窗口的关键：
   * 同一个插件可以反复调用它，每次多出一个独立窗口。
   *
   * config 用于「生来就该是某个状态」的场景 —— 典型是便签拖出成新窗口：
   * 新窗口必须**一开始**就只显示被拖出的那一张。若先建空窗口再补配置，
   * 中间会有一帧它显示全部便签，肉眼可见地闪一下。
   */
  openWindow: (pluginId: string, config?: Record<string, string>) => string
  /** 关闭一个窗口（只关这一个；该插件的其他窗口与插件本身都不动） */
  closeWindow: (winId: string) => void
  /** 该插件在当前工作台已开几个窗口 */
  countWindows: (pluginId: string) => number

  // 插件管理
  install: (m: PluginManifest) => void
  uninstall: (id: string) => void
  setEnabled: (id: string, on: boolean) => void

  // 卡片级（参数是窗口 id）
  setVisible: (winId: string, on: boolean) => void
  setSize: (winId: string, size: CardSize) => void
  /** 自由尺寸。传 undefined 表示清除覆盖、回落到 size 档位值 */
  setDim: (winId: string, w?: number, h?: number) => void
  /** 收起/展开卡片顶部栏 */
  setCollapsed: (winId: string, on: boolean) => void
  /** 合并写入**该窗口**的配置（齿轮设置面板使用） */
  setConfig: (winId: string, patch: Record<string, string>) => void
  setPosition: (winId: string, x: number, y: number) => void
  setFocusedId: (id: string | null) => void
  /** 插件坞拖动排序：把插件移到另一个之前 */
  moveInDock: (fromId: string, toId: string) => void
  /** 插件坞的显示顺序（插件 id 数组；未列出的按安装顺序排在后面） */
  dockOrder: string[]

  // 设置
  setTheme: (t: AppSettings['theme']) => void
  setRefreshMultiplier: (m: number) => void
  setSidebarMode: (m: AppSettings['sidebarMode']) => void
  setDisplayScale: (s: number) => void
  /** 顶部栏显隐 */
  setTopbarMode: (m: AppSettings['topbarMode']) => void
  /** 切换背景样式 */
  setBackground: (b: AppSettings['background']) => void
  /** 写入自定义背景图（data URL） */
  setBgImage: (url: string | undefined) => void
  /** 写入自定义背景视频（data URL） */
  setBgVideo: (url: string | undefined) => void

  // 账号
  login: (name: string) => void
  logout: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

/**
 * 为缺失坐标的可见窗口分配位置。
 *
 * 使用与 storage.placeMissing 相同的摆放算法（core/layout），确保
 * 「初次加载」与「新建窗口」得到一致且互不重叠的布局。
 * 全程返回新对象，不就地修改传入的 state。
 */
function assignDefaultPos(list: PluginView[]): PluginView[] {
  const result = list.map((p) => ({ ...p }))
  const occupied: OccupiedBox[] = []
  for (const p of result) {
    const box = occupiedBoxOf(p)
    if (box) occupied.push(box)
  }

  for (const p of result) {
    if (!p.visible || (p.x != null && p.y != null)) continue
    const { w, h } = cardSize(p.size, p.w, p.h)
    const pos = findFreePosition(occupied, w, h)
    p.x = pos.x
    p.y = pos.y
    occupied.push({ x: pos.x, y: pos.y, w, h })
  }
  return result
}

/** 给一个插件造一个新窗口实例 */
function makeWindow(pluginId: string, size: CardSize, visible: boolean): WindowInstance {
  return { id: newId('win'), pluginId, ...defaultSlot(size, visible) }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(loadPersisted, [])
  const [settings, setSettings] = useState<AppSettings>(initial.settings)
  const [installedGlobal, setInstalledGlobal] = useState<InstalledPlugin[]>(initial.installed)
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initial.workspaces)
  const [activeWorkspace, setActiveWorkspace] = useState<string>(initial.activeWorkspace)
  const [profile, setProfile] = useState<UserProfile | null>(initial.profile)
  const [focusedId, setFocusedId] = useState<string | null>(null)

  /**
   * 插件坞的显示顺序。
   *
   * 单独存而不是复用工作台的窗口顺序：坞是「快速取用入口」，
   * 用户按使用频率排；桌面布局顺序是另一回事。两者混在一起会让
   * 拖坞里的一项意外改动桌面层级。
   */
  const [dockOrder, setDockOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('workbench:dock-order:v1')
      const arr = raw ? JSON.parse(raw) : null
      return Array.isArray(arr) ? (arr as string[]) : []
    } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem('workbench:dock-order:v1', JSON.stringify(dockOrder)) } catch { /* 忽略配额错误 */ }
  }, [dockOrder])

  useEffect(() => {
    persist({ installed: installedGlobal, workspaces, activeWorkspace, settings, profile })
  }, [installedGlobal, workspaces, activeWorkspace, settings, profile])
  useEffect(() => scheduler.setMultiplier(settings.refreshMultiplier), [settings.refreshMultiplier])
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  // 背景样式：写 data-bg 供 CSS 选分支，图片/视频另写 CSS 变量。
  // 视频只在 background==='video' 时才渲染（见 Backdrop），
  // 否则用户切回纯色后视频还在后台放，白耗电。
  useEffect(() => {
    const el = document.documentElement
    el.dataset.bg = settings.background
    if (settings.bgImage) el.style.setProperty('--bg-image', `url("${settings.bgImage}")`)
    else el.style.removeProperty('--bg-image')
    if (settings.bgVideo) el.style.setProperty('--bg-video', `url("${settings.bgVideo}")`)
    else el.style.removeProperty('--bg-video')
  }, [settings.background, settings.bgImage, settings.bgVideo])

  // 顶部栏显隐：写 data-topbar 供 CSS 收起顶部栏
  useEffect(() => {
    document.documentElement.dataset.topbar = settings.topbarMode
  }, [settings.topbarMode])

  // 界面显示比例：以 CSS zoom 施加在根元素上。
  //
  // 选 zoom 而非 transform: scale()，因为 zoom 会改变布局尺寸（视口内的 CSS 像素变多/变少），
  // 界面是「真的变大/变小」而非被拉伸；同时 getBoundingClientRect 与 window.innerWidth
  // 仍处于同一坐标系，设置面板的 fixed 定位无需换算。
  // 另暴露为 CSS 变量 --ui-scale，供需要反向补偿的样式（如卡片描边）使用。
  useEffect(() => {
    const el = document.documentElement
    const s = settings.displayScale
    el.style.zoom = s === 1 ? '' : String(s)
    el.style.setProperty('--ui-scale', String(s))
  }, [settings.displayScale])

  /** 当前工作台的窗口视图 */
  const installed: PluginView[] = useMemo(() => {
    const ws = workspaces.find((w) => w.id === activeWorkspace) ?? workspaces[0]
    if (!ws) return []
    return buildViews(installedGlobal, ws)
  }, [installedGlobal, workspaces, activeWorkspace])

  /**
   * 改写当前工作台里某个**窗口**的布局。
   *
   * 所有卡片级操作（位置/尺寸/可见/收起/配置）都走这里，
   * 统一只动「当前工作台」的那一个窗口，不影响同一插件的其他窗口。
   */
  const patchWindow = (winId: string, patch: Partial<WindowInstance>, opts?: { place?: boolean }) => {
    setWorkspaces((list) =>
      list.map((w) => {
        if (w.id !== activeWorkspace) return w
        const idx = w.windows.findIndex((x) => x.id === winId)
        if (idx < 0) return w
        const next: WindowInstance = { ...w.windows[idx], ...patch }
        // 需要重新落位时清掉坐标，交给 assignDefaultPos 统一排
        if (opts?.place) { delete next.x; delete next.y }
        const windows = [...w.windows]
        windows[idx] = next
        return { ...w, windows }
      }),
    )
  }

  /** 当前工作台整体替换 windows（落位/重排后用） */
  const replaceWindows = (fn: (windows: WindowInstance[]) => WindowInstance[]) => {
    setWorkspaces((list) =>
      list.map((w) => (w.id === activeWorkspace ? { ...w, windows: fn(w.windows) } : w)),
    )
  }

  /**
   * 上桌面 / 新建窗口后重新落位。
   *
   * 只给「可见但还没有坐标」的窗口分配位置 —— 已经有坐标的保持不动，
   * 否则用户每次新建一个窗口，原有卡片都会重新排一遍。
   */
  const placeVisible = () => {
    replaceWindows((windows) => {
      const views = buildViews(installedGlobal, { id: activeWorkspace, name: '', windows })
      const placed = assignDefaultPos(views)
      const byId = new Map(placed.map((v) => [v.id, v]))
      return windows.map((w) => {
        const v = byId.get(w.id)
        if (!v) return w
        return { ...w, ...slotOf(v) }
      })
    })
  }

  const value: AppContextValue = {
    settings,
    installed,
    installedGlobal,
    workspaces,
    activeWorkspace,
    profile,
    focusedId,
    dockOrder,

    switchWorkspace: (id) => {
      if (!workspaces.some((w) => w.id === id)) return
      setActiveWorkspace(id)
      setFocusedId(null)
    },
    addWorkspace: (name) => {
      const id = newId()
      setWorkspaces((list) => {
        /**
         * 新工作台是一张**空桌面**：不继承当前工作台的任何窗口。
         *
         * 早先的实现在这里继承了「可见性」，理由是「否则新建出来是空的，
         * 还得一个个手动加回来」。实际用下来反了：用户新建工作台多半就是
         * 想从零开始摆一套，结果一进来就被塞满上一套的卡片，还得先一个个
         * 移出去。清空更符合「新建」的直觉。
         *
         * 每个已安装插件仍然补一个不可见的窗口，这样插件坞里点一下就能
         * 把它建到这个工作台上，不必等它先被安装。
         */
        const windows: WindowInstance[] = installedGlobal.map((p) =>
          makeWindow(p.manifest.id, (p.manifest.defaultSize ?? 'M') as CardSize, false),
        )
        // 名字：用户给了就用，否则自动编号。注意要在 push 之前算，
        // nextWorkspaceName 会跳过已占用的名字。
        const ws: Workspace = { id, name: name?.trim() || nextWorkspaceName(list), windows }
        return [...list, ws]
      })
      setActiveWorkspace(id)
      return id
    },
    removeWorkspace: (id) => {
      setWorkspaces((list) => {
        // 至少留一个：全删光就没有桌面可显示了
        if (list.length <= 1) return list
        const next = list.filter((w) => w.id !== id)
        if (id === activeWorkspace) setActiveWorkspace(next[0].id)
        return next
      })
    },
    renameWorkspace: (id, name) => {
      const trimmed = name.trim()
      if (!trimmed) return
      setWorkspaces((list) => list.map((w) => (w.id === id ? { ...w, name: trimmed } : w)))
    },
    setDefaultWorkspace: (id) => {
      // 「默认工作台」= 下次打开应用时进入的那个，所以直接记成 active。
      // 不必另存一个 defaultId：启动时读 active 即可，语义更简单，
      // 也不会出现「默认指向一个已删除的工作台」这种悬空引用。
      if (!workspaces.some((w) => w.id === id)) return
      setActiveWorkspace(id)
    },
    duplicateWorkspace: (id) => {
      const nid = newId()
      setWorkspaces((list) => {
        const src = list.find((w) => w.id === id)
        if (!src) return list
        // 窗口要深拷贝并换新 id：两个工作台共享同一个 winId 会让
        // patchWindow 一次改到两边的卡片
        const windows: WindowInstance[] = src.windows.map((w) => ({
          ...w,
          id: newId('win'),
        }))
        const ws: Workspace = { id: nid, name: `${src.name} 副本`, windows }
        return [...list, ws]
      })
      setActiveWorkspace(nid)
      return nid
    },

    openWindow: (pluginId, config) => {
      const winId = newId('win')
      const p = installedGlobal.find((x) => x.manifest.id === pluginId)
      const size = (p?.manifest.defaultSize ?? 'M') as CardSize
      /**
       * 插件可以指定一个精确的初始窗口尺寸（`compact.window`），
       * 优先于档位。档位是粗粒度的（S=280×180 / M=480×220），
       * 有些组件在档位上找不到合适大小 —— 番茄钟的进度环里要放
       * "25:00"，S 档时环只有 58px，文字几乎顶出圆外。
       */
      const cw = p?.manifest.compact?.window
      const initialDim = cw ? { w: cw.w, h: cw.h } : {}

      /**
       * 新建窗口 + 落位，放在**同一次** setWorkspaces 里完成。
       *
       * 早先拆成两步（先 append、再 setTimeout 落位）会踩两个坑：
       *  1. makeWindow 内部又生成一个 id，与外面返回的 winId 不一致，
       *     后续按 winId 定位永远找不到
       *  2. 中间那一帧窗口没有坐标，会先渲染在 (0,0) 再跳走，肉眼可见闪一下
       * 一次算完就没有这些问题。
       */
      setWorkspaces((list) =>
        list.map((w) => {
          if (w.id !== activeWorkspace) return w
          const fresh: WindowInstance = {
            id: winId,
            pluginId,
            ...defaultSlot(size, true),
            ...initialDim,
            // config 要在这里就给上：便签拖出成新窗口时，新窗口从第一帧
            // 起就只显示被拖出的那一张，不会先闪一下全部便签
            ...(config ? { config: { ...config } } : {}),
          }
          const windows = [...w.windows, fresh]
          // 用「加入新窗口之后」的完整集合算位置，这样它会避开已有卡片
          const views = buildViews(installedGlobal, { ...w, windows })
          const placed = assignDefaultPos(views)
          const byId = new Map(placed.map((v) => [v.id, v]))
          return {
            ...w,
            windows: windows.map((x) => {
              const v = byId.get(x.id)
              return v ? { ...x, ...slotOf(v) } : x
            }),
          }
        }),
      )
      setFocusedId(winId)
      return winId
    },
    closeWindow: (winId) => {
      replaceWindows((windows) => windows.filter((w) => w.id !== winId))
      setFocusedId((cur) => (cur === winId ? null : cur))
    },
    /**
   * 该插件在当前工作台**已开几个窗口**（= 桌面上看得见的卡片数）。
   *
   * ⚠ 只数 visible 的。每个已安装插件在新建工作台时都会被补一个
   * `visible: false` 的占位窗口（这样插件坞里点一下就能建出来），
   * 把它们也算进来的话，一个刚建好的空工作台里每个插件都会显示
   * 「已开 1 个」—— 明明桌面上一张卡片都没有。实测踩过这个坑。
   */
  countWindows: (pluginId) =>
    (workspaces.find((w) => w.id === activeWorkspace)?.windows ?? []).filter(
      (w) => w.pluginId === pluginId && w.visible,
    ).length,

    install: (m) =>
      setInstalledGlobal((list) => {
        if (list.some((p) => p.manifest.id === m.id)) return list
        // 新装的插件在每个工作台补一个不可见窗口（默认不上桌面）
        setWorkspaces((wsList) =>
          wsList.map((w) => ({
            ...w,
            windows: [
              ...w.windows,
              makeWindow(m.id, (m.defaultSize ?? 'M') as CardSize, !!m.defaultVisible),
            ],
          })),
        )
        return [...list, { manifest: m, enabled: true }]
      }),
    uninstall: (id) => {
      // 在 state updater 之外清理：StrictMode 下 updater 可能被执行两次
      clearPluginStorage(id)
      setInstalledGlobal((l) => l.filter((p) => p.manifest.id !== id))
      // 各工作台里该插件的**所有窗口**都要清掉，否则残留数据会一直跟着
      setWorkspaces((wsList) =>
        wsList.map((w) => {
          const windows = w.windows.filter((x) => x.pluginId !== id)
          return windows.length === w.windows.length ? w : { ...w, windows }
        }),
      )
    },
    setEnabled: (id, on) =>
      setInstalledGlobal((l) => l.map((p) => (p.manifest.id === id ? { ...p, enabled: on } : p))),

    setVisible: (winId, on) => {
      patchWindow(winId, { visible: on }, { place: on })
      // 落位依赖最新 state，放到下一个微任务里跑，保证读到刚写入的 visible
      if (on) setTimeout(placeVisible, 0)
    },
    setSize: (winId, size) => patchWindow(winId, { size }),
    // 配置挂在**窗口**上：同一插件的两个窗口可以各自设置（如两个时钟看不同时区）
    setConfig: (winId, patch) =>
      replaceWindows((windows) =>
        windows.map((w) => (w.id === winId ? { ...w, config: { ...w.config, ...patch } } : w)),
      ),
    setDim: (winId, w, h) => patchWindow(winId, { w, h }),
    setCollapsed: (winId, on) => patchWindow(winId, { collapsed: on }),
    setPosition: (winId, x, y) => patchWindow(winId, { x, y }),
    setFocusedId,
    moveInDock: (fromId, toId) => {
      setDockOrder((order) => {
        // 用「已安装插件的自然顺序」补全 order 里缺的项，再做移动，
        // 否则第一次拖动时 order 是空的，找不到下标
        const base = order.length
          ? [...order.filter((x) => installedGlobal.some((p) => p.manifest.id === x)),
             ...installedGlobal.map((p) => p.manifest.id).filter((x) => !order.includes(x))]
          : installedGlobal.map((p) => p.manifest.id)
        const from = base.indexOf(fromId)
        const to = base.indexOf(toId)
        if (from < 0 || to < 0 || from === to) return base
        const copy = [...base]
        const [moved] = copy.splice(from, 1)
        copy.splice(to, 0, moved)
        return copy
      })
    },

    setTheme: (t) => setSettings((s) => ({ ...s, theme: t })),
    setRefreshMultiplier: (m) => setSettings((s) => ({ ...s, refreshMultiplier: m })),
    setSidebarMode: (m) => setSettings((s) => ({ ...s, sidebarMode: m })),
    setDisplayScale: (v) =>
      setSettings((s) => ({
        ...s,
        displayScale: Math.min(MAX_DISPLAY_SCALE, Math.max(MIN_DISPLAY_SCALE, v)),
      })),
    setTopbarMode: (m) => setSettings((s) => ({ ...s, topbarMode: m })),
    setBackground: (b) => setSettings((s) => ({ ...s, background: b })),
    setBgImage: (url) => setSettings((s) => ({ ...s, bgImage: url, background: url ? 'image' : s.background })),
    setBgVideo: (url) => setSettings((s) => ({ ...s, bgVideo: url, background: url ? 'video' : s.background })),

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
