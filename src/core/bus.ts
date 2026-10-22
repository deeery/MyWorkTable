/**
 * iframe 插件 postMessage 总线
 * ------------------------------------------------------------
 * 宿主与沙箱插件之间的唯一通信通道。
 * 放行三种消息前缀（均由插件侧主动发出，source 校验保证来源）：
 *   plugin:  协议主干 —— ready / tick / theme / notify / openUrl …
 *   cw:      精简形态设置 —— 插件自报清单，宿主回传改动
 *   wb:      快捷启动器 —— 向宿主要系统应用清单，转交启动请求
 * 安全规则：
 *  1. 只接受上面三种前缀且来源为本插件 iframe origin 的消息
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

  /**
   * 宿主 → 插件。
   *
   * file:// 下（Electron 桌面壳加载本地构建产物）不能直接用 iframe 的 origin
   * 当 targetOrigin：
   *   - 某些情况下它是字符串 "null"，而 postMessage 不接受 "null"；
   *   - Chromium 对本地文件报告的 origin 是 "file://"，这也不是合法的
   *     targetOrigin（合法值必须是 "*"、"<scheme>://<host>" 形式或 "/"）。
   * 任一情况都会让 postMessage 抛错，消息根本发不出去 —— 表现为插件收不到
   * workbench:init/theme，主题与配置全部失效（曾据此排查很久）。
   * 故凡是非 http(s) 的 origin 一律退化为 '*'；安全性仍由 listen() 的
   * e.source 校验保证：source 是窗口对象引用，第三方无法伪造。
   */
  send(msg: HostMessage) {
    const o = this.allowedOrigin
    const usable = o === '*' || o === '/' || /^https?:\/\//.test(o)
    this.iframe.contentWindow?.postMessage(msg, usable ? o : '*')
  }

  /** 监听插件 → 宿主 */
  listen(handler: (msg: PluginMessage) => void): () => void {
    const onEvent = (e: MessageEvent) => {
      // source 校验是主要防线：必须是本插件 iframe 的窗口
      if (e.source !== this.iframe.contentWindow) return
      // origin 校验：file:// 下双方 origin 都不是正常值（"null" 或 "file://"），
      // 此时以 source 校验为准，跳过 origin 比较。
      const o = this.allowedOrigin
      const isFileish = !/^https?:\/\//.test(o) && o !== '*'
      if (!isFileish && o !== '*' && e.origin !== o) return
      const data = e.data
      // 只放行约定的消息前缀：
      //   plugin: 插件协议主干（ready / tick / notify / openUrl …）
      //   cw:     精简形态自带的设置通道（描述清单、写入改动）
      //   wb:     快捷启动器通道（向宿主要应用清单 / 转交启动请求）
      //   pl:     插件自有扩展通道（卡片间拖放、窗口归属上报）
      // 全部都由插件侧主动发出，且都已被上面的 source 校验约束。
      if (data && typeof data.type === 'string' && /^plugin:|^cw:|^wb:|^pl:/.test(data.type)) {
        handler(data as PluginMessage)
      }
    }
    window.addEventListener('message', onEvent)
    return () => window.removeEventListener('message', onEvent)
  }
}
