import { useCallback, useEffect, useState } from 'react'
import { isDesktop, onDesktopCommand, windowControl, windowState } from '../core/desktop'

/**
 * 自绘标题栏（仅桌面壳）
 * ------------------------------------------------------------
 * 桌面壳用 `frame: false` 去掉了系统标题栏，这里补一条自己的：
 *   - 左侧：应用名（带一个小标记）
 *   - 中间：`-webkit-app-region: drag` 的拖拽区，双击 = 最大化/还原
 *   - 右侧：— □ × 三个按钮，走 IPC 控制真实窗口
 *
 * ## 为什么浏览器里不渲染
 * 网页版没有真实窗口，画一排点了没反应的按钮纯属误导。`isDesktop()`
 * 为 false 时直接返回 null —— 验收脚本跑在 Electron 里所以能看到，
 * 线上 demo（deeer.online/pwt/demo）则是纯网页，不显示。
 *
 * ## 三个按钮的图标自己画
 * Windows 原生的 — □ × 是字体渲染的细线，跟 OLED 深色界面放一起会显得
 * 灰扑扑的。这里用 SVG 描边，颜色跟着令牌走，hover 有反馈、关闭键变红 ——
 * 与设计库「图标必须矢量、禁止 emoji」的规则一致。
 *
 * ## 双击最大化
 * `-webkit-app-region: drag` 的元素在 Windows 上会被 Chromium 自动处理
 * 双击最大化，但那是在原生层发生的，React 收不到事件、我们也就同步不了
 * 图标。所以拖拽区不靠 app-region 的原生双击，改为自己监听 dblclick —— 
 * 注意 app-region: drag 会吞掉所有鼠标事件，所以拖拽区内部不能再挂
 * dblclick。折中：拖拽区保持 app-region，双击由主进程的 maximize/unmaximize
 * 事件回推 `win-max-changed` 来同步图标（见 main.cjs 的 pushMaxState）。
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const [ready, setReady] = useState(false)

  // 挂载时问一次当前状态，否则刚打开就最大化的窗口图标是错的
  useEffect(() => {
    if (!isDesktop()) return
    let alive = true
    void windowState().then((s) => {
      if (!alive || !s) return
      setMaximized(s.maximized)
      setReady(true)
    })
    return () => { alive = false }
  }, [])

  // 主进程在窗口最大化/还原时推事件过来（包括双击标题栏、Win+↑ 这些
  // 不经过我们按钮的路径）
  useEffect(() => {
    if (!isDesktop()) return
    return onDesktopCommand((cmd) => {
      if (cmd.type === 'win-max-changed') setMaximized(cmd.maximized)
    })
  }, [])

  const act = useCallback(async (action: 'minimize' | 'toggle-maximize' | 'close') => {
    const s = await windowControl(action)
    if (s) setMaximized(s.maximized)
  }, [])

  if (!isDesktop()) return null

  return (
    <header className={'titlebar' + (ready ? '' : ' booting')}>
      <div className="tb-brand">
        <span className="tb-mark" aria-hidden />
        <span className="tb-name">Workbench</span>
        <span className="tb-sub">插件式工作台</span>
      </div>

      {/* 拖拽区：空白处留给窗口拖动。app-region: drag 见 global.css */}
      <div className="tb-drag" />

      <div className="tb-actions">
        <button
          className="tb-btn"
          title="最小化"
          aria-label="最小化"
          onClick={() => void act('minimize')}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          </svg>
        </button>

        <button
          className="tb-btn"
          title={maximized ? '向下还原' : '最大化'}
          aria-label={maximized ? '向下还原' : '最大化'}
          onClick={() => void act('toggle-maximize')}
        >
          {maximized ? (
            // 还原：两个错位方框
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
              <rect x="1.6" y="3.4" width="6.6" height="6.6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path d="M4.4 3.4V2.6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-.8"
                stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            </svg>
          ) : (
            // 必须套在 <svg> 里：裸 <rect> 不属于 SVG 命名空间、不会渲染，
            // 表现是「未最大化时最大化按钮一片空白」（只有还原态看得见）。
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
              <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          )}
        </button>

        <button
          className="tb-btn tb-close"
          title="关闭"
          aria-label="关闭"
          onClick={() => void act('close')}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
    </header>
  )
}
