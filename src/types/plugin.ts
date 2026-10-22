/**
 * ============================================================
 *  Workbench 插件协议（Plugin Protocol v1）
 *  ------------------------------------------------------------
 *  每个插件以一份 PluginManifest 描述自身能力；
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
   *  - 0      ：手动刷新（仅用户点击刷新按钮时触发）
   *  - -1     ：永不刷新（静态插件）
   */
  intervalMs: number
  /** 页面不可见时是否暂停调度（默认 true） */
  pauseWhenHidden?: boolean
}

/** 插件声明所需的宿主能力（最小权限原则） */
export interface PluginPermissions {
  /** 读取用户基础资料（昵称 / 头像） */
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
  /**
   * 设置面板声明。宿主据此自动渲染齿轮面板，插件无需改动宿主源码。
   * 写入的值统一为字符串，经 PluginContext.config / workbench:config 下发。
   */
  settings?: PluginSettingsSchema
  /**
   * 该插件是否提供「桌面精简形态」。
   *
   * 约定：插件页支持 `?view=compact` 时进入精简模式（隐藏完整窗口，
   * 只显示一个小部件）。声明此项后，宿主会在卡片设置菜单里给出
   * 「完整窗口 / 桌面精简」切换，并把选择写进该插件的 config.view，
   * 由宿主拼到 iframe 的 URL 上（插件侧无需处理消息）。
   */
  compact?: {
    /** 精简形态下建议的卡片尺寸（通常比完整窗口小） */
    size?: CardSize
    /**
     * 精简形态建议的**初始窗口像素尺寸**。
     *
     * `size` 是档位（S/M/L/XL，粗粒度），这个是精确尺寸 —— 用于
     * 「档位给不出合适大小」的组件。典型例子是番茄钟：进度环里要放
     * "25:00" 五个等宽字符，S 档(280×180) 时环只有 58px，文字几乎顶出
     * 圆外；给 320×300 才能让环成为标准圆。
     *
     * 只影响新窗口的初始尺寸；用户拖过之后以用户的为准。
     */
    window?: { w: number; h: number }
  }
  /**
   * 悬浮插件：不在桌面上占一张卡片，而是以浮动层渲染在界面之上。
   *
   * 用途是桌宠这类「贴在最上层、可拖动、不参与桌面布局」的插件。
   * 与普通插件的区别：
   *   - 不占桌面坐标（x/y/w/h/size 全部无意义）
   *   - 不受桌面画布的平移缩放影响（否则缩放时会跟着变形跑位）
   *   - 宿主给它一个 fixed 定位的可拖动容器
   * 因此 overlay 插件在桌面布局、定位模式、插件坞里都会被跳过。
   */
  overlay?: {
    /** 初始位置（视口坐标，左上角为原点） */
    x?: number
    y?: number
    /** 初始尺寸 */
    width?: number
    height?: number
  }
}

/* ---------------- 设置面板声明（声明式，宿主通用渲染） ---------------- */

interface SettingsFieldBase {
  /** 写入 config 的键名 */
  key: string
  label: string
  /** 字段说明（可选，显示在标签下方） */
  hint?: string
}

export interface SettingsTextField extends SettingsFieldBase {
  type: 'text'
  placeholder?: string
  default?: string
}

export interface SettingsNumberField extends SettingsFieldBase {
  type: 'number'
  min?: number
  max?: number
  step?: number
  default?: string
}

export interface SettingsColorField extends SettingsFieldBase {
  type: 'color'
  default?: string
}

/**
 * 预设色板选择（16 色）。相比自由取色器，预设值都是经过对比度校验的配色，
 * 用户不会选出看不清的组合。
 *
 * `palette` 引用内置色板名（见 core/palettes.ts）。
 * 若指定 `pairWith`，选中某色时会自动把该色的推荐前景色写入 `pairWith` 指定的键
 * ——「选背景自动搭配可读字体色」即由此实现；用户仍可再单独覆盖字体色。
 */
export interface SettingsPaletteField extends SettingsFieldBase {
  type: 'palette'
  /** 内置色板名，如 'note' */
  palette: string
  /** 选中色时联动写入的键（通常为字体色） */
  pairWith?: string
  default?: string
}

export interface SettingsSelectField extends SettingsFieldBase {
  type: 'select'
  options: Array<{ value: string; label: string }>
  default?: string
}

/**
 * 字体族选择：渲染为下拉表格，每个选项以该字体本身预览（所见即所得）。
 * 选项取自内置字体清单（core/fonts.ts）或字段自带的 options。
 * 写入的值为 CSS font-family 片段。
 */
export interface SettingsFontField extends SettingsFieldBase {
  type: 'font'
  /** 内置字体清单名，默认 'ui' */
  fonts?: string
  /** 覆盖内置清单（一般不需要） */
  options?: Array<{ value: string; label: string }>
  default?: string
}

/**
 * 三级级联选择（省 / 市 / 区县）。
 * 数据源为 `{ provinces: [{ code, name, cities: [{ code, name, districts: [{ code, name }] }] }] }`
 * 形状的 JSON；选中区县后把完整区域码写入 key，可选地把名称写入 nameKey。
 */
export interface SettingsCascadeField extends SettingsFieldBase {
  type: 'cascade'
  /** 数据源 URL */
  source: string
  /** 同时写入选中项名称的键（可选） */
  nameKey?: string
  /** 默认区域码 */
  default?: string
  /** 与 default 配对的默认名称 */
  defaultName?: string
}

export type SettingsField =
  | SettingsTextField
  | SettingsNumberField
  | SettingsColorField
  | SettingsPaletteField
  | SettingsFontField
  | SettingsSelectField
  | SettingsCascadeField

