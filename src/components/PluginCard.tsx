import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type { PluginView } from '../core/storage'
import { useApp } from '../state/AppContext'
import { IframeHost } from './IframeHost'
import { ModuleHost } from './ModuleHost'
import { SettingsPanel } from './SettingsPanel'
import {
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconCollapse,
  IconDuplicate,
  IconExpand,
  IconGear,
  IconRefresh,
  IconReset,
} from './icons'
import { registerCardActions } from '../core/cardActions'
import { isDesktop, showContextMenu } from '../core/desktop'
import { readUiScale, toLayoutPx, visualDeltaToCanvas } from '../core/uiScale'
import { SIZE_W, SIZE_MIN_H } from './sizes'
import type { CompactDescription, CompactHostMessage, CompactPluginMessage } from '../types/plugin'

/**
 * 卡片拖拽事件（window 级）。
 *
 * detail.phase:
 *   'start' 按下顶部栏开始拖
 *   'move'  拖动中，带鼠标视口坐标 { x, y }
 *   'end'   松手
 *
 * Desktop 监听它来做「拖到窗口边缘时自动缩小工作台显示比例」。
 * 用 window 事件而不是 props 回调：缩放状态归 Desktop 管，
 * 卡片与 Desktop 之间隔着画布层，加一串回调反而更绕。
 */
export const CARD_DRAG_EVENT = 'workbench:card-drag'

/**
 * 卡片改尺寸事件（window 级）。
 *
 * detail.phase:
 *   'start' 按下边缘把手开始改尺寸
 *   'move'  改尺寸中，带鼠标视口坐标 { x, y }
 *   'end'   松手
 *
 * ⚠ 与 CARD_DRAG_EVENT（拖动移动）分开，是因为两者对缩放的处理**完全相反**：
 *   拖动 → 只平移画布，绝不改缩放（鼠标顶到边缘就推着画布走）
 *   改尺寸 → 可以缩小显示比例（否则卡片改大到超出视口后就没法继续改）
 * 早先把两者混在一个事件里，结果拖动也会触发缩放，手感很怪。
 */
export const CARD_RESIZE_EVENT = 'workbench:card-resize'

/** 卡片可缩放的最小尺寸 */
const MIN_W = 200
const MIN_H = 120

/**
 * 贴边滚动的参数（与 Desktop 里那份保持一致）。
 *
 * EDGE_ZONE   距视口边缘多少像素内算「贴边」
 * EDGE_SPEED  贴满边时卡片前进的**屏幕速度**（px/秒）
 *
 * 用「px/秒」而不是「px/次」：mousemove 的触发频率随系统与设备变化，
 * 按次数推会让速度完全失控（实测 14px/次 → 1400+ px/s，飞快）。
 */
const EDGE_ZONE = 90
const EDGE_SPEED = 420

/**
 * 切到「完整内容」时卡片的高度。
 *
 * 插件是按 400px 宽 / 500~2000px 高设计的，所以必须给足高度 ——
 * 早先用 M 档的「最小高度」220px，只能露出一条缝，用户要一路滚动。
 * 640 是个折中：能看下大半个界面，又不会高到超出常见视口。
 * 用户仍可自行拖右下角调整。
 */
const FULL_VIEW_H = 640

/**
 * 插件卡片：顶部栏拖拽移动 · 右侧/下侧/右下角分别缩放 · 齿轮设置面板。
 *
 * 设置面板不再按插件 id 硬编码在宿主里，而是由 manifest.settings 声明、
 * SettingsPanel 通用渲染 —— 第三方插件也能自带设置界面。
 */
