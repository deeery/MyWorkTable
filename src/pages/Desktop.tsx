import { useEffect, useState, useRef } from 'react'
import type { PluginView } from '../core/storage'
import { useApp } from '../state/AppContext'
import { PluginCard, CARD_DRAG_EVENT, CARD_RESIZE_EVENT } from '../components/PluginCard'
import { OPEN_DOCK_EVENT } from '../components/PluginDock'
import { SIZE_W, SIZE_MIN_H } from '../components/sizes'
import { getCardActions } from '../core/cardActions'
import { isDesktop, onDesktopCommand, showContextMenu } from '../core/desktop'
import {
  CARD_ITEM_DRAG, cardAtPoint, cardRectOf, sendItemDrop,
} from '../core/cardDrag'
import type { CardItemDragDetail, DropKind } from '../core/cardDrag'

const MIN_ZOOM = 0.15
const MAX_ZOOM = 6

/**
 * 贴边滚动 / 自适应缩边的参数。
 *
 * 动机：卡片按画布坐标定位，鼠标顶到屏幕边缘就动不了了，而卡片还没
 * 到位 —— 鼠标与卡片「分离」。两种缓解手段各有分工：
 *
 *   拖动卡片 → 贴边滚动：卡片在画布坐标里前进、画布反向平移，
 *              卡片视觉上停在鼠标下，而新区域不断露出来。
 *              速度由卡片侧按**时间**算好（EDGE_SPEED px/秒），
 *              这里只消费它发来的本帧位移。
 *   改卡片尺寸 → 自适应缩边：把显示比例调小，让卡片留在视野里。
 *
 *   EDGE_ZONE     距视口边缘多少像素内算「贴边」
 *   MIN_DRAG_ZOOM 缩边的下限（不会缩到看不清）
 */
const EDGE_ZONE = 90
const MIN_DRAG_ZOOM = 0.35

/**
 * 把平移量限制在「画布始终覆盖视口」的范围内，画布比视口小时则居中。
 * 这样用户不会把桌面拖出视野之外而找不回来。
 */
function clampPan(
  tx: number, ty: number, z: number,
  vw: number, vh: number, cw: number, ch: number,
): { x: number; y: number } {
  const sw = cw * z
  const sh = ch * z
  const axis = (t: number, viewport: number, content: number) =>
    content <= viewport
      ? (viewport - content) / 2
      : Math.min(0, Math.max(viewport - content, t))
  return { x: axis(tx, vw, sw), y: axis(ty, vh, sh) }
}

