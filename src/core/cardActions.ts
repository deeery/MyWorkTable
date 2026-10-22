/**
 * 卡片动作注册表
 * ------------------------------------------------------------
 * 桌面壳的原生右键菜单在「主进程」里构建，但真正要执行的动作（刷新、打开设置、
 * 还原尺寸）属于各张卡片内部的实现。此模块提供一个按插件 id 索引的小注册表，
 * 让 PluginCard 挂载时登记自己的动作，页面级代码（如 Desktop）按 id 取用。
 *
 * 纯内存、无持久化；卡片卸载时自动注销。
 */

export interface CardActions {
  /** 立即刷新一次（等价于点卡片上的 ⟳） */
  refresh: () => void
  /** 打开该卡片的设置菜单 */
  openSettings: () => void
  /** 还原为默认尺寸 */
  resetSize: () => void
}

const registry = new Map<string, CardActions>()

/** 登记某插件的卡片动作，返回注销函数 */
export function registerCardActions(id: string, actions: CardActions): () => void {
  registry.set(id, actions)
  return () => {
    // 仅当仍是自己登记的那一份时才删除，避免卸载顺序错乱时误删新实例
    if (registry.get(id) === actions) registry.delete(id)
  }
}

export function getCardActions(id: string): CardActions | undefined {
  return registry.get(id)
}