export function PluginCard({
  plugin,
  x,
  y,
  scale = 1,
}: {
  plugin: PluginView
  x: number
  y: number
  /** 桌面当前缩放倍率：鼠标位移是屏幕像素，需除以它换算成画布坐标 */
  scale?: number
}) {
  const { setSize, setDim, setPosition, setFocusedId, focusedId, setConfig, setCollapsed, closeWindow, openWindow, installed } = useApp()
  const tickRef = useRef<(() => void) | null>(null)
  /**
   * 精简形态设置通道。IframeHost 挂载后把 { send, subscribe } 填进来。
   *
   * 精简组件在宿主卡片里没有齿轮与浮层菜单（只出内容），
   * 它的格式/尺寸/选项改由卡片设置面板的二级界面控制，
   * 就靠这条通道：宿主 send 下去，插件回报上来。
   */
  const cwRef = useRef<{
    send: (m: CompactHostMessage) => void
    subscribe: (fn: (m: CompactPluginMessage) => void) => () => void
  } | null>(null)
  const m = plugin.manifest
  const isManual = m.refresh.intervalMs === 0
  const isStatic = m.refresh.intervalMs === -1
  const [showSettings, setShowSettings] = useState(false)
  /** 顶部栏收起状态（持久化在插件状态里） */
  const collapsed = !!plugin.collapsed
  /** 精简形态清单（插件自报）；null = 还没拿到或该插件无精简形态 */
  const [cwDesc, setCwDesc] = useState<CompactDescription | null>(null)

  /**
   * 是否精简形态。config.view 为 'full' 时是完整内容，否则都是精简。
   * 提前到 state 之前算 —— 「精简设置默认展开」要用它当初值。
   */
  const isCompactView = plugin.config?.view !== 'full'

  /**
   * 设置面板是否停在「精简设置」二级界面。
   *
   * 初值跟着形态走：精简形态下默认展开。因为精简组件里没有自己的齿轮
   * 与浮层菜单，这一段就是它全部的设置入口 —— 藏起来还要多点一次，
   * 而它恰好是这个形态下用户最常调的东西（格式 / 尺寸）。
   * 完整形态则整个入口都不渲染（见下方 m.compact && isCompactView 判断）。
   */
  const [showCwSettings, setShowCwSettings] = useState(isCompactView)

  /**
   * 当前形态的字符串标识，专用于给下面几个 effect 当依赖。
   *
   * 切形态会让 iframe 换 URL 并重挂载，cwRef 随之被清空；
   * 用这个值当依赖就能让订阅跟着重建（详见下方 effect 的注释）。
   */
  const viewKey = plugin.config?.view === 'full' ? 'full' : 'compact'

  /**
   * 订阅插件自报的精简设置。
   *
   * 组件自己也会改状态（例如格式切换后重绘），但现在它内部没有菜单了，
   * 唯一改动来源是这里 —— 所以宿主面板必须能反映插件侧的任何变化。
   */
  useEffect(() => {
    const ch = cwRef.current
    if (!ch || !m.compact) return
    const off = ch.subscribe((msg) => {
      if (msg.type === 'cw:state' && msg.desc) setCwDesc(msg.desc)
    })
    // 面板打开时主动问一次，覆盖「插件先于订阅初始化」的时序
    ch.send({ type: 'cw:describe' })
    return off
    /**
     * ⚠ 依赖里必须带 viewKey（当前形态），不能只有 [m.compact, showSettings]。
     *
     * 切换「精简 ↔ 完整」会换 iframe 的 URL，IframeHost 因 key 变化而
     * 重挂载，其 cleanup 会把 cwRef.current 置为 null。而本 effect 的
     * 两个依赖都没变 → 不会重新订阅 → cwRef.current 一直是 null，
     * applyCw 发不出去。
     *
     * 症状正是用户报告的「切换过完整内容后，精简设置就无点击反馈了」：
     * 面板照常渲染（cwDesc 还是切走前的旧值，所以看起来一切正常），
     * 点按钮却毫无反应。
     */
  }, [m.compact, showSettings, viewKey])

  /**
   * 二级界面每次展开都重新问一次清单。
   *
   * 默认展开后不能再依赖「用户点按钮时才问」—— 面板可能是在插件
   * 还没上报过清单时就打开的（首屏、刚切形态），此时 cwDesc 为 null
   * 会一直显示「正在向插件取精简设置…」。
   */
  useEffect(() => {
    if (!m.compact || !isCompactView || !showCwSettings) return
    cwRef.current?.send({ type: 'cw:describe' })
  }, [m.compact, isCompactView, showCwSettings, viewKey])

  // 点击设置面板外部任意区域即关闭。
  //
  // 注意：iframe 插件内部的点击事件不会冒泡到宿主 document，
  // 仅靠 document 级监听无法覆盖「点插件内容区」这一情形。
  // 因此面板打开时额外铺一层透明遮罩盖住整张卡片（见 .settings-shield），
  // 任何落在卡片上的点击都会先命中遮罩，从而关闭菜单。
  useEffect(() => {
    if (!showSettings) return
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.settings-panel') || t.closest('.gear')) return
      setShowSettings(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSettings(false) }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [showSettings])

  const cardW = plugin.w ?? SIZE_W[plugin.size]
  const cardH = plugin.h ?? SIZE_MIN_H[plugin.size]
  const isFocused = focusedId === plugin.id

  /**
   * 该窗口在「同一插件、当前工作台、**可见**」的窗口里的序号（1 起）。
   *
   * ⚠ 必须只数可见窗口。`installed` 里包含该插件所有窗口，其中有一些是
   * `visible: false` 的占位（新建工作台时给每个已安装插件补的那一份）。
   * 全算进去的话，桌面上唯一一张卡片会显示成 #2 甚至 #3 —— 用户看到
   * 「只有一张卡却写着 #3」，会以为还有两张没显示出来。
   *
   * 只在 >1 时显示，单窗口的插件不该多出一个 #1 徽标。
   */
  const windowOrdinal = useMemo(() => {
    const same = installed.filter((x) => x.pluginId === plugin.pluginId && x.visible)
    return same.findIndex((x) => x.id === plugin.id) + 1
  }, [installed, plugin.pluginId, plugin.id])

  // 拖拽移动（仅从顶部栏触发）
  const [local, setLocal] = useState({ x, y })
  const [dragging, setDragging] = useState(false)
  /**
   * 拖拽锚点：记录**上一次**鼠标位置与**上一次**的卡片位置。
   *
   * ⚠ 必须逐帧累加增量，不能记「起点 → 当前」的总位移再除以缩放。
   * 因为拖到窗口边缘时工作台会自动缩小显示比例（见 Desktop 的
   * 边缘自适应），缩放是**拖动过程中会变**的 ——
   * 用总位移除以当前缩放，前面那段按旧缩放走的距离会被按新缩放重算，
   * 卡片就会突然跳一下。
   * 逐帧增量用的永远是「这一帧的缩放」，天然正确。
   */
  const dragRef = useRef<{ mx: number; my: number; cx: number; cy: number } | null>(null)
  // 镜像最新位置，供 mouseup 提交（避免读到过期闭包，也避免在 updater 里做副作用）
  const localRef = useRef(local)
  localRef.current = local
  /** 缩放也要读最新的（拖动中会变），用 ref 避免闭包过期 */
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  /**
   * 鼠标当前位置（视口坐标）。
   *
   * 贴边滚动跑在 rAF 里，而 mousemove 是另一个回调 —— 用 ref 把最新
   * 鼠标位置传过去，rAF 每帧读一次即可，不必在 rAF 里也监听鼠标。
   */
  const mouseRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!dragging) setLocal({ x, y })
  }, [x, y, dragging])

  const onHeadMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.gear') || (e.target as HTMLElement).closest('button')) return
    setFocusedId(plugin.id)
    setDragging(true)
    dragRef.current = { mx: e.clientX, my: e.clientY, cx: local.x, cy: local.y }
    mouseRef.current = { x: e.clientX, y: e.clientY }
    // 通知 Desktop「开始拖卡片了」。用 window 事件而不是 props 回调：
    // 缩放/平移状态归 Desktop 管，而卡片与 Desktop 之间隔着画布层，
    // 加一串回调反而更绕。
    window.dispatchEvent(new CustomEvent(CARD_DRAG_EVENT, { detail: { phase: 'start' } }))
  }

  useEffect(() => {
    if (!dragging) return
    const onMouseMove = (e: MouseEvent) => {
      const s = dragRef.current
      if (!s) return
      mouseRef.current = { x: e.clientX, y: e.clientY }
      // 逐帧增量 → 画布位移（除掉桌面缩放与界面显示比例）
      const z = scaleRef.current
      const dx = visualDeltaToCanvas(e.clientX - s.mx, z)
      const dy = visualDeltaToCanvas(e.clientY - s.my, z)
      setLocal((cur) => ({ x: cur.x + dx, y: cur.y + dy }))
      // 更新锚点为「这一帧」，下一帧继续从这儿累加
      s.mx = e.clientX
      s.my = e.clientY
    }
    const onMouseUp = () => {
      setDragging(false)
      dragRef.current = null
      const cur = localRef.current
      setPosition(plugin.id, Math.round(cur.x), Math.round(cur.y))
      // 松手即脱钩：告诉 Desktop 停止边缘推动
      window.dispatchEvent(new CustomEvent(CARD_DRAG_EVENT, { detail: { phase: 'end' } }))
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragging, plugin.id, setPosition])

  /**
   * 贴边滚动：鼠标停在视口边缘时，让卡片继续往那个方向走。
   *
   * 为什么需要它：鼠标顶到屏幕边缘就再也动不了了，而卡片还没到位 ——
   * 表现为「鼠标与卡片分离」，用户没法把卡片拖到视口外或很远的地方。
   *
   * 做法（两步必须**同时**做，缺一个都是错的）：
   *   1. 卡片在**画布坐标**里前进 px/z（换算成画布单位）
   *   2. 画布**反向平移** −px，让卡片在屏幕上原地不动
   *   两者相消 → 卡片稳稳待在鼠标下，而画布内容向左/右滚动，
   *   于是「新区域不断露出来」，卡片可以一直走下去。
   *
   * ⚠ 早先只做了第 2 步（只平移画布），结果卡片被画布带着往**反方向**
   * 跑 —— 用户看到的是「工作台飞快地动、窗口却不动」。这是本条的关键。
   *
   * ⚠ 速度必须按**时间**算（px/秒），不能按「每次 mousemove 推 N px」：
   * mousemove 的触发频率随系统/设备变化（可能上百次/秒），
   * 按次数推会让速度完全失控（实测 14px/次 → 1400+ px/s，飞快）。
   * 用 rAF + dt 才与事件频率无关。
   */
  useEffect(() => {
    if (!dragging) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      /**
       * dt 夹在 0~80ms 之间。
       *
       * ⚠ 上限不能太小。早先夹的是 50ms，结果**掉帧时速度会变慢**：
       * 离屏窗口 rAF 只有 1fps（实测），每帧真实过了 1000ms 却只按
       * 50ms 算，速度掉到设定值的 1/20。用户拖到一半卡一下、
       * 或系统忙时掉帧，都会感觉「滚不动」。
       * 80ms 足够吸收偶发卡顿，又不至于切标签页回来时一次跳太远。
       */
      const dt = Math.max(0, Math.min(0.08, (now - last) / 1000))
      last = now
      const m = mouseRef.current
      if (m) {
        const vw = window.innerWidth
        const vh = window.innerHeight
        /**
         * 进入深度 −1~1：
         *   正 = 贴左/上边（卡片该继续往左上走）
         *   负 = 贴右/下边（往右下走）
         *   0  = 还没进边缘带
         */
        const depthX =
          m.x < EDGE_ZONE ? -(EDGE_ZONE - m.x) / EDGE_ZONE
            : m.x > vw - EDGE_ZONE ? (EDGE_ZONE - (vw - m.x)) / EDGE_ZONE
              : 0
        const depthY =
          m.y < EDGE_ZONE ? -(EDGE_ZONE - m.y) / EDGE_ZONE
            : m.y > vh - EDGE_ZONE ? (EDGE_ZONE - (vh - m.y)) / EDGE_ZONE
              : 0
        if (depthX || depthY) {
          const z = scaleRef.current || 1
          // 本帧要走的屏幕像素（越贴边越快）
          const px = depthX * EDGE_SPEED * dt
          const py = depthY * EDGE_SPEED * dt
          // 1) 卡片在画布坐标里前进
          setLocal((cur) => ({ x: cur.x + px / z, y: cur.y + py / z }))
          // 2) 画布反向平移，抵消掉屏幕上的位移 → 卡片视觉上不动
          window.dispatchEvent(new CustomEvent(CARD_DRAG_EVENT, {
            detail: { phase: 'pan', dx: -px, dy: -py },
          }))
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [dragging])

  /**
   * 边缘缩放：
   *   - 右侧手柄（e）：改宽度，左边固定
   *   - 左侧手柄（w）：改宽度，右边固定（同时移动 x）
   *   - 下侧手柄（s）：改高度
   *   - 右下角（se）：宽高同时改
   *
   * 用本地状态预览、松开后一次性提交，避免拖拽期间逐帧触发全局 re-render。
   */
  type ResizeEdge = 'e' | 'w' | 's' | 'se'
  const [resizing, setResizing] = useState<ResizeEdge | null>(null)
  const [resizeW, setResizeW] = useState(cardW)
  const [resizeH, setResizeH] = useState(cardH)
  // 左侧拖动时还需预览 x 位移（右边固定）
  const [resizeX, setResizeX] = useState(local.x)
  const resizeRef = useRef<{
    startX: number; startY: number; startW: number; startH: number; startLeft: number
  } | null>(null)
  // 镜像最新尺寸，供 mouseup 提交（避免读到过期闭包）
  const resizeSizeRef = useRef({ w: cardW, h: cardH, x: local.x })
  resizeSizeRef.current = { w: resizeW, h: resizeH, x: resizeX }

  const onResizeDown = (edge: ResizeEdge) => (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    // 严格判定：只有左键（button===0）按住把手才启动调整。
    // e.button 在 mousedown 里=触发的键（0=左键，2=右键…），右/中键一律不触发。
    if (e.button !== 0) return
    setFocusedId(plugin.id)
    setResizing(edge)
    setResizeW(cardW)
    setResizeH(cardH)
    setResizeX(local.x)
    resizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      startW: cardW, startH: cardH, startLeft: local.x,
    }
    // 告诉 Desktop「正在改尺寸」——它据此在卡片快超出可视区时自动缩小
    // 显示比例，让用户能继续把卡片改大。
    // 与拖动（phase='move'）区分开：拖动只平移画布，绝不改缩放。
    window.dispatchEvent(new CustomEvent(CARD_RESIZE_EVENT, {
      detail: { phase: 'start', edge },
    }))
  }

  useEffect(() => {
    if (!resizing) return
    const edge = resizing
    const onMouseMove = (e: MouseEvent) => {
      // 严格判定：左键必须按住（buttons 位 0 = 左键）才允许调整。
      // 位掩码：1=左键、2=右键、4=中键… 一旦左键松开，立刻停止调整。
      if ((e.buttons & 1) === 0) { onMouseUp(); return }
      const s = resizeRef.current
      if (!s) return
      // 屏幕位移 → 画布位移：需同时除掉桌面缩放与界面显示比例
      const dx = visualDeltaToCanvas(e.clientX - s.startX, scale)
      const dy = visualDeltaToCanvas(e.clientY - s.startY, scale)

      if (edge === 'e' || edge === 'se') {
        setResizeW(Math.round(Math.max(MIN_W, s.startW + dx)))
      }
      if (edge === 'w') {
        // 左边拖动：右边固定，故宽度减少量等于 x 增加量。
        // 宽度触底时 x 不再继续移动，避免卡片整体被推走。
        const nextW = Math.max(MIN_W, s.startW - dx)
        setResizeW(Math.round(nextW))
        setResizeX(Math.round(s.startLeft + (s.startW - nextW)))
      }
      if (edge === 's' || edge === 'se') {
        setResizeH(Math.round(Math.max(MIN_H, s.startH + dy)))
      }
      // 把当前预览尺寸告诉 Desktop：卡片若快超出可视区，它会缩小显示比例
      window.dispatchEvent(new CustomEvent(CARD_RESIZE_EVENT, {
        detail: { phase: 'move', x: e.clientX, y: e.clientY },
      }))
    }
    const onMouseUp = () => {
      setResizing(null)
      const cur = resizeSizeRef.current
      setDim(plugin.id, cur.w, cur.h)
      // 左侧拖动改变了 x（右边固定），需一并提交位置
      if (edge === 'w') setPosition(plugin.id, cur.x, local.y)
      // 松手即脱钩：缩放回到改尺寸前的值，鼠标不再影响任何东西
      window.dispatchEvent(new CustomEvent(CARD_RESIZE_EVENT, { detail: { phase: 'end' } }))
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [resizing, plugin.id, setDim, setPosition, scale, local.y])

  // 还原尺寸
  const handleReset = () => {
    setDim(plugin.id, SIZE_W[m.defaultSize ?? 'M'], SIZE_MIN_H[m.defaultSize ?? 'M'])
    setSize(plugin.id, m.defaultSize ?? 'M')
    setShowSettings(false)
  }

  // 设置面板由 manifest.settings 声明，宿主通用渲染
  const hasSettings = !!m.settings?.fields?.length
  const setPluginConfig = (patch: Record<string, string>) => setConfig(plugin.id, patch)

  /**
   * 形态切换：写入 config.view，并把卡片尺寸调整到该形态的合适值。
   *
   * 为什么必须一起改尺寸：两种形态的内容体量差一个数量级。
   *   精简 → 小组件固定 140×140（S 卡片 280×180 刚好容纳，留白舒适）
   *   完整 → 插件按 400px 宽设计，内容高度常在 500~2000px，
   *          塞进 S 卡片会只剩一条缝，看什么都要滚动
   * 不调整的症状：来回切几次，卡片尺寸就停留在上一次形态的值上，
   * 精简形态在大卡片里孤零零一小块，完整形态则被裁得只剩顶部几十像素。
   *
   * 只改尺寸，不动位置 —— 用户的左上角坐标是刻意摆过的，
   * 切换形态不该让卡片在桌面上「跳」到别处。
   */
  /** 把改动送进插件的精简设置。插件是唯一权威：它落盘、重绘并回报新状态。 */
  const applyCw = (patch: { format?: string; size?: string; opts?: Record<string, unknown> }) => {
    cwRef.current?.send({ type: 'cw:apply', patch })
  }

  /** 当前生效的格式 id（清单里已带回 format 时以它为准） */
  const activeFmt = cwDesc?.format ?? ''

  const switchView = (view: 'compact' | 'full') => {
    if (plugin.config?.view === view) return
    setPluginConfig({ view })
    /**
     * 切换形态时给卡片一个合适的**高度**。
     *
     * 精简 → S 档（280×180）就够，小组件本来就是小方块。
     * 完整 → 必须给足高度。这里原来用 M 档（480×220），但插件是按
     *   400px 宽 / 500~2000px 高设计的，220px 只能露出一条缝 ——
     *   用户报告「许多插件切换到完整内容时高度过低」就是这个原因。
     *   改成显式指定一个够高的尺寸（宽 480 / 高 640），而不是套用
     *   SIZE_MIN_H 里那个「最小高度」（那是给卡片布局用的下限，
     *   不是「完整内容的合适高度」）。
     *
     * 只改尺寸，不动位置 —— 用户的左上角坐标是刻意摆过的，
     * 切换形态不该让卡片在桌面上「跳」到别处。
     */
    if (view === 'compact') {
      setSize(plugin.id, 'S')
      setDim(plugin.id, undefined, undefined)
    } else {
      setSize(plugin.id, 'M')
      // 宽度沿用 M 档（480），高度给足
      setDim(plugin.id, SIZE_W.M, FULL_VIEW_H)
    }
    // 切回精简时把二级界面重新展开：精简形态下这一段是全部设置入口，
    // 用户刚切回来多半就是想调格式/尺寸。让它跟着形态走，
    // 而不是保留上次切走前那个「收起」的临时状态。
    if (view === 'compact') setShowCwSettings(true)
  }

  /**
   * 设置面板定位。
   *
   * 面板通过 portal 渲染到 body 下并使用 position: fixed —— 因为桌面画布
   * （.desktop-canvas）带 transform: scale()，若把面板留在卡片内部，它会连同
   * 缩放一起被放大/缩小，且坐标计算也要换算缩放倍率。
   *
   * 定位以齿轮的屏幕矩形为锚点，右对齐、优先向下展开；
   * 下方空间不足时向上翻转，两侧都不足则夹高并滚动。
   *
   * ⚠ 坐标换算：界面显示比例以 CSS zoom 实现，此时
   *   getBoundingClientRect / window.innerHeight 给出的是**缩放后**（视觉）坐标，
   *   而 style 里的 top/right/width 长度属于**缩放前**（布局）坐标。
   *   因此所有写入 style 的数值都必须除以 zoom，否则会按比例跑偏
   *   （实测 150% 下偏移 154px）。见 core/uiScale.ts。
   */
  const gearRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})
  // 首次渲染先隐藏，测量后再显示，避免出现一帧错位
  const [panelReady, setPanelReady] = useState(false)

  useLayoutEffect(() => {
    if (!showSettings) { setPanelReady(false); return }
    const gear = gearRef.current
    const el = panelRef.current
    if (!gear || !el) return

    const MARGIN_V = 8        // 视觉边距
    const PANEL_W_V = 300     // 视觉宽度

    const measure = () => {
      const z = readUiScale()
      // 视觉坐标（已缩放）
      const g = gear.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      // 面板自身高度也是视觉值
      const hV = el.offsetHeight || 0

      const spaceBelowV = vh - g.bottom - MARGIN_V
      const spaceAboveV = g.top - MARGIN_V

      // 右对齐到齿轮右缘（视觉量），必要时夹到视口内
      let rightV = vw - g.right
      if (vw - rightV - PANEL_W_V < MARGIN_V) {
        rightV = Math.max(MARGIN_V, vw - PANEL_W_V - MARGIN_V)
      }

      // 视觉 → 布局：写入 style 的值需除以 zoom
      const place = (below: boolean, maxHV: number) => ({
        position: 'fixed' as const,
        right: toLayoutPx(rightV, z),
        width: toLayoutPx(PANEL_W_V, z),
        // 夹紧高度时留出边距，避免贴边或越界（向上翻转时尤其重要：
        // bottom 定位只约束下边缘，上边缘会随高度溢出视口）
        maxHeight: Math.max(120, toLayoutPx(Math.max(0, maxHV - MARGIN_V), z)),
        ...(below
          ? { top: toLayoutPx(g.bottom + 4, z), bottom: 'auto' }
          : { top: 'auto', bottom: toLayoutPx(vh - g.top + 4, z) }),
      })

      if (hV <= spaceBelowV) setPanelStyle(place(true, spaceBelowV))
      else if (hV <= spaceAboveV) setPanelStyle(place(false, spaceAboveV))
      else setPanelStyle(place(spaceBelowV >= spaceAboveV, Math.max(spaceBelowV, spaceAboveV)))

      setPanelReady(true)
    }

    measure()
    // 字体/内容可能异步撑高面板，再补测一次
    const t = window.setTimeout(measure, 60)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [showSettings, plugin.config])

  // 把卡片动作登记到注册表，供桌面壳的原生右键菜单按 id 调用
  useEffect(() => {
    return registerCardActions(plugin.id, {
      refresh: () => tickRef.current?.(),
      openSettings: () => setShowSettings(true),
      resetSize: () => {
        setDim(plugin.id, SIZE_W[m.defaultSize ?? 'M'], SIZE_MIN_H[m.defaultSize ?? 'M'])
        setSize(plugin.id, m.defaultSize ?? 'M')
      },
    })
  }, [plugin.id, m.defaultSize, setDim, setSize])

  // 桌面壳中右键卡片 → 原生菜单；浏览器中保持默认菜单（含「检查元素」等）
  const onCardContextMenu = (e: React.MouseEvent) => {
    if (!isDesktop()) return
    e.preventDefault()
    e.stopPropagation()
    setFocusedId(plugin.id)
    showContextMenu({
      kind: 'card',
      data: {
        // ⚠ 这里必须是**窗口 id**：桌面壳的菜单命令（刷新/设置/关闭…）
        // 回来时按这个 id 查卡片，用插件 id 会命中同一插件的第一个窗口。
        id: plugin.id,
        name: m.name,
        canRefresh: m.refresh.intervalMs !== -1,
        visible: plugin.visible,
        enabled: plugin.enabled,
      },
    })
  }

  return (
    <div
      className={`plugin-card${dragging ? ' dragging' : ''}${resizing ? ' resizing' : ''}${isFocused ? ' focused' : ''}`}
      /**
       * data-win-id / data-plugin-id：卡片间拖放的命中判定要用。
       *
       * 仲裁发生在 Desktop 里，它对每张卡片的组件实例没有引用；用 DOM
       * 查询是这里最直接的办法（见 core/cardDrag.ts 的 cardAtPoint）。
       */
      data-win-id={plugin.id}
      data-plugin-id={plugin.pluginId}
      style={{
        position: 'absolute',
        // 左侧拖动缩放时由 resizeX 预览新的 x（右边固定）
        left: resizing === 'w' ? resizeX : local.x,
        top: local.y,
        width: resizing ? resizeW : cardW,
        height: resizing ? resizeH : cardH,
        zIndex: isFocused ? 100 : 1,
        cursor: dragging ? 'grabbing' : 'grab',
      }}
      onContextMenu={onCardContextMenu}
      onMouseDown={(e) => {
        // 顶部栏由 onHeadMouseDown 处理；其余交互区域不参与置顶判定
        if ((e.target as HTMLElement).closest('.card-head')) return
        if ((e.target as HTMLElement).closest('.resize-edge')) return
        if ((e.target as HTMLElement).closest('button')) return
        if ((e.target as HTMLElement).closest('.settings-panel')) return
        setFocusedId(plugin.id)
      }}
      title={collapsed ? '点击展开顶部栏' : '点击置顶 · 顶部栏拖拽移动 · 右/下边缘调整尺寸'}
    >
      {/* 顶部栏收起后，只保留右上角的恢复按钮（展开图标），其余控件全部隐去 */}
      {collapsed ? (
        <>
          {/*
            收起后原顶部栏区域仍要能拖动：叠一条透明的绝对定位拖拽条，
            位置/高度与展开态的 .card-head 对齐（顶部、全宽、34px）。
            绝对定位 → 不占流、不把插件内容往下顶，收起后的视觉完全不变。
            .card-expand 用更大的 z-index 浮在其上，点击仍是「展开」。
          */}
          <div
            className="card-head card-head-ghost"
            onMouseDown={onHeadMouseDown}
            title="拖拽移动"
          />
          <button
            className="card-expand"
            title="展开顶部栏"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed(plugin.id, false)}
          >
            <IconExpand size={12} />
          </button>
        </>
      ) : (
        <div className="card-head" onMouseDown={onHeadMouseDown} title="拖拽移动">
          <span className="icon">{m.icon}</span>
          <span className="title">{m.name}</span>
          {/* 同一插件开了多个窗口时标出序号，否则几张卡片名字一样分不清。
              序号按当前工作台里该插件的窗口顺序算（1 起）。 */}
          {windowOrdinal > 1 && <span className="win-ordinal">#{windowOrdinal}</span>}
          <span className="badge">{isStatic ? '静态' : isManual ? '手动' : fmtInterval(m.refresh.intervalMs)}</span>
          <span className="spacer" />
          {/* 再开一个同插件的窗口。放在卡片上最顺手 ——
              用户看着这个时钟想再开一个看别的时区时，不用去右下角找坞。 */}
          <button
            className="card-dup"
            title="再开一个同插件的窗口（各自独立的位置、尺寸与设置）"
            onClick={() => openWindow(plugin.pluginId)}
          >
            <IconDuplicate size={13} />
          </button>
          {/* 收起顶部栏 */}
          <button title="收起顶部栏" onClick={() => setCollapsed(plugin.id, true)}>
            <IconCollapse size={13} />
          </button>
          {/* 齿轮：设置菜单内已含「立即刷新」，故顶栏不再单列刷新按钮 */}
          <span
            ref={gearRef}
            className="gear"
            onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings) }}
            title="设置"
          >
            <IconGear size={13} />
          </span>
          {/* 关闭 X 置于最右上角。语义是「关闭这个窗口」——
              只关这一个；同一插件的其他窗口与插件本身都不受影响，
              插件仍留在插件坞里，随时可以再建。 */}
          <button
            className="card-close"
            title="关闭这个窗口"
            onClick={() => closeWindow(plugin.id)}
          >
            <IconClose size={13} />
          </button>
        </div>
      )}
      <div className="card-divider" />
      <div className="card-body">
        {m.renderMode === 'iframe' ? (
          /**
           * ⚠ key 里必须带**形态**（viewKey）。
           *
           * IframeHost 的 effect（建 PluginBus、填 cwRef）只在 key 变化或
           * 卸载时重跑。原来 key 只有 `${plugin.id}:${plugin.enabled}`，
           * 切「精简 ↔ 完整」时 key 不变 → effect 不重跑 → 但内部
           * <iframe key={view}> 已经换了新节点，iframeRef 仍指向**已脱离
           * 文档的旧节点**，PluginBus 绑在一个死 iframe 上。
           *
           * 症状：切换过完整内容后，精简设置面板照常渲染（cwDesc 还是
           * 切走前的旧值），但点任何按钮都没反应 —— 消息发给了那个
           * 不存在的 iframe。这正是「切换过完整内容后精简设置无点击反馈」
           * 的根因。
           */
          <IframeHost
            key={`${plugin.id}:${plugin.enabled}:${viewKey}`}
            plugin={plugin}
            tickRef={tickRef}
            cwRef={cwRef}
          />
        ) : (
          <ModuleHost key={`${plugin.id}:${plugin.enabled}`} plugin={plugin} tickRef={tickRef} />
        )}
      </div>

      {/* 设置面板打开时，用一层透明遮罩盖住卡片内容区：
          iframe 内的点击不会冒泡到宿主，靠它把「点母界面」转成宿主可感知的点击。
          点击即关闭菜单；遮罩不覆盖顶部栏，避免挡住齿轮与关闭按钮。 */}
      {showSettings && (
        <div
          className="settings-shield"
          onMouseDown={() => setShowSettings(false)}
          aria-hidden="true"
        />
      )}

      {/* 设置面板：portal 到 body 并用 fixed 定位，
          避免被桌面画布的 transform: scale() 放大/缩小。 */}
      {showSettings && createPortal(
        <div
          ref={panelRef}
          className="settings-panel"
          style={panelReady ? panelStyle : { ...panelStyle, visibility: 'hidden' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {hasSettings ? (
            <SettingsPanel
              schema={m.settings!}
              config={plugin.config ?? {}}
              setConfig={setPluginConfig}
            />
          ) : (
            <div className="setting-hint">该插件没有可配置项</div>
          )}

          {/* 形态切换：只有声明了 manifest.compact 的插件才显示。
              两态：
                - 桌面精简（默认）→ ?view=host，只显示小部件且抹掉它自己的
                                    边框圆角阴影（卡片本身已是一个窗口）
                - 完整内容        → ?view=embed，显示完整内容但不套插件自己的
                                    窗口外壳
              写入 config.view，由 IframeHost 拼到 URL 上并重挂载。

              切换时顺带调整卡片尺寸到该形态的合适值 —— 两种形态的内容
              体量差很多：小组件是 140px 见方，完整内容动辄几百上千像素高。
              不调的话精简形态会在大卡片里孤零零一小块，完整形态则严重溢出。
              位置（左上角）保持不变，只改尺寸。 */}
          {m.compact && (
            <div className="setting-row">
              <span className="setting-label">显示形态</span>
              <div className="view-switch">
                <button
                  className={isCompactView ? 'on' : ''}
                  onClick={() => switchView('compact')}
                >
                  🧩 桌面精简
                </button>
                <button
                  className={isCompactView ? '' : 'on'}
                  onClick={() => switchView('full')}
                >
                  🪟 完整内容
                </button>
              </div>
            </div>
          )}

          {/* 精简设置（二级界面）
              精简组件在卡片里没有自己的齿轮与浮层菜单 —— 它只出内容。
              格式/尺寸/选项全部收进这里，点「精简设置」展开这一层。
              清单由插件 describe() 上报（cw:state），改动经 cw:apply 送回插件，
              宿主不解释插件内部结构，只负责渲染与回传。 */}
          {m.compact && isCompactView && (
            <div className="setting-row cw-settings-entry">
              <span className="setting-label">精简设置</span>
              <button
                className={'cw-link' + (showCwSettings ? ' on' : '')}
                onClick={() => {
                  const next = !showCwSettings
                  setShowCwSettings(next)
                  // 展开时顺手问一次，覆盖插件先于订阅就绪的时序
                  if (next) cwRef.current?.send({ type: 'cw:describe' })
                }}
              >
                {showCwSettings ? (
                  <>
                    收起 <IconChevronUp size={12} />
                  </>
                ) : (
                  <>
                    格式 · 尺寸 · 选项 <IconChevronDown size={12} />
                  </>
                )}
              </button>
            </div>
          )}

          {m.compact && isCompactView && showCwSettings && (
            <div className="cw-settings">
              {!cwDesc ? (
                <div className="setting-hint">正在向插件取精简设置…</div>
              ) : (
                <>
                  <div className="cw-sec">
                    <div className="cw-sec-t">显示格式</div>
                    <div className="cw-fmt-list">
                      {cwDesc.formats.map((f) => (
                        <button
                          key={f.id}
                          className={'cw-fmt-btn' + (cwDesc.format === f.id || activeFmt === f.id ? ' on' : '')}
                          onClick={() => applyCw({ format: f.id })}
                        >
                          <span className="fi">{f.icon}</span>
                          <span>{f.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 「组件尺寸」这一组已移除。
                      组件尺寸现在完全由**窗口大小**决定（见 compact.js 的
                      容器自适应），用户不需要、也不该单独设一个尺寸档位 ——
                      那个档位与卡片实际尺寸是两套互相打架的尺寸来源：
                      卡片拉大了组件还是小方块，或者卡片小了组件溢出。 */}

                  {cwDesc.options.length > 0 && (
                    <div className="cw-sec">
                      <div className="cw-sec-t">选项</div>
                      {cwDesc.options.map((o) => (
                        <div className="cw-opt-row" key={o.key}>
                          <span className="grow">{o.label}</span>
                          {o.type === 'bool' ? (
                            <span className="sw">
                              <input
                                type="checkbox"
                                checked={!!o.value}
                                onChange={(e) => applyCw({ opts: { [o.key]: e.target.checked } })}
                              />
                              <i />
                            </span>
                          ) : o.type === 'select' ? (
                            <select
                              value={String(o.value ?? '')}
                              onChange={(e) => {
                                const raw = (o.choices || []).find((c) => String(c.value) === e.target.value)
                                applyCw({ opts: { [o.key]: raw ? raw.value : e.target.value } })
                              }}
                            >
                              {/*
                                候选项是动态的（例如便签按标题选），存着的值可能
                                已经不在列表里了 —— 那张便签被删掉了。补一条占位项，
                                否则受控 select 会静默显示第一项，面板看起来像「已改成
                                便签 1」，实际状态还是那个旧 id。
                              */}
                              {!(o.choices || []).some((c) => String(c.value) === String(o.value ?? '')) &&
                                o.value != null && o.value !== '' && (
                                  <option value={String(o.value)}>（已不存在）</option>
                                )}
                              {(o.choices || []).map((c) => (
                                <option key={String(c.value)} value={String(c.value)}>{c.label}</option>
                              ))}
                            </select>
                          ) : o.type === 'num' ? (
                            <input
                              type="number"
                              value={Number(o.value ?? o.def ?? 0)}
                              min={o.min}
                              max={o.max}
                              onChange={(e) => applyCw({ opts: { [o.key]: Number(e.target.value) } })}
                            />
                          ) : (
                            <input
                              type="text"
                              value={String(o.value ?? '')}
                              onChange={(e) => applyCw({ opts: { [o.key]: e.target.value } })}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="btn-row">
            {/* 刷新从顶部栏移入设置菜单（静态插件无需刷新） */}
            {m.refresh.intervalMs !== -1 && (
              <button onClick={() => { tickRef.current?.(); setShowSettings(false) }}>
                <IconRefresh size={13} /> 立即刷新
              </button>
            )}
            <button onClick={handleReset}>
              <IconReset size={13} /> 还原尺寸
            </button>
            <button onClick={() => { setShowSettings(false); setCollapsed(plugin.id, true) }}>
              <IconCollapse size={13} /> 收起顶部栏
            </button>
          </div>
        </div>,
        document.body,
      )}

      <div className="resize-edge resize-w" onMouseDown={onResizeDown('w')} title="拖拽调整宽度（右边固定）" />
      <div className="resize-edge resize-e" onMouseDown={onResizeDown('e')} title="拖拽调整宽度" />
      <div className="resize-edge resize-s" onMouseDown={onResizeDown('s')} title="拖拽调整高度" />
      <div className="resize-edge resize-se" onMouseDown={onResizeDown('se')} title="拖拽同时调整宽高" />
    </div>
  )
}

function fmtInterval(ms: number) {
  if (ms % 60000 === 0) return `${ms / 60000} 分钟`
  if (ms % 1000 === 0) return `${ms / 1000} 秒`
  return `${ms}ms`
}
