/**
 * 刷新调度器
 * ------------------------------------------------------------
 * 按 manifest.refresh.intervalMs 对每个可见插件派发 tick：
 *  - intervalMs = 0  → 不调度（手动刷新）
 *  - intervalMs = -1 → 永不调度
 *  - pauseWhenHidden 且页面不可见 → 暂停
 *  - 全局刷新倍率（设置页）会缩放实际周期，用于省电模式
 * 调度器统一持有 setInterval，插件自身无需管理定时器。
 */

export interface TickTarget {
  id: string
  intervalMs: number
  pauseWhenHidden?: boolean
  onTick: () => void
}

type Unsubscribe = () => void

export class Scheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private targets = new Map<string, TickTarget>()
  private hiddenAt: number | null = null
  private multiplier = 1

  /** 页面可见性 & 全局倍率由外部接入 */
  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hiddenAt = Date.now()
        this.pauseAll()
      } else {
        // 恢复时立即补一次 tick，再重启周期
        for (const t of this.targets.values()) t.onTick()
        this.hiddenAt = null
        this.resumeAll()
      }
    })
  }

  setMultiplier(m: number) {
    this.multiplier = m
    // 重启全部周期
    for (const id of [...this.timers.keys()]) {
      const t = this.targets.get(id)
      if (t) this.register(t)
    }
  }

  register(target: TickTarget): Unsubscribe {
    this.unregister(target.id)
    this.targets.set(target.id, target)
    if (target.intervalMs > 0) this.startTimer(target)
    return () => this.unregister(target.id)
  }

  private startTimer(t: TickTarget) {
    if (document.hidden && t.pauseWhenHidden !== false) return
    const period = Math.max(250, Math.round(t.intervalMs * this.multiplier))
    const id = setInterval(t.onTick, period)
    this.timers.set(t.id, id)
  }

  private pauseAll() {
    for (const [id, timer] of this.timers) {
      clearInterval(timer)
      this.timers.delete(id)
    }
  }

  private resumeAll() {
    for (const t of this.targets.values()) {
      if (this.timers.has(t.id)) continue
      if (t.intervalMs > 0) this.startTimer(t)
    }
  }

  unregister(id: string) {
    const timer = this.timers.get(id)
    if (timer) clearInterval(timer)
    this.timers.delete(id)
    this.targets.delete(id)
  }
}

/** 全局单例 */
export const scheduler = new Scheduler()