/** 桌面：自由画布（拖动背景平移 + 滚轮缩放）· 卡片拖拽移动 · 右下角任意比例缩放 */
export function Desktop() {
  const { installed, setEnabled, uninstall, setFocusedId, closeWindow, setConfig, openWindow } = useApp()
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)

  // 桌面壳的命令处理器在挂载时注册一次，需通过 ref 读到最新的窗口列表
  const installedRef = useRef(installed)
  installedRef.current = installed

  /**
   * 卡片间拖放仲裁也只在挂载时注册一次（它挂的是 window 事件），
   * 但松手时要调 setConfig / openWindow —— 同样用 ref 镜像最新引用，
   * 否则闭包会一直拿着首次渲染的那份。
   */
  const setConfigRef = useRef(setConfig)
  setConfigRef.current = setConfig
  const openWindowRef = useRef(openWindow)
  openWindowRef.current = openWindow

  /**
   * 给窗口 id 配一个「#N」后缀，做成提示文案（如「快速便签 #2」）。
   *
   * 序号按同一插件在当前工作台的**可见**窗口顺序算，与卡头顶栏那个
   * `#N` 徽标同一套规则 —— 否则用户看到的卡片写着 #2，提示里却说 #1。
   */
  const ordinalLabel = (winId: string): string => {
    const list = installedRef.current.filter((p) => p.visible && p.id)
    const me = list.find((p) => p.id === winId)
    if (!me) return ''
    const same = list.filter((p) => p.pluginId === me.pluginId)
    const idx = same.findIndex((p) => p.id === winId)
    return same.length > 1 && idx >= 0 ? ` #${idx + 1}` : ''
  }

  // 只有「可见 + 插件已启用 + 不是悬浮插件」的窗口才渲染卡片：
  // 插件停用后其宿主返回 null，若仍参与布局就会在桌面上留下一个空壳。
  //
  // 悬浮插件（manifest.overlay，如桌宠）排除在外：它们由 OverlayHost
  // 以 fixed 浮动层渲染，不占桌面坐标。混进来会让布局算法给一个
  // 不存在的卡片留出空位。
  //
  // 注意这里是**窗口**级过滤：同一插件的多个窗口各算一张卡片，
  // 所以下面渲染时 key 必须用窗口 id，不能用插件 id。
  const onDesktopAll = installed.filter((p) => p.visible && p.enabled && !p.manifest.overlay)

  /**
   * 分页器已移除。
   *
   * 原本每页只显示 4 个插件用于验收，但它与「工作台」的语义重叠：
   * 两者都是「切换一组插件视图」，用户面对两套切换机制会困惑
   * （想换一组插件到底该点标签还是点箭头？）。
   * 现在统一由工作台承担这件事 —— 要分屏看就新建一个工作台。
   */
  const onDesktop = onDesktopAll

  const maxBottom = onDesktop.reduce((max, p) => {
    const bottom = (p.y ?? 0) + (p.h ?? SIZE_MIN_H[p.size])
    return Math.max(max, bottom)
  }, 0)
  const maxRight = onDesktop.reduce((max, p) => {
    const right = (p.x ?? 0) + (p.w ?? SIZE_W[p.size])
    return Math.max(max, right)
  }, 0)
  const canvasW = Math.max(4000, maxRight + 400)
  const canvasH = Math.max(4000, maxBottom + 400)

  // 原生事件与 rAF 回调需要读到最新值，用 ref 镜像一份
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const panRef = useRef(pan)
  panRef.current = pan
  const sizeRef = useRef({ w: canvasW, h: canvasH })
  sizeRef.current = { w: canvasW, h: canvasH }

  /** 视口尺寸（用于限位与缩放锚点） */
  const viewportSize = () => {
    const r = viewportRef.current?.getBoundingClientRect()
    return { w: r?.width ?? 0, h: r?.height ?? 0 }
  }

  /** 以某个视口坐标为锚点缩放，锚点下的内容保持不动 */
  const applyZoom = (nextZoom: number, anchorX: number, anchorY: number) => {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom))
    const old = zoomRef.current
    if (z === old) return
    const { x: tx, y: ty } = panRef.current
    // 变换为 screen = translate ∘ scale，故 local = (screen - t) / z
    const lx = (anchorX - tx) / old
    const ly = (anchorY - ty) / old
    const vp = viewportSize()
    const next = clampPan(
      anchorX - z * lx, anchorY - z * ly, z,
      vp.w, vp.h, sizeRef.current.w, sizeRef.current.h,
    )
    setZoom(z)
    setPan(next)
  }

  // 滚轮缩放需要 preventDefault，而 React 的 onWheel 以 passive 方式注册，
  // 在其中调用 preventDefault 无效（仅打印告警）。故改用原生非 passive 监听。
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      applyZoom(zoomRef.current * delta, e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
    // applyZoom 只读 ref，无需进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 贴边滚动：卡片贴到视口边缘时，画布**反向**平移。
   *
   * ⚠ 这里只负责「平移画布」这一半，另一半在 PluginCard 里
   *   （卡片自己在画布坐标里前进）。两半必须同时做：
   *     卡片前进 +px  →  画布平移 −px  →  卡片在屏幕上原地不动
   *   早先只做了画布平移这一半，结果卡片被画布带着往**反方向**跑 ——
   *   用户看到的是「工作台飞快地动、窗口却不动」。
   *
   * ⚠ 速度由卡片侧按时间算好（px/秒 → 本帧位移），这里直接消费
   *   detail.dx / detail.dy，不再自己按 mousemove 次数推 ——
   *   按次数推会随事件频率失控（实测 1400+ px/s，飞快）。
   *
   * ⚠ 这里**绝不改缩放**。缩放只归「改尺寸」管（见下面的 resize 监听）。
   */
  const dragPanActiveRef = useRef(false)

  useEffect(() => {
    const onCardDrag = (e: Event) => {
      const d = (e as CustomEvent).detail as
        { phase: string; dx?: number; dy?: number } | undefined
      if (!d) return

      if (d.phase === 'start') {
        dragPanActiveRef.current = true
        return
      }
      if (d.phase === 'end') {
        dragPanActiveRef.current = false
        return
      }
      // 'pan' 由卡片的 rAF 每帧发出，带本帧要平移的屏幕像素
      if (d.phase !== 'pan' || !dragPanActiveRef.current) return
      if (!d.dx && !d.dy) return

      const vp = viewportSize()
      if (!vp.w || !vp.h) return

      const { x: tx, y: ty } = panRef.current
      setPan(clampPan(
        tx + (d.dx ?? 0), ty + (d.dy ?? 0), zoomRef.current,
        vp.w, vp.h, sizeRef.current.w, sizeRef.current.h,
      ))
    }

    window.addEventListener(CARD_DRAG_EVENT, onCardDrag)
    return () => window.removeEventListener(CARD_DRAG_EVENT, onCardDrag)
    // clampPan / viewportSize 只读 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 改卡片尺寸时的自适应缩边 —— 这是**唯一**会自动改缩放的地方。
   *
   * 场景：用户拖右下角把卡片改大，改到超出可视区就看不见把手了，
   * 没法继续改。这里在改尺寸过程中把显示比例调小，让卡片始终留在
   * 视野里；松手后**严格脱钩**，缩放回到改尺寸前的值。
   *
   * 用 ref 记「改尺寸前的缩放」，结束后原样还回去 ——
   * 不还的话改几次尺寸工作台就越来越小。
   */
  const resizeZoomBaseRef = useRef<number | null>(null)

  useEffect(() => {
    const onCardResize = (e: Event) => {
      const d = (e as CustomEvent).detail as { phase: string; x?: number; y?: number } | undefined
      if (!d) return

      if (d.phase === 'start') {
        resizeZoomBaseRef.current = zoomRef.current
        return
      }

      if (d.phase === 'end') {
        const base = resizeZoomBaseRef.current
        resizeZoomBaseRef.current = null
        // 严格脱钩：缩放回到改尺寸前的值
        if (base != null && Math.abs(base - zoomRef.current) > 0.005) {
          const vp = viewportSize()
          applyZoom(base, vp.w / 2, vp.h / 2)
        }
        return
      }

      if (d.phase !== 'move') return
      const base = resizeZoomBaseRef.current
      if (base == null) return

      const vp = viewportSize()
      if (!vp.w || !vp.h) return

      // 只在比原值更小时才生效 —— 用户本来缩得很小的话不该被放大
      const target = Math.max(MIN_DRAG_ZOOM, Math.min(base, base * 0.85))
      if (Math.abs(target - zoomRef.current) < 0.005) return
      applyZoom(target, d.x ?? vp.w / 2, d.y ?? vp.h / 2)
    }

    window.addEventListener(CARD_RESIZE_EVENT, onCardResize)
    return () => window.removeEventListener(CARD_RESIZE_EVENT, onCardResize)
    // applyZoom / viewportSize 只读 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 卡片间拖放仲裁 —— 插件拖动自己内部的条目（便签标题）时的落点判定。
   *
   * 分工：插件只报「我在拖哪个条目、鼠标在父页面视口的哪里、我手上有哪些
   * 条目」；「鼠标底下是哪张卡片、松手该做什么」全在这里决定。原因是插件
   * 跑在 iframe 里，看不见别的卡片，也不能新建窗口或改别的窗口的配置。
   *
   * 四种落点：
   *   own      还在源卡片内      → 松手只改顺序（插件自己排序后回报）
   *   merge    在另一个同插件窗口上 → 松手并进去，源窗口删去它
   *   tearout  在所有卡片之外     → 松手变成一张独立的新窗口
   *   none     在别的插件卡片上    → 松手取消
   *
   * ⚠ allIds 由插件随消息带来（便签数据是共享的一份，插件知道全部条目）。
   *   这是这里能算出「源窗口该剩哪些、目标窗口该有哪些」的前提 ——
   *   否则宿主要先问一遍插件的清单，来回握手，松手时会有可见的延迟。
   */
  useEffect(() => {
    /** 松手时要用：发起拖动的窗口 id 与全部条目 id */
    const dragCtxRef = { current: null as null | { winId: string; pluginId: string; itemId: string; allIds: string[] } }
    /** 上一次发出去的判定，避免每帧都 postMessage */
    let last = ''

    const computeKind = (d: CardItemDragDetail): DropKind => {
      const self = cardRectOf(d.winId)
      const insideSelf = !!self &&
        d.x >= self.left && d.x <= self.right && d.y >= self.top && d.y <= self.bottom
      if (insideSelf) return 'own'
      const hit = cardAtPoint(d.x, d.y)
      if (!hit) return 'tearout'
      return hit.pluginId === d.pluginId ? 'merge' : 'none'
    }

    const onItemDrag = (e: Event) => {
      const d = (e as CustomEvent).detail as CardItemDragDetail | undefined
      if (!d || !d.winId) return

      if (d.phase === 'start') {
        dragCtxRef.current = {
          winId: d.winId, pluginId: d.pluginId, itemId: d.itemId,
          allIds: Array.isArray(d.allIds) ? d.allIds.slice() : [],
        }
        last = ''
        return
      }

      if (d.phase === 'cancel') {
        dragCtxRef.current = null
        last = ''
        return
      }

      const ctx = dragCtxRef.current
      if (!ctx) return
      const kind = computeKind(d)
      const hit = kind === 'merge' ? cardAtPoint(d.x, d.y) : null
      const targetLabel = hit
        ? (installedRef.current.find((p) => p.id === hit.winId)?.manifest.name ?? '') +
          ordinalLabel(hit.winId)
        : undefined

      // 松手：真正动手
      if (d.phase === 'end') {
        dragCtxRef.current = null
        last = ''
        if (kind === 'none' || kind === 'own') {
          // 'own' 交给插件自己排序后回报（它知道拖到了第几个位置）
          sendItemDrop(ctx.winId, { kind, final: true })
          return
        }
        const srcView = installedRef.current.find((p) => p.id === ctx.winId)
        // 源窗口当前的归属：没写 notes 就是「全部」
        const srcList = srcView?.config?.notes
          ? srcView.config.notes.split(',').filter(Boolean)
          : ctx.allIds.slice()
        const rest = srcList.filter((id) => id !== ctx.itemId)

        if (kind === 'tearout') {
          // 拖出去就剩不下东西了 → 不让拆，否则源窗口会回落到「显示全部」
          if (!rest.length) {
            sendItemDrop(ctx.winId, { kind: 'none', final: true })
            return
          }
          setConfigRef.current(ctx.winId, { notes: rest.join(',') })
          // 新窗口**生来**只显示被拖出的那一张（config 随 openWindow 一起给），
          // 否则它会先渲染一帧全部便签再收窄，肉眼可见地闪
          openWindowRef.current(ctx.pluginId, { notes: ctx.itemId })
          /**
           * ⚠ 拆窗口 / 合并这两条**也必须**回一条 final。
           *
           * 原来只有 'own' 与 'none' 会回执，拆窗与合并直接把消息吞了：
           * 插件那边 `draggingId` / `pendingBeforeId` / `dragOutside` 三个
           * 状态永远不复位，`#tabs` 上的虚线框（class="out"）也摘不掉 ——
           * 标签栏会一直描着虚线，而且下一次拖动的起始状态是脏的。
           * 提示语（「已拆成独立窗口喵~」）更是永远不出现。
           */
          sendItemDrop(ctx.winId, { kind, final: true })
        } else if (kind === 'merge' && hit) {
          /**
           * ⚠ 先判断源窗口拆不拆得开，**再**动目标窗口。
           *
           * 原来反着写（先把条目塞进目标，再发现源窗口只剩一张而放弃），
           * 结果是条目同时留在两个窗口里：源窗口报 'none'（什么都没做），
           * 目标窗口却已经被加了这一条 —— 同一张便签出现在两个窗口。
           * 宁可整件事不做，也不能做一半。
           */
          if (!rest.length) {
            sendItemDrop(ctx.winId, { kind: 'none', final: true })
            return
          }
          const tgt = installedRef.current.find((p) => p.id === hit.winId)
          const tgtList = tgt?.config?.notes
            ? tgt.config.notes.split(',').filter(Boolean)
            : ctx.allIds.slice()
          if (!tgtList.includes(ctx.itemId)) tgtList.push(ctx.itemId)
          setConfigRef.current(hit.winId, { notes: tgtList.join(',') })
          setConfigRef.current(ctx.winId, { notes: rest.join(',') })
          // 同上：合并也要回 final，否则源插件的拖动状态与虚线框都留在原地
          sendItemDrop(ctx.winId, { kind, final: true, targetLabel })
        }
        return
      }

      if (d.phase !== 'move') return
      const sig = kind + '|' + (targetLabel ?? '')
      if (sig === last) return
      last = sig
      sendItemDrop(ctx.winId, { kind, targetLabel })
    }

    window.addEventListener(CARD_ITEM_DRAG, onItemDrag)
    return () => window.removeEventListener(CARD_ITEM_DRAG, onItemDrag)
    // 只读 ref，无需依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 在背景（非卡片区域）按下鼠标即开始平移画布
  const panStartRef = useRef<{ mx: number; my: number; tx: number; ty: number } | null>(null)

  const onViewportMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    // 落在卡片上的按下由 PluginCard 自己处理（拖拽移动 / 缩放 / 交互）
    if ((e.target as HTMLElement).closest('.plugin-card')) return
    panStartRef.current = { mx: e.clientX, my: e.clientY, tx: pan.x, ty: pan.y }
    setPanning(true)
    e.preventDefault()
  }

  useEffect(() => {
    if (!panning) return
    const onMove = (e: MouseEvent) => {
      const s = panStartRef.current
      if (!s) return
      const vp = viewportSize()
      setPan(clampPan(
        s.tx + (e.clientX - s.mx), s.ty + (e.clientY - s.my), zoomRef.current,
        vp.w, vp.h, sizeRef.current.w, sizeRef.current.h,
      ))
    }
    const onUp = () => {
      setPanning(false)
      panStartRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [panning])

  /** 双击背景复位视图 */
  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  // 桌面壳：接收原生菜单命令并分发到对应卡片 / 视图操作
  useEffect(() => {
    if (!isDesktop()) return
    return onDesktopCommand((cmd) => {
      /**
       * ⚠ cmd.id 是**窗口 id**（PluginCard 的右键菜单用 plugin.id 发的），
       * 不是插件 id。多窗口改造后这一点很关键：
       *   - 卡片级操作（刷新/设置/还原尺寸/聚焦）直接按窗口 id 查
       *   - 插件级操作（停用/卸载）与窗口无关，但要从窗口反查插件
       *   - 「移出桌面」原本是插件级的 setVisible(pluginId)，现在语义
       *     改成「关闭这个窗口」—— 右键菜单的文案也已同步
       */
      const win = 'id' in cmd ? installedRef.current.find((x) => x.id === cmd.id) : undefined
      switch (cmd.type) {
        case 'refresh': getCardActions(cmd.id)?.refresh(); break
        case 'settings': getCardActions(cmd.id)?.openSettings(); break
        case 'reset-size': getCardActions(cmd.id)?.resetSize(); break
        case 'focus': setFocusedId(cmd.id); break
        // 「移出桌面」= 关掉这个窗口
        case 'toggle-visible': closeWindow(cmd.id); break
        case 'toggle-enabled': {
          if (win) setEnabled(win.pluginId, !win.enabled)
          break
        }
        case 'uninstall': if (win) uninstall(win.pluginId); break
        // 「新建窗口」→ 唤起插件坞（唯一的添加入口）。
        // 插件坞挂在 App 层，与本组件不在同一子树，用 window 事件打通。
        case 'open-add': window.dispatchEvent(new CustomEvent(OPEN_DOCK_EVENT)); break
        case 'reset-view': resetView(); break
        case 'zoom-in': applyZoom(zoomRef.current * 1.1, 0, 0); break
        case 'zoom-out': applyZoom(zoomRef.current * 0.9, 0, 0); break
      }
    })
    // 命令处理器只读 ref 与稳定引用，无需随状态重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 桌面壳：右键空白处 → 原生菜单
  const onViewportContextMenu = (e: React.MouseEvent) => {
    if (!isDesktop()) return
    if ((e.target as HTMLElement).closest('.plugin-card')) return // 卡片自己处理
    e.preventDefault()
    showContextMenu({ kind: 'blank' })
  }

  return (
    <>
      {onDesktop.length === 0 ? (
        <div className="empty-tip">
          这个工作台还是空的 · 点右下角的「新建窗口」从插件坞里挑一个放上来
        </div>
      ) : (
        <div
          ref={viewportRef}
          className={`desktop-viewport${panning ? ' panning' : ''}`}
          onMouseDown={onViewportMouseDown}
          onDoubleClick={resetView}
          onContextMenu={onViewportContextMenu}
          title="拖动空白处平移 · 滚轮缩放 · 双击复位"
        >
          <div
            className="desktop-canvas"
            style={{
              width: canvasW,
              height: canvasH,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            {onDesktop.map((p) => (
              <PluginCard
                /* key 用**窗口 id**：同一插件的多个窗口若共用插件 id 做 key，
                   React 会认为它们是同一个组件，只渲染出一张卡片 */
                key={p.id}
                plugin={p}
                x={p.x ?? 40}
                y={p.y ?? 40}
                scale={zoom}
              />
            ))}
          </div>

        </div>
      )}

      {/* 「＋新建窗口」按钮已移除 —— 它与右下角的插件坞功能完全重叠
          （都是「列出插件 → 点一下放到桌面」），两个入口做同一件事
          只会让人猜该点哪个。现在插件坞是唯一的添加入口，
          桌面右键菜单的「新建窗口」也改成唤起插件坞（见下方 open-add）。 */}
    </>
  )
}
