/**
 * iframe 插件 postMessage 总线
 * ------------------------------------------------------------
 * 宿主与沙箱插件之间的唯一通信通道。
 * 安全规则：
 *  1. 只接受 message.type 以 'plugin:' 开头且来源为本插件 iframe origin 的消息
 *  2. 每条消息必须携带 token（init 时由宿主下发）——此处简化为 origin 校验
 */
import type { HostMessage, PluginMessage } from '../types/plugin'

export class PluginBus {
  private iframe: HTMLIFrameElement
  private allowedOrigin: string

  constructor(iframe: HTMLIFrameElement, allowedOrigin: string) {
    this.iframe = iframe
    this.allowedOrigin = allowedOrigin
  }

  /** 宿主 → 插件 */
  send(msg: HostMessage) {
    this.iframe.contentWindow?.postMessage(msg, this.allowedOrigin)
  }

  /** 监听插件 → 宿主 */
  listen(handler: (msg: PluginMessage) => void): () => void {
    const onEvent = (e: MessageEvent) => {
      if (e.source !== this.iframe.contentWindow) return
      if (this.allowedOrigin !== '*' && e.origin !== this.allowedOrigin) return
      const data = e.data
      if (data && typeof data.type === 'string' && data.type.startsWith('plugin:')) {
        handler(data as PluginMessage)
      }
    }
    window.addEventListener('message', onEvent)
    return () => window.removeEventListener('message', onEvent)
  }
}