export interface PluginSettingsSchema {
  /** 面板标题 */
  title?: string
  fields: SettingsField[]
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
  /** 当前插件级配置（齿轮设置面板写入，随宿主状态持久化） */
  config: Record<string, string>
  /** 写入插件级配置（变更后宿主持久化并经 onConfigChange 回调下发） */
  setConfig(patch: Record<string, string>): void
  /** 配置变更回调（宿主下发新配置时调用，插件据此更新外观/行为） */
  onConfigChange?(config: Record<string, string>): void
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
  /** 配置变更回调（宿主下发新配置时调用，插件据此更新外观/行为） */
  onConfigChange?(config: Record<string, string>): void
}

/* ---------------- iframe 插件 postMessage 协议 ---------------- */

/** 宿主 → 插件 */
export type HostMessage =
  | { type: 'workbench:init'; payload: { theme: 'light' | 'dark'; locale: string; width: number; config: Record<string, string>; windowId: string } }
  | { type: 'workbench:tick'; payload: { ts: number } }
  | { type: 'workbench:theme'; payload: { theme: 'light' | 'dark' } }
  | { type: 'workbench:resize'; payload: { width: number; height: number } }
  /** 插件级配置变更：齿轮设置面板改动后由宿主下发 */
  | { type: 'workbench:config'; payload: Record<string, string> }

/** 插件 → 宿主 */
export type PluginMessage =
  | { type: 'plugin:ready'; payload: { id: string } }
  | { type: 'plugin:resize'; payload: { height: number } }
  | { type: 'plugin:openUrl'; payload: { url: string } }
  | { type: 'plugin:storage'; payload: { action: 'get' | 'set'; key: string; value?: unknown } }
  | { type: 'plugin:profile'; payload: null }
  | { type: 'plugin:notify'; payload: { title: string; body: string } }

/* ---------------- 卡片间拖放（插件发起、宿主执行） ---------------- */

/**
 * 「把插件内的一个条目拖到卡片外」的通用通道。
 *
 * 场景：便签完整窗口里拖动某个便签标题，拖到本卡片之外 → 变成独立窗口；
 * 拖到另一个同插件窗口上 → 并入那个窗口；在本卡片内 → 只改顺序。
 *
 * 为什么必须由宿主执行：
 *   插件在 iframe 里，既不能新建窗口、也不能改别的窗口的配置。
 *   它只负责「我在拖第几个、鼠标现在在父页面的哪个坐标」，
 *   命中判定与窗口操作全在宿主侧完成。
 *
 * 坐标用**父页面视口坐标**（插件通过 frameElement 的 rect 换算），
 * 这样宿主可以直接和卡片 rect 比对，不必知道画布缩放了多少。
 */
export interface CardDragMessage {
  /** 拖的是哪个条目 */
  itemId: string
  itemLabel?: string
  /** 拖动阶段：start 按下 / move 移动 / end 松手 / cancel 取消 */
  phase: 'start' | 'move' | 'end' | 'cancel'
  /** 鼠标在父页面视口中的坐标 */
  x: number
  y: number
  /** 光标是否仍在本卡片内（插件自己算，宿主不必反查） */
  insideOwn: boolean
}

/**
 * 宿主 → 插件的拖放反馈，供插件画提示。
 *
 * kind：
 *   'own'      在源卡片内 —— 松手只改顺序
 *   'merge'    在另一个同插件窗口上 —— 松手并进去
 *   'tearout'  在所有卡片之外 —— 松手变成独立窗口
 *   'none'     在别的卡片上但不是同类窗口 —— 松手取消
 */
export interface CardDropFeedback {
  kind: 'own' | 'merge' | 'tearout' | 'none'
  /** 目标窗口的标题，用于提示文案（如「并入 快速便签 #2」） */
  label?: string
}

/* ---------------- 精简形态设置（由插件自报、宿主渲染） ---------------- */

/** 一个可选值 */
export interface CompactChoice {
  value: string | number | boolean
  label: string
}

/** 当前精简格式的一项设置 */
export interface CompactOption {
  key: string
  label: string
  type: 'bool' | 'select' | 'num' | 'text'
  def?: unknown
  min?: number
  max?: number
  /** type==='select' 时的候选项 */
  choices?: CompactChoice[]
  /** 当前值（已回落到 def） */
  value: unknown
}

/**
 * 精简形态的设置清单，由插件 describe() 上报。
 *
 * 精简形态在宿主卡片里没有自己的齿轮与浮层菜单（组件只出内容），
 * 所有设置都搬进卡片设置面板的二级界面 —— 清单就是那份界面要渲染的东西。
 * 宿主不理解插件内部结构，只按下标把改动回传给插件。
 */
export interface CompactDescription {
  /** 可选格式 */
  formats: Array<{ id: string; name: string; icon: string }>
  /** 当前格式 id */
  format?: string
  /** 当前组件尺寸档位 */
  size: string
  /** 可选尺寸档位 */
  sizes: Array<{ id: string; name: string }>
  /** 当前格式的选项 */
  options: CompactOption[]
}

/** 宿主 → 插件：精简设置 */
export type CompactHostMessage =
  /** 取清单 */
  | { type: 'cw:describe' }
  /** 写入改动（只传要改的字段） */
  | { type: 'cw:apply'; patch: { format?: string; size?: string; opts?: Record<string, unknown> } }

/** 插件 → 宿主：精简设置 */
export type CompactPluginMessage =
  /** 主动上报当前状态与清单 */
  | { type: 'cw:state'; state: { format: string; size: string }; desc: CompactDescription | null }
