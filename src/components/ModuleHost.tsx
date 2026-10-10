import { useEffect, useRef } from 'react'
import type { InstalledPlugin } from '../core/storage'
import type { PluginContext, PluginInstance } from '../types/plugin'
import { loadModulePlugin } from '../core/module-loader'
import { scheduler } from '../core/scheduler'
import { useApp } from '../state/AppContext'

/**
 * ES Module 渲染宿主
 * ------------------------------------------------------------
 * 动态 import 插件入口模块 → 注入 PluginContext → mount 到容器。
 * onTick 由 Scheduler 按 manifest.refresh.intervalMs 派发。
 */
export function ModuleHost({
  plugin,
  tickRef,
}: {
  plugin: InstalledPlugin
  tickRef: React.MutableRefObject<(() => void) | null>
}) {
  const { settings, profile } = useApp()
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<PluginInstance | null>(null)
  const themeRef = useRef(settings.theme)

  useEffect(() => {
    themeRef.current = settings.theme
  }, [settings.theme])

  useEffect(() => {
    const el = containerRef.current!
    let dead = false

    const ns = `plugin:${plugin.manifest.id}`
    const ctx: PluginContext = {
      manifest: plugin.manifest,
      storage: {
        get<T>(key: string): T | null {
          if (!plugin.manifest.permissions?.storage) return null
          try { return JSON.parse(localStorage.getItem(`${ns}:${key}`) ?? 'null') as T } catch { return null }
        },
        set(key: string, value: unknown) {
          if (!plugin.manifest.permissions?.storage) return
          localStorage.setItem(`${ns}:${key}`, JSON.stringify(value))
        },
      },
      getTheme: () => themeRef.current,
      openUrl: (url) => { if (plugin.manifest.permissions?.openUrl) window.open(url, '_blank', 'noopener') },
      getProfile: () => (plugin.manifest.permissions?.readProfile && profile ? { name: profile.name, avatar: profile.avatar } : null),
      notify: (title, body) => {
        if (plugin.manifest.permissions?.notify && 'Notification' in window) new Notification(title, { body })
      },
    }

    loadModulePlugin(plugin.manifest.entry, ctx)
      .then((instance) => {
        if (dead) return
        instanceRef.current = instance
        instance.mount(el)
        const tick = () => instance.onTick?.()
        tickRef.current = tick
        const stop = scheduler.register({ id: plugin.manifest.id, ...plugin.manifest.refresh, onTick: tick })
        cleanupFns.push(stop)
      })
      .catch((err) => {
        el.innerHTML = `<div style="padding:16px;color:var(--danger);font-size:12px">插件加载失败：${String(err?.message ?? err)}</div>`
      })

    const cleanupFns: Array<() => void> = []
    return () => {
      dead = true
      cleanupFns.forEach((fn) => fn())
      tickRef.current = null
      try { instanceRef.current?.unmount() } catch { /* 插件卸载异常需隔离 */ }
      el.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.manifest.id, plugin.enabled])

  // 主题切换回调
  useEffect(() => {
    instanceRef.current?.onThemeChange?.(settings.theme)
  }, [settings.theme])

  if (!plugin.enabled) return null
  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
