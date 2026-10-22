/**
 * 卡片间拖放（插件发起、宿主仲裁）
 * ------------------------------------------------------------
 * 场景：插件内部有一个条目列表（便签的标题标签栏），用户拖动其中一个条目：
 *   · 在**本卡片内**松手  → 只改顺序
 *   · 在**另一个同插件窗口**上松手 → 并进那个窗口
 *   · 在**所有卡片之外**松手 → 变成一张独立的新窗口
 *
 * 为什么必须由宿主仲裁：
 *   插件跑在 iframe 里，既看不见别的卡片在哪，也不能新建窗口或改别的
 *   窗口的配置。它只能报告「我在拖哪个条目、鼠标现在在父页面视口的哪个
 *   坐标」；「鼠标底下是哪张卡片」只有宿主知道。
 *
 * 两个事件的分工（都在 window 上，避免给组件串一串回调）：
 *   CARD_ITEM_DRAG  插件 → 宿主：拖动阶段与坐标（IframeHost 转发成事件）
 *   落点判定结果     宿主 → 插件：直接 postMessage 回 iframe（sendItemDrop）
 *
 * 「拆成新窗口 / 并入别的窗口」**不需要**插件再发一个请求：宿主在松手
 * 那一刻已经知道落点，自己把两个窗口的 config 改好即可，插件只等
 * workbench:config 回来重渲染。少一条消息就少一处会不同步的状态。
 *
 * 坐标约定：一律是**父页面视口坐标**（CSS px）。插件侧用
 * frameElement 的 rect 与自身视口宽做换算 —— iframe 被画布
 * transform 缩放过，直接用 clientX 会偏。详见 12-sticky-notes.html。
 */

/** 插件 → 宿主：拖动阶段变化（detail 见 CardItemDragDetail） */
export const CARD_ITEM_DRAG = 'workbench:card-item-drag'

/** 落点种类：本卡片内 / 并入别的同插件窗口 / 拆成新窗口 / 无效 */
export type DropKind = 'own' | 'merge' | 'tearout' | 'none'

/** 插件发来的拖动事件内容 */
export interface CardItemDragDetail {
  /** 发起拖动的窗口 id */
  winId: string
  /** 插件的 manifest.id —— 判断能不能合并要看它 */
  pluginId: string
  /** 拖的是哪个条目 */
  itemId: string
  itemLabel?: string
  /**
   * 插件手上的**全部条目** id（顺序即默认顺序）。
   *
   * 随消息一起带来，宿主才能在松手那一刻直接算出「源窗口该剩哪些、
   * 目标窗口该有哪些」。否则宿主要先反问一遍插件的清单，来回握手 ——
   * 松手到生效之间会有肉眼可见的延迟。
   */
  allIds?: string[]
  phase: 'start' | 'move' | 'end' | 'cancel'
  /** 鼠标在父页面视口中的坐标 */
  x: number
  y: number
}

/** 宿主回给插件的落点判定 */
export interface CardItemDrop {
  kind: DropKind
  /** kind === 'merge' 时的目标窗口 id */
  targetWinId?: string
  /** 提示文案用的目标名字，如「快速便签 #2」 */
  targetLabel?: string
  /** 是否为最终判定（松手那一次）。插件只在 final 时真正动手 */
  final?: boolean
}

/**
 * 读一张卡片在视口中的矩形。
 *
 * 用 data-win-id 定位而不是遍历 React 树的 ref —— 仲裁逻辑写在 Desktop
 * 里，它对每张卡片的组件实例没有引用，DOM 查询是这里最直接的办法。
 */
export function cardRectOf(winId: string): DOMRect | null {
  const el = document.querySelector<HTMLElement>(`.plugin-card[data-win-id="${winId}"]`)
  return el ? el.getBoundingClientRect() : null
}

/** 落点处的卡片信息（没有命中任何卡片时返回 null） */
export function cardAtPoint(x: number, y: number): { winId: string; pluginId: string } | null {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.plugin-card[data-win-id]'))
  for (const el of cards) {
    const r = el.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return { winId: el.dataset.winId || '', pluginId: el.dataset.pluginId || '' }
    }
  }
  return null
}

/**
 * 把落点判定送回源插件的 iframe。
 *
 * 直接 postMessage 而不走 PluginBus：仲裁发生在 Desktop 里，它手里没有
 * 该卡片的 bus 实例；而 bus 的存在意义是「校验来源」，这里是宿主主动
 * 下发、方向相反，DOM 查到 iframe 直接发即可。
 */
export function sendItemDrop(winId: string, payload: CardItemDrop) {
  const el = document.querySelector<HTMLIFrameElement>(`.plugin-card[data-win-id="${winId}"] iframe`)
  try {
    el?.contentWindow?.postMessage({ type: 'pl:card-drop', ...payload }, '*')
  } catch {
    /* 跨源或 iframe 已卸载时忽略 */
  }
}
