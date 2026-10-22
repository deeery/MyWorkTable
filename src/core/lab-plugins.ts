/**
 * plugin-lab 镜像插件的注册表条目
 * ------------------------------------------------------------
 * 本文件由 plugin-lab/tools/mirror-to-workbench.mjs 生成，请勿手改。
 * 重新生成：
 *   cd plugin-lab
 *   node tools/mirror-to-workbench.mjs        # 默认清单
 *   node tools/mirror-to-workbench.mjs --all  # 全部 50 个
 *
 * 这些插件是完整 HTML 页面，因此用 iframe 渲染模式；宿主已有的
 * PluginBus 握手、主题下发（workbench:init / workbench:theme）都能直接复用。
 *
 * 目录结构（public/lab/ 下与 plugin-lab 一一对应）：
 *   public/lab/plugins/07-x.html   +  public/lab/assets/pl.js
 * 插件内的 ../assets/... 相对路径因此原样可用，插件源码零改动。
 */
import type { PluginManifest } from '../types/plugin'

/** 镜像清单（编号 / 文件 / 名称 / 图标 / 主色 / 是否含精简形态 / 是否悬浮插件） */
export interface LabPluginEntry {
  num: string
  file: string
  title: string
  emoji: string
  accent: string
  hasCompact: boolean
  /**
   * 悬浮插件：不在桌面上占一张卡片，而是以浮动层渲染在界面之上。
   * 桌宠（#51）是第一个 —— 它要贴在屏幕最上层、可拖动，
   * 且不受桌面画布平移缩放影响。
   */
  isOverlay?: boolean
  /**
   * 该插件精简形态建议的**初始窗口尺寸**（像素）。
   *
   * 默认给 S(280×180)。但有些组件天生需要更多空间 ——
   * 番茄钟的进度环里要放 "25:00" 五个等宽字符，280 宽时环只有 58px，
   * 文字几乎顶出圆外。给这类插件指定一个更合适的初始尺寸，
   * 用户装完就能看到完整的样子，不用自己去拖。
   *
   * 只影响「新窗口的初始尺寸」，用户拖过之后以用户的为准。
   */
  cwSize?: { w: number; h: number }
}

/**
 * 镜像清单数据。由 mirror 脚本写入，供下方生成 manifest 使用。
 * 保持为纯数据，便于宿主按需读取（如后续做「精简形态」切换）。
 */
