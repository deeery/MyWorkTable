/**
 * module 插件加载器
 * ------------------------------------------------------------
 * 动态 import 插件 ES Module，校验其导出的工厂签名后实例化。
 * 插件模块 default 导出形如：
 *   export default function create(ctx) { return { mount, unmount, onTick... } }
 */
import type { PluginContext, PluginFactory, PluginInstance } from '../types/plugin'
import { resolveAppUrl } from './url'

/**
 * 用 new Function 构造原生动态 import，绕过构建器对动态 import 的
 * 静态分析/查询注入，使插件可直接从 public 目录（或任意 https 源）加载。
 */
const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<{ default?: unknown }>

export async function loadModulePlugin(url: string, ctx: PluginContext): Promise<PluginInstance> {
  // 以 '/' 开头的入口需按应用根目录解析，否则 file:// 下会指向磁盘根目录而加载失败
  const resolved = resolveAppUrl(url)
  const mod = await nativeImport(resolved)
  const factory = mod.default
  if (typeof factory !== 'function') {
    throw new Error(`插件 ${url} 未导出 default 工厂函数`)
  }
  const instance = (factory as PluginFactory)(ctx)
  if (!instance || typeof instance.mount !== 'function' || typeof instance.unmount !== 'function') {
    throw new Error(`插件 ${url} 返回的实例缺少 mount/unmount 生命周期`)
  }
  return instance
}
