import { useApp } from '../state/AppContext'

/**
 * 全局背景层。
 *
 * 单独一个组件而不是塞进 App 的 JSX：视频模式下要渲染 <video>，
 * 而 <video> 只在 background==='video' 时才该存在 —— 切回纯色后
 * 视频若还挂在 DOM 里，会在后台继续解码，白耗电。
 *
 * 分层：本层 fixed + z-index:0 垫在最底下，.app-shell 有 z-index:1，
 * 所以所有页面内容都压在背景之上；pointer-events:none 保证不挡点击。
 */
export function Backdrop() {
  const { settings } = useApp()
  const bg = settings.background

  // 视频模式但还没有视频源：什么都不渲染，露出纯色底
  if (bg === 'video' && !settings.bgVideo) return null

  return (
    <div className="wb-backdrop" aria-hidden="true">
      {bg === 'video' && settings.bgVideo && (
        <video
          key={settings.bgVideo}
          src={settings.bgVideo}
          autoPlay
          loop
          muted
          playsInline
          /* 视频本身没有语义，且不可交互；用户可在设置里更换或移除 */
          aria-hidden="true"
        />
      )}
    </div>
  )
}
