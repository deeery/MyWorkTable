import type { CardSize } from '../types/plugin'

/**
 * 卡片尺寸与默认摆放
 * ------------------------------------------------------------
 * 这里是尺寸与坐标分配的唯一来源。此前 storage.ts 与 AppContext.tsx
 * 各有一套互不兼容的摆放算法（一套按真实卡片尺寸做碰撞检测，另一套
 * 假设固定 320×220 网格），导致初次加载与后续「安装/上桌面」得到的
 * 位置规则不一致，新卡片可能与已有卡片重叠。
 */

/** 卡片宽度（像素） */
export const SIZE_W: Record<CardSize, number> = { S: 280, M: 480, L: 720, XL: 960 }
/** 卡片最小高度（像素） */
export const SIZE_MIN_H: Record<CardSize, number> = { S: 180, M: 220, L: 260, XL: 300 }

/** 卡片间留白 */
export const GAP = 20
/** 画布左上角起始内边距 */
export const ORIGIN = 40

/** 已占用区域（用于碰撞检测） */
export interface OccupiedBox {
  x: number
  y: number
  w: number
  h: number
}

/** 取卡片的实际尺寸：用户手动缩放过的以 w/h 为准，否则回退到尺寸档位 */
export function cardSize(size: CardSize, w?: number, h?: number): { w: number; h: number } {
  return { w: w ?? SIZE_W[size], h: h ?? SIZE_MIN_H[size] }
}

/** 把插件状态转成碰撞检测用的矩形 */
export function occupiedBoxOf(p: {
  visible: boolean
  x?: number
  y?: number
  w?: number
  h?: number
  size: CardSize
}): OccupiedBox | null {
  if (!p.visible || p.x == null || p.y == null) return null
  const { w, h } = cardSize(p.size, p.w, p.h)
  return { x: p.x, y: p.y, w, h }
}

/**
 * 画布可用宽度（像素）
 * ------------------------------------------------------------
 * 必须量「桌面画布」本身，而不是 window.innerWidth。
 *
 * 画布右侧还留着侧边栏（详细形态 216px），用 window.innerWidth 算列数
 * 会多算一列，新窗口被摆到画布外 —— 表现为卡片右半边被裁掉、或者压根
 * 看不见（用户以为「新建窗口没生效」）。窄屏 + 详细侧边栏时尤其明显。
 *
 * 取不到元素时（首帧、SSR、单元测试）回退到窗口宽度，行为与旧版一致。
 */
export function desktopViewportWidth(): number {
  if (typeof document !== 'undefined') {
    const vp = document.querySelector('.desktop-viewport')
    if (vp && vp.clientWidth > 0) return vp.clientWidth
    // 不在桌面页时（比如从插件页点「＋ 新建窗口」）没有画布可量，
    // 退而求其次量内容区 .main —— 它同样不含侧边栏宽度。
    const main = document.querySelector('.main')
    if (main && main.clientWidth > 0) return main.clientWidth
  }
  return typeof window !== 'undefined' ? window.innerWidth : 1440
}

/**
 * 为一张 w×h 的卡片找一个不与任何已占用矩形重叠的位置。
 *
 * 候选点按「被放置卡片自身的尺寸」推进，因此大卡片不会被塞进小卡片
 * 的缝隙里；列数由画布宽度决定，优先铺满一行再换行。
 */
export function findFreePosition(
  occupied: OccupiedBox[],
  w: number,
  h: number,
  viewportW?: number,
): { x: number; y: number } {
  const vw = viewportW ?? desktopViewportWidth()
  // 至少保证一列能放下（画布比卡片还窄时也摆在起点，靠拖动调整）
  const cols = Math.max(1, Math.floor((vw - ORIGIN * 2 + GAP) / (w + GAP)))
  const MAX_ROWS = 200

  const overlaps = (x: number, y: number) =>
    occupied.some(
      (o) => x < o.x + o.w + GAP && x + w > o.x - GAP && y < o.y + o.h + GAP && y + h > o.y - GAP,
    )

  for (let row = 0; row < MAX_ROWS; row++) {
    for (let col = 0; col < cols; col++) {
      const x = ORIGIN + col * (w + GAP)
      const y = ORIGIN + row * (h + GAP)
      if (!overlaps(x, y)) return { x, y }
    }
  }

  // 兜底：整屏都排满时阶梯式外扩，避免所有卡片叠在同一点
  return { x: ORIGIN + occupied.length * 24, y: ORIGIN + occupied.length * 24 }
}
