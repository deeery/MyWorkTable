import { useEffect, useRef } from 'react'
import type { PluginView } from '../core/storage'
import type { PluginContext, PluginInstance } from '../types/plugin'
import { loadModulePlugin } from '../core/module-loader'
import { pluginStoragePrefix } from '../core/storage'
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
  plugin: PluginView
  tickRef: React.MutableRefObject<(() => void) | null>
}) {
  const { settings, profile, setConfig } = useApp()
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<PluginInstance | null>(null)
  const themeRef = useRef(settings.theme)
  // config 用 ref 恒持最新值，ctx 里以 getter 暴露，避免 mount 后的变更读到旧快照
  const configRef = useRef(plugin.config ?? {})
  configRef.current = plugin.config ?? {}

  useEffect(() => {
    themeRef.current = settings.theme
  }, [settings.theme])

  useEffect(() => {
    const el = containerRef.current!
    let dead = false

    // 命名空间前缀与 core/storage 的 clearPluginStorage 保持一致（plugin:<id>:）
    const ns = pluginStoragePrefix(plugin.manifest.id)
    const ctx: PluginContext = {
      manifest: plugin.manifest,
      storage: {
        get<T>(key: string): T | null {
          if (!plugin.manifest.permissions?.storage) return null
          try { return JSON.parse(localStorage.getItem(ns + key) ?? 'null') as T } catch { return null }
        },
        set(key: string, value: unknown) {
          if (!plugin.manifest.permissions?.storage) return
          localStorage.setItem(ns + key, JSON.stringify(value))
        },
      },
      getTheme: () => themeRef.current,
      openUrl: (url) => { if (plugin.manifest.permissions?.openUrl) window.open(url, '_blank', 'noopener') },
      getProfile: () => (plugin.manifest.permissions?.readProfile && profile ? { name: profile.name, avatar: profile.avatar } : null),
      notify: (title, body) => {
        if (plugin.manifest.permissions?.notify && 'Notification' in window) new Notification(title, { body })
      },
      // getter 保证插件随时读到最新配置；写入走 setConfig 由宿主统一持久化。
      // ⚠ 配置挂在**窗口**上（plugin.id），不是插件上 ——
      //   同一插件的两个窗口各自独立设置。
      get config() { return configRef.current },
      setConfig: (patch) => setConfig(plugin.id, patch),
    }

    loadModulePlugin(plugin.manifest.entry, ctx)
      .then((instance) => {
        if (dead) return
        instanceRef.current = instance
        instance.mount(el)
        const tick = () => instance.onTick?.()
        tickRef.current = tick
        // 按**窗口 id** 注册调度：同一插件的两个窗口各刷各的，
    // 用插件 id 会互相覆盖（见 IframeHost 里的同类注释）
    const stop = scheduler.register({ id: plugin.id, ...plugin.manifest.refresh, onTick: tick })
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
  }, [plugin.id, plugin.enabled])

  // 主题切换回调
  useEffect(() => {
    instanceRef.current?.onThemeChange?.(settings.theme)
  }, [settings.theme])

  // 配置变更下发（module 插件经 onConfigChange 回调接收）
  useEffect(() => {
    instanceRef.current?.onConfigChange?.(plugin.config ?? {})
  }, [plugin.config])

  if (!plugin.enabled) return null
  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}

