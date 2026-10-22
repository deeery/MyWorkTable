import { useEffect, useRef } from 'react'
import type { PluginView } from '../core/storage'
import type { CompactHostMessage, CompactPluginMessage, PluginMessage } from '../types/plugin'
import { PluginBus } from '../core/bus'
import { resolveAppUrl } from '../core/url'
import { scheduler } from '../core/scheduler'
import { useApp } from '../state/AppContext'
import { launchHostApp, scanHostApps } from '../core/desktop'
import { CARD_ITEM_DRAG } from '../core/cardDrag'

/**
 * iframe 沙箱渲染宿主
 * ------------------------------------------------------------
 * 生命周期：加载 entry → 插件主动发 plugin:ready → 宿主回 workbench:init
 * 调度：按 refresh.intervalMs 由 Scheduler 统一派发 workbench:tick
 * 配置：workbench:init 携带当前 config；其后的每次变更用 workbench:config 增量下发
 */
export function IframeHost({
  plugin,
  tickRef,
  cwRef,
}: {
  plugin: PluginView
  tickRef: React.MutableRefObject<(() => void) | null>
  /**
   * 精简形态设置通道（可选）。
   *
   * 精简组件在卡片里没有自己的齿轮与浮层菜单（只出内容），
   * 格式/尺寸/选项改由卡片设置面板的二级界面控制：
   * 插件 describe() 上报清单（cw:state），宿主把改动 send 下去（cw:apply）。
   * 只在 manifest.compact 声明时才有内容，所以对 module 插件可以不给。
   */
  cwRef?: React.MutableRefObject<{
    send: (m: CompactHostMessage) => void
    subscribe: (fn: (m: CompactPluginMessage) => void) => () => void
  } | null>
}) {
  const { settings, profile, setConfig } = useApp()
  /**
   * setConfig 在 useEffect 里用，但 effect 的依赖只有 [plugin.id, plugin.enabled]。
   * 用 ref 镜像一份最新的，避免闭包拿到过期引用（StrictMode 下尤其明显）。
   */
  const setConfigRef = useRef(setConfig)
  setConfigRef.current = setConfig
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const busRef = useRef<PluginBus | null>(null)
  // 用 ref 读取最新值，避免初始化回调闭包读到过期数据
  const configRef = useRef<Record<string, string>>(plugin.config ?? {})
  configRef.current = plugin.config ?? {}
  // 未收到 plugin:ready 前不下发 config，保证 init 先于 config 到达
  const readyRef = useRef(false)

  useEffect(() => {
    const iframe = iframeRef.current!
    // manifest.entry 以 '/' 开头（如 /plugins/clock/index.html）。在 http 下直接可用，
    // 但在 Electron 的 file:// 下会解析到磁盘根目录而 404，故按应用根目录解析。
    const entryUrl = new URL(resolveAppUrl(plugin.manifest.entry), location.href)
    const bus = new PluginBus(iframe, entryUrl.origin)
    busRef.current = bus
    readyRef.current = false

    /**
     * 精简形态设置的订阅者集合。
     * 单独存一份而不是塞进上面的 switch：cw:* 与 plugin:* 是两条独立通道，
     * 混在一起会让「设置面板没打开时也要收到状态」的逻辑变绕。
     */
    const cwSubs = new Set<(m: CompactPluginMessage) => void>()
    if (cwRef) {
      cwRef.current = {
        send: (msg: CompactHostMessage) => bus.send(msg as never),
        subscribe: (fn) => {
          cwSubs.add(fn)
          return () => { cwSubs.delete(fn) }
        },
      }
    }

    const off = bus.listen((msg: PluginMessage) => {
      // 精简设置通道（cw:*）：转发给订阅者，不进下面的 switch
      if (msg.type.startsWith('cw:')) {
        cwSubs.forEach((fn) => fn(msg as unknown as CompactPluginMessage))
        return
      }
      // 插件自有扩展通道（pl:*）：
      //   pl:notes-own  插件上报「本窗口显示哪几条」→ 写进该窗口的 config
      //   pl:card-drag  卡片间拖动阶段变化 → 转成 DOM 事件交 Desktop 仲裁
      // 用 DOM 事件而不是 props 回调：仲裁要看得见所有卡片，那是 Desktop
      // 的职责，而 IframeHost 埋在卡片深处，加一串回调反而更绕。
      // 拆窗口 / 合并都不需要插件再发请求 —— 宿主判定完落点直接自己做
      // （见 Desktop.tsx 的「卡片间拖放仲裁」）。
      if (msg.type.startsWith('pl:')) {
        const m = msg as unknown as {
          type: string; ids?: string[]; allIds?: string[]; itemId?: string; itemLabel?: string
          phase?: string; x?: number; y?: number
        }
        if (m.type === 'pl:notes-own') {
          // 归属写进**本窗口**的配置：同一插件的另一个窗口不受影响
          setConfigRef.current(plugin.id, { notes: (m.ids || []).join(',') })
        } else if (m.type === 'pl:card-drag') {
          window.dispatchEvent(new CustomEvent(CARD_ITEM_DRAG, {
            detail: {
              winId: plugin.id,
              pluginId: plugin.pluginId,
              itemId: m.itemId,
              itemLabel: m.itemLabel,
              allIds: m.allIds,
              phase: m.phase,
              x: m.x,
              y: m.y,
            },
          }))
        }
        return
      }
      // 应用启动器通道（wb:*）：由宿主向桌面壳要清单 / 转交启动请求
      if (msg.type.startsWith('wb:')) {
        const m = msg as unknown as { type: string; id?: string; target?: string; name?: string }
        if (m.type === 'wb:apps-request') {
          void scanHostApps().then((apps) => {
            // null 表示不在桌面壳里（浏览器）—— 插件会退回自己的内置清单
            if (!apps) return
            /**
             * ⚠ 字段名必须与插件侧一致：插件读的是 `d.apps`。
             * 之前写成 { type, payload: apps }，插件拿不到 apps，
             * 于是永远用内置兜底清单（8 个假应用），表现为
             * 「拉不到菜单里的应用」——排查了很久。
             */
            bus.send({ type: 'wb:apps', apps } as never)
          })
        } else if (m.type === 'wb:launch') {
          void launchHostApp(String(m.target || '')).then((r) => {
            bus.send({
              type: 'wb:launch-result',
              payload: { id: m.id, name: m.name, ok: r.ok, err: r.err },
            } as never)
          })
        }
        return
      }
      switch (msg.type) {
        case 'plugin:ready':
          readyRef.current = true
          bus.send({
            type: 'workbench:init',
            payload: {
              theme: settings.theme,
              locale: 'zh-CN',
              width: iframe.clientWidth,
              config: configRef.current,
              // 窗口实例 id：插件据此把「本窗口显示哪几条」这类窗口级
              // 归属回传给宿主（同一个插件的多个窗口必须能区分开）
              windowId: plugin.id,
            },
          })
          tick()
          /**
           * 主动推一次系统应用清单。
           *
           * 为什么不能只等插件来要：iframe 在 JSX 里创建后立刻开始加载，
           * 而 bus.listen 注册在 useEffect 里（paint 之后）。本地文件加载
           * 极快，插件的 wb:apps-request 可能在监听挂上之前就发出来了，
           * 消息直接丢掉 —— 表现为「插件一直用内置的兜底清单」。
           * plugin:ready 是插件发出的第一个消息，此时监听必然已就位，
           * 在这里推最可靠。插件那边仍保留主动要一次的逻辑，双保险。
           */
          void scanHostApps().then((apps) => {
            if (apps && apps.length) bus.send({ type: 'wb:apps', apps } as never)
          })
          break
        case 'plugin:openUrl':
          if (plugin.manifest.permissions?.openUrl) window.open(msg.payload.url, '_blank', 'noopener')
          break
        case 'plugin:notify':
          if (plugin.manifest.permissions?.notify && 'Notification' in window) {
            new Notification(msg.payload.title, { body: msg.payload.body })
          }
          break
        // plugin:resize / plugin:storage / plugin:profile 可在此扩展
      }
    })

    const tick = () => bus.send({ type: 'workbench:tick', payload: { ts: Date.now() } })
    tickRef.current = tick

    /**
     * 调度器按**窗口 id** 注册，不是插件 id。
     *
     * 同一插件开两个窗口时，若用插件 id 注册，第二次注册会覆盖第一次
     * （或触发去重），结果只有一个窗口收到 tick，另一个永远不刷新。
     * 用窗口 id 才能各刷各的。
     */
    const stop = scheduler.register({ id: plugin.id, ...plugin.manifest.refresh, onTick: tick })
    return () => {
      off()
      stop()
      tickRef.current = null
      readyRef.current = false
      cwSubs.clear()
      if (cwRef) cwRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.id, plugin.enabled])

  // 主题同步
  useEffect(() => {
    busRef.current?.send({ type: 'workbench:theme', payload: { theme: settings.theme } })
  }, [settings.theme])

  // 配置变更实时下发（设置面板改动后立刻生效，无需重载 iframe）
  useEffect(() => {
    if (!readyRef.current) return
    busRef.current?.send({ type: 'workbench:config', payload: plugin.config ?? {} })
  }, [plugin.config])

  // 禁用态：卸载渲染（key 重组件）
  if (!plugin.enabled) return null

  /**
   * 视图形态：把视图写成 URL 参数，而不是用消息下发。
   * 这样「切换形态」等价于一次加载：插件解析 URL 时就决定渲染哪一套，
   * 不必等握手，也不会先渲染完整窗口再隐藏（避免闪烁）。
   * 切换时下面的 key 会变，iframe 因而重新挂载。
   *
   * 三态：
   *   - compact（默认）：桌面精简形态，只显示小部件
   *   - embed：完整内容，但**不再套插件自己的窗口外壳**
   *     —— 宿主卡片本身就是窗口，插件再套一层 .win 会出现两层标题栏、
   *       双份圆角阴影，且按 400px 设计的内容会在窄卡片里溢出。
   *   - full：不带参数，插件完整窗口（仅在独立打开 / 画廊预览时用）
   *
   * 默认取 compact：插件声明了 manifest.compact 就以精简形态上桌面，
   * 用户显式选了「完整内容」才切到 embed。
   */
  const supportsCompact = !!plugin.manifest.compact
  // 精简形态在宿主里用 host 而非 compact：
  // 卡片本身已是窗口（标题栏 / 圆角 / 阴影俱全），.cw 若还带自己的
  // 圆角边框阴影就成了「卡片里又嵌了块小窗」。host 让卡片成为唯一那层窗口。
  // embed 同理，只是抹掉的是 .win（完整窗口）而不是 .cw。
  const view = supportsCompact
    ? plugin.config?.view === 'full' ? 'embed' : 'host'
    : 'full'

  const src = (() => {
    const base = resolveAppUrl(plugin.manifest.entry)
    if (view === 'full') return base
    const sep = base.includes('?') ? '&' : '?'
    return base + sep + 'view=' + view
  })()

  return (
    <iframe
      // 形态变化时强制重挂载，确保插件按新 URL 重新初始化
      key={view}
      ref={iframeRef}
      src={src}
      title={plugin.manifest.name}
      // 生产环境跨源插件建议收紧为 sandbox="allow-scripts"
      sandbox="allow-scripts allow-same-origin"
      loading="lazy"
    />
  )
}
