/**
 * 界面显示比例读取
 * ------------------------------------------------------------
 * 显示比例以 CSS zoom 施加在根元素上，同时写入 `--ui-scale` 变量。
 *
 * 为什么需要它：CSS zoom 下存在两套坐标
 *   - `getBoundingClientRect()` / `window.innerWidth` → **缩放后**（视觉）坐标
 *   - 样式里的 `top` / `right` / `width` / `maxHeight` 等长度 → **缩放前**（布局）坐标
 * 二者相差一个 zoom 倍率。混用会导致定位偏移（例如 150% 下设置面板跑偏 154px）。
 * 需要按视觉位置摆放元素时，务必用本模块的换算。
 */

/** 读取当前界面显示比例（默认 1） */
export function readUiScale(): number {
  if (typeof document === 'undefined') return 1
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/** 视觉坐标 → 布局坐标（用于写入 style 的长度值） */
export function toLayoutPx(visualPx: number, scale = readUiScale()): number {
  return visualPx / scale
}

/** 布局坐标 → 视觉坐标 */
export function toVisualPx(layoutPx: number, scale = readUiScale()): number {
  return layoutPx * scale
}

/**
 * 鼠标位移（视觉像素）→ 画布坐标位移。
 *
 * 画布内的卡片坐标要经过两级缩放才呈现到屏幕上：
 *   1. 桌面画布自身的 transform: scale(desktopZoom)
 *   2. 界面显示比例的 CSS zoom(uiScale)
 * 因此换算时两级都要除掉，否则拖动会「跑得比鼠标快」。
 */
export function visualDeltaToCanvas(deltaVisualPx: number, desktopZoom = 1): number {
  const z = desktopZoom * readUiScale()
  return z > 0 ? deltaVisualPx / z : deltaVisualPx
}
