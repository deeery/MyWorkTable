/**
 * 结构图标集（矢量）
 *
 * 为什么要有这个文件：审计发现全站有 **19 处** 用文字字形当结构图标 ——
 * `⧉ ↧ ⚙ ✕ ★ ☆ ＋ ✎ ⟳ ↺ ▲ ▼`。这些字符的问题不是丑，是**不可控**：
 *
 *   1. 字形来自字体。Inter 里没有 `⧉`，浏览器会回退到 Segoe UI Symbol /
 *      Apple Symbols / 思源黑体，三家的描边粗细、基线、字面大小全不一样。
 *      同一个按钮在 Windows / macOS / 浏览器里长得不是一回事。
 *   2. 基线对不上。`✕` 与 `⚙` 的字面高度差很多，`line-height: 1` 下
 *      两者在按钮里一个偏高一个偏低，靠 padding 微调只能碰运气。
 *   3. 无法统一描边。ui-ux-pro-max 要求「统一描边风格、统一尺寸令牌」，
 *      文字字形给不了 stroke-width。
 *
 * 所以统一换成 16×16 viewBox 的 `currentColor` 描边图标：尺寸、描边、
 * 视觉重心全部由代码控制，跨平台完全一致。
 *
 * 使用约定：
 *   - 颜色永远用 `currentColor`，跟着按钮文字色走，不单独传颜色。
 *   - 尺寸默认 16，通过 `size` 覆盖；不传 `className` 就只吃父级样式。
 *   - `strokeWidth` 默认 1.75（16px 下的「中等」粗细，比 1.5 清楚、
 *     比 2 更接近 Inter 的笔画重量）。
 *   - 一律 `aria-hidden`：图标是装饰，可见文字或 `title`/`aria-label`
 *     才承载语义。
 */
import type { SVGProps } from 'react'

export type IconProps = {
  /** 视觉边长（px）。默认 16 */
  size?: number
  /** 覆盖描边粗细，默认 1.75 */
  strokeWidth?: number
} & Omit<SVGProps<SVGSVGElement>, 'children'>

function Icon({
  size = 16,
  strokeWidth = 1.75,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/* ---------------- 窗口操作 ---------------- */

/** 再开一个窗口（两张叠起来的卡片）—— 原 `⧉` */
export const IconDuplicate = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="5.5" width="8" height="8" rx="1.6" />
    <path d="M5.5 5.5V3.6c0-.6.5-1.1 1.1-1.1h5.3c.6 0 1.1.5 1.1 1.1v5.3c0 .6-.5 1.1-1.1 1.1h-1.9" />
  </Icon>
)

/** 关闭（X）—— 原 `✕` */
export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
)

/** 收起顶部栏（向下收进）—— 原 `↧` */
export const IconCollapse = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.5v7.5" />
    <path d="M5 7l3 3 3-3" />
    <path d="M3 13h10" />
  </Icon>
)

/** 展开顶部栏 —— 原 `↥`（出现在 tooltip 文案里） */
export const IconExpand = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 13.5V6" />
    <path d="M5 9l3-3 3 3" />
    <path d="M3 3h10" />
  </Icon>
)

/* ---------------- 通用操作 ---------------- */

/** 设置（齿轮）—— 原 `⚙` */
export const IconGear = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.3" />
    <path d="M8 1.7v1.5M8 12.8v1.5M14.3 8h-1.5M3.2 8H1.7M12.5 3.5l-1.06 1.06M4.56 11.44L3.5 12.5M12.5 12.5l-1.06-1.06M4.56 4.56L3.5 3.5" />
  </Icon>
)

/** 新增 / 加号 —— 原 `＋` */
export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3.2v9.6M3.2 8h9.6" />
  </Icon>
)

/** 重命名（铅笔）—— 原 `✎` */
export const IconPencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11.2 2.6l2.2 2.2-7.5 7.5-2.9.7.7-2.9z" />
    <path d="M9.6 4.2l2.2 2.2" />
  </Icon>
)

/** 刷新（环形箭头）—— 原 `⟳` */
export const IconRefresh = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7" />
    <path d="M13.4 2.4v3.2h-3.2" />
  </Icon>
)

/** 还原（逆时针回转）—— 原 `↺` */
export const IconReset = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.7" />
    <path d="M2.6 2.4v3.2h3.2" />
  </Icon>
)

/** 搜索（放大镜） */
export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7.2" cy="7.2" r="4.3" />
    <path d="M10.4 10.4l3 3" />
  </Icon>
)

/* ---------------- 状态 / 方向 ---------------- */

/** 星标（已选中，实心）—— 原 `★` */
export const IconStar = ({ size = 16, strokeWidth = 1.75, ...rest }: IconProps) => (
  <Icon size={size} strokeWidth={strokeWidth} fill="currentColor" {...rest}>
    <path d="M8 2.1l1.75 3.55 3.92.57-2.84 2.77.67 3.9L8 10.98l-3.5 1.84.67-3.9L2.33 6.22l3.92-.57z" />
  </Icon>
)

/** 星标（未选中，空心）—— 原 `☆` */
export const IconStarOutline = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.1l1.75 3.55 3.92.57-2.84 2.77.67 3.9L8 10.98l-3.5 1.84.67-3.9L2.33 6.22l3.92-.57z" />
  </Icon>
)

/** 向下箭头（展开折叠区）—— 原 `▼` */
export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6.2l4 4 4-4" />
  </Icon>
)

/** 向上箭头 —— 原 `▲` */
export const IconChevronUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9.8l4-4 4 4" />
  </Icon>
)
