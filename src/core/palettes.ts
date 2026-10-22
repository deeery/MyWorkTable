/**
 * 内置预设色板
 * ------------------------------------------------------------
 * 供声明式设置面板的 `palette` 字段使用（见 docs/PLUGIN_SPEC.md §8）。
 *
 * 便签色板取自被广泛使用的 Material Design 50/100 级浅色 + 主流笔记应用
 * （Google Keep / Apple Notes）的便签底色，每项都配有一个可读的前景色，
 * 用于「选背景时自动搭配字体色」。所有配对的对比度均经 WCAG 校验
 * （正文 ≥ 4.5:1，见 scripts/ 中的校验方式 / 提交说明）。
 */

export interface PaletteSwatch {
  /** 写入 config 的颜色值 */
  value: string
  /** 色板名（用于 tooltip 与无障碍标签） */
  label: string
  /** 配对的推荐前景色（选此背景时自动写入 pairWith 指定的键） */
  fg?: string
}

/** 便签预设色板：16 种柔和底色，各配可读前景色 */
export const NOTE_PALETTE: PaletteSwatch[] = [
  { value: '#ffffff', label: '白', fg: '#23263a' },
  { value: '#fdf6e3', label: '象牙', fg: '#5b4636' },
  { value: '#fff9c4', label: '柠檬', fg: '#5d4b1a' },
  { value: '#ffe0b2', label: '蜂蜜', fg: '#6d4c1b' },
  { value: '#ffccbc', label: '蜜桃', fg: '#7a3b1e' },
  { value: '#ffcdd2', label: '珊瑚', fg: '#8e2b30' },
  { value: '#f8bbd0', label: '樱花', fg: '#7b2b4d' },
  { value: '#e1bee7', label: '丁香', fg: '#5b2c6f' },
  { value: '#d1c4e9', label: '薰衣草', fg: '#4a3b78' },
  { value: '#bbdefb', label: '天蓝', fg: '#17457a' },
  { value: '#b3e5fc', label: '湖蓝', fg: '#0f4c5c' },
  { value: '#b2dfdb', label: '薄荷', fg: '#14504a' },
  { value: '#dcedc8', label: '抹茶', fg: '#33691e' },
  { value: '#c8e6c9', label: '嫩绿', fg: '#1b5e20' },
  { value: '#cfd8dc', label: '石板', fg: '#37474f' },
  { value: '#37474f', label: '墨黑', fg: '#eceff1' },
]

/**
 * 便签字体色板：由上表的配对前景色导出，供用户单独覆盖字体色时选择。
 * 去重后按原顺序排列（保持与底色一一对应的直觉）。
 */
export const NOTE_TEXT_PALETTE: PaletteSwatch[] = (() => {
  const seen = new Set<string>()
  const out: PaletteSwatch[] = []
  for (const s of NOTE_PALETTE) {
    if (!s.fg || seen.has(s.fg)) continue
    seen.add(s.fg)
    out.push({ value: s.fg, label: `${s.label} 文字` })
  }
  return out
})()

/** 具名色板注册表：manifest 里用 `palette: 'note'` 引用 */
export const PALETTES: Record<string, PaletteSwatch[]> = {
  note: NOTE_PALETTE,
  'note-text': NOTE_TEXT_PALETTE,
}

/** 按名字取色板；未知名字返回 undefined（面板会退化为无选项） */
export function getPalette(name: string | undefined): PaletteSwatch[] | undefined {
  return name ? PALETTES[name] : undefined
}

/* ---------------- 对比度工具（用于在色块上写可读的文字/勾选标记） ---------------- */

function srgbToLinear(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** 相对亮度（WCAG 2.x） */
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  return 0.2126 * srgbToLinear(parseInt(h.slice(0, 2), 16))
    + 0.7152 * srgbToLinear(parseInt(h.slice(2, 4), 16))
    + 0.0722 * srgbToLinear(parseInt(h.slice(4, 6), 16))
}

/** 两色对比度，1:1 ~ 21:1 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * 为给定底色挑一个可读的文字色（浅底配深字、深底配浅字）。
 * 色块上直接写色名时用它，保证任何底色上文字都看得清。
 */
export function readableTextColor(bg: string): string {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111318')
    ? '#ffffff'
    : '#111318'
}

/**
 * 构造「选中某个色板项」时要写入的 config 补丁。
 *
 * 这是色板联动的唯一实现，被 SettingsPanel 使用，也便于单独验证。
 * 当字段声明了 pairWith 且该色板项带有配对前景色时，一并写入前景色
 * ——「选背景自动搭配可读字体色」即由此实现；用户之后可再单独覆盖字体色。
 */
export function palettePatch(
  key: string,
  swatch: PaletteSwatch,
  pairWith?: string,
): Record<string, string> {
  const patch: Record<string, string> = { [key]: swatch.value }
  if (pairWith && swatch.fg) patch[pairWith] = swatch.fg
  return patch
}

/** 按颜色值查色板项（用于判断当前选中项与取配对前景色） */
export function findSwatch(
  name: string | undefined,
  value: string | undefined,
): PaletteSwatch | undefined {
  if (!value) return undefined
  const target = value.toLowerCase()
  return getPalette(name)?.find((s) => s.value.toLowerCase() === target)
}
