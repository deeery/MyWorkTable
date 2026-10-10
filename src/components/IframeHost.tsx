import { useEffect, useRef } from 'react'
import type { InstalledPlugin } from '../core/storage'
import type { PluginMessage } from '../types/plugin'
import { PluginBus } from '../core/bus'
import { scheduler } from '../core/scheduler'
import { useApp } from '../state/AppContext'

/**
 * iframe 沙箱渲染宿主
 * ------------------------------------------------------------
 * 生命周期：加载 entry → 插件主动发 plugin:ready → 宿主回 workbench:init
 * 调度：按 refresh.intervalMs 由 Scheduler 统一派发 workbench:tick
 */
export function IframeHost({
  plugin,
  tickRef,
}: {
  plugin: InstalledPlugin
  tickRef: React.MutableRefObject<(() => void) | null>
}) {
  const { settings, profile } = useApp()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const busRef = useRef<PluginBus | null>(null)

  useEffect(() => {
    const iframe = iframeRef.current!
    const entryUrl = new URL(plugin.manifest.entry, location.href)
    const bus = new PluginBus(iframe, entryUrl.origin)
    busRef.current = bus

    const off = bus.listen((msg: PluginMessage) => {
      switch (msg.type) {
        case 'plugin:ready':
          bus.send({ type: 'workbench:init', payload: { theme: settings.theme, locale: 'zh-CN', width: iframe.clientWidth } })
          tick()
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

    const stop = scheduler.register({ id: plugin.manifest.id, ...plugin.manifest.refresh, onTick: tick })
    return () => {
      off()
      stop()
      tickRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.manifest.id, plugin.enabled])

  // 主题同步
  useEffect(() => {
    busRef.current?.send({ type: 'workbench:theme', payload: { theme: settings.theme } })
  }, [settings.theme])

  // 禁用态：卸载渲染（key 重组件）
  if (!plugin.enabled) return null

  return (
    <iframe
      ref={iframeRef}
      src={plugin.manifest.entry}
      title={plugin.manifest.name}
      // 生产环境跨源插件建议收紧为 sandbox="allow-scripts"
      sandbox="allow-scripts allow-same-origin"
      loading="lazy"
    />
  )
}
