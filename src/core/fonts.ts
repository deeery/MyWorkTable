/**
 * 内置字体清单
 * ------------------------------------------------------------
 * 供声明式设置面板的 `font` 字段使用（见 docs/PLUGIN_SPEC.md §8）。
 *
 * 每项都是「CSS font-family 片段 + 中文名 + 该字体的实际栈」，用于在下拉表格里
 * 以字体本身预览。清单只收录各平台普遍存在的字体，并为每项配一条完整回退链，
 * 避免用户选到的字体在其系统上不存在时出现空白/回退到默认字体。
 */

export interface FontOption {
  /** 写入 config 的值（CSS font-family 片段） */
  value: string
  /** 中文名 */
  label: string
  /** 实际渲染用的完整 font-family 栈（含回退） */
  stack: string
}

const SANS_FALLBACK = `-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`

/** 通用字体清单：无衬线 / 衬线 / 等宽 / 手写 各若干 */
export const UI_FONTS: FontOption[] = [
  { value: 'inherit', label: '跟随界面', stack: 'inherit' },
  {
    value: 'system-ui',
    label: '系统默认',
    stack: `system-ui, ${SANS_FALLBACK}`,
  },
  {
    value: "'PingFang SC'",
    label: '苹方 / 黑体',
    stack: `'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif`,
  },
  {
    value: "'Microsoft YaHei'",
    label: '微软雅黑',
    stack: `'Microsoft YaHei', 'PingFang SC', sans-serif`,
  },
  {
    value: "'SimSun'",
    label: '宋体',
    stack: `'SimSun', 'Songti SC', serif`,
  },
  {
    value: "'KaiTi'",
    label: '楷体',
    stack: `'KaiTi', 'Kaiti SC', 'STKaiti', serif`,
  },
  {
    value: 'Georgia',
    label: 'Georgia（衬线）',
    stack: `Georgia, 'Times New Roman', 'SimSun', serif`,
  },
  {
    value: "'Times New Roman'",
    label: 'Times（衬线）',
    stack: `'Times New Roman', Times, 'SimSun', serif`,
  },
  {
    value: 'Consolas',
    label: 'Consolas（等宽）',
    stack: `Consolas, 'SF Mono', Menlo, 'Courier New', monospace`,
  },
  {
    value: "'Courier New'",
    label: 'Courier（等宽）',
    stack: `'Courier New', Courier, monospace`,
  },
  {
    value: 'Verdana',
    label: 'Verdana（易读）',
    stack: `Verdana, Geneva, 'PingFang SC', sans-serif`,
  },
  {
    value: 'cursive',
    label: '手写体',
    stack: `'Segoe Script', 'Bradley Hand', cursive`,
  },
]

/** 具名字体清单注册表：manifest 里用 `fonts: 'ui'` 引用 */
export const FONT_SETS: Record<string, FontOption[]> = {
  ui: UI_FONTS,
}

export function getFontSet(name: string | undefined): FontOption[] | undefined {
  return FONT_SETS[name ?? 'ui'] ?? FONT_SETS.ui
}

/** 按值查字体项（用于预览当前选中项） */
export function findFont(name: string | undefined, value: string | undefined): FontOption | undefined {
  if (!value) return undefined
  return getFontSet(name)?.find((f) => f.value === value)
}