export const LAB_CATALOG: LabPluginEntry[] = [
  { num: '01', file: '01-medication-reminder.html', title: '药品管家', emoji: '💊', accent: '#f97316', hasCompact: true },
  { num: '02', file: '02-water-reminder.html', title: '喝水提醒', emoji: '💧', accent: '#38bdf8', hasCompact: true },
  { num: '03', file: '03-pomodoro-focus.html', title: '番茄专注', emoji: '🍅', accent: '#ef4444', hasCompact: true, cwSize: { w: 320, h: 360 } },
  { num: '04', file: '04-sit-stand-reminder.html', title: '久坐管家', emoji: '🧘', accent: '#22c55e', hasCompact: true },
  { num: '06', file: '06-todo-list.html', title: '待办清单', emoji: '✅', accent: '#6366f1', hasCompact: true },
  { num: '07', file: '07-countdown-days.html', title: '倒数日', emoji: '📅', accent: '#8b5cf6', hasCompact: true },
  { num: '08', file: '08-app-launcher.html', title: '快捷启动器', emoji: '🚀', accent: '#0ea5e9', hasCompact: true },
  { num: '09', file: '09-music-player.html', title: '音乐播放器', emoji: '🎵', accent: '#a855f7', hasCompact: true },
  { num: '10', file: '10-world-clock.html', title: '世界时钟', emoji: '🌍', accent: '#14b8a6', hasCompact: true },
  { num: '12', file: '12-sticky-notes.html', title: '快速便签', emoji: '🗒️', accent: '#facc15', hasCompact: true },
  { num: '13', file: '13-weather-widget.html', title: '天气小部件', emoji: '⛅', accent: '#3b82f6', hasCompact: true },
  { num: '16', file: '16-parcel-tracker.html', title: '快递追踪', emoji: '📦', accent: '#f472b6', hasCompact: true },
  { num: '18', file: '18-screenshot-pin.html', title: '截图贴图', emoji: '✂️', accent: '#ef4444', hasCompact: true },
  { num: '19', file: '19-window-tiler.html', title: '窗口布局', emoji: '🪟', accent: '#8b5cf6', hasCompact: true },
  { num: '22', file: '22-stopwatch-timer.html', title: '计时秒表', emoji: '⏱️', accent: '#f97316', hasCompact: true },
  { num: '26', file: '26-habit-tracker.html', title: '习惯打卡', emoji: '🔥', accent: '#f43f5e', hasCompact: true },
  { num: '27', file: '27-breathing-relax.html', title: '呼吸放松', emoji: '🌬️', accent: '#14b8a6', hasCompact: true },
  { num: '29', file: '29-meeting-reminder.html', title: '会议提醒', emoji: '📆', accent: '#3b82f6', hasCompact: true },
  { num: '30', file: '30-do-not-disturb.html', title: '勿扰模式', emoji: '🌙', accent: '#7c3aed', hasCompact: true },
  { num: '42', file: '42-pet-companion.html', title: '桌面宠物', emoji: '🐱', accent: '#f472b6', hasCompact: true },
  { num: '46', file: '46-volume-mixer.html', title: '音量混合器', emoji: '🎚️', accent: '#8b5cf6', hasCompact: true },
  { num: '50', file: '50-brightness-temp.html', title: '亮度色温', emoji: '🔆', accent: '#f59e0b', hasCompact: true },
  { num: '51', file: '51-desk-pet.html', title: '喵酱桌宠', emoji: '🐾', accent: '#f472b6', hasCompact: false, isOverlay: true },
]

/**
 * 由清单生成宿主 manifest。
 *
 * 刷新策略：plugin-lab 的插件自身用 setInterval 驱动界面（每秒或更快），
 * 宿主不必再派发 tick，故 intervalMs 设为 -1（静态），避免重复刷新。
 * 主题由宿主经 workbench:init / workbench:theme 下发，插件的 pl.js 镜像版
 * 已含桥接代码接收。
 */
export const LAB_PLUGINS: PluginManifest[] = LAB_CATALOG.map((p) => ({
  id: `lab.${p.num}`,
  name: p.title,
  version: '1.0.0',
  description: p.isOverlay
    ? `插件实验室 #${p.num}（悬浮插件，不占桌面卡片）`
    : `插件实验室 #${p.num}（${p.hasCompact ? '含桌面精简形态' : '仅完整窗口'}）`,
  author: 'plugin-lab',
  icon: p.emoji,
  category: 'tool',
  renderMode: 'iframe',
  entry: `/lab/plugins/${p.file}`,
  // 默认精简形态的小部件只有 140px 见方，用 M(480×220) 会四周大片留白，
  // 故含精简形态的插件默认给 S(280×180)。用户仍可自行拖拽调整。
  defaultSize: p.hasCompact ? ('S' as const) : ('M' as const),
  refresh: { intervalMs: -1 },
  defaultVisible: false,
  // 声明后，宿主会在卡片设置菜单里给出「完整窗口 / 桌面精简」切换，
  // 并把选择写进 config.view，由 IframeHost 拼成 ?view=compact。
  // cwSize 一并带上：宿主新建窗口时用它当初始尺寸（见 AppContext.openWindow）
  ...(p.hasCompact ? { compact: { size: 'S' as const, ...(p.cwSize ? { window: p.cwSize } : {}) } } : {}),
  // 悬浮插件：由 OverlayHost 渲染成可拖动的浮动层，不进桌面布局
  ...(p.isOverlay ? { overlay: { x: 200, y: 300, width: 160, height: 150 } } : {}),
}))
