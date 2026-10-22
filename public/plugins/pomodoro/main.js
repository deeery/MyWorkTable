/**
 * ============ Workbench module 插件：番茄钟 ============
 * 圆环倒计时：随时间减少，圆环高亮色逐渐缩短。
 * 演示 permissions: storage + notify。
 */
export default function create(ctx) {
  let root = null, canvas = null, timeEl = null

  /**
   * 从给定配置对象读取时长（分钟）。config 的值一律是字符串，
   * 非法/缺失时回退默认值，并夹到设置面板允许的区间内。
   *
   * 两个坑：
   *  1. 不能用 `Number(x) ?? fallback`——Number(undefined) 得 NaN，而 NaN ?? x 仍是 NaN。
   *  2. 不能用 Number.isFinite(Number(x)) 判存在性——Number(null) 是 0 且有限。
   * 故先要求非空，再解析。
   */
  function minutesOf(cfg, key, fallback, min, max) {
    const raw = cfg?.[key]
    if (raw === null || raw === undefined || raw === '') return fallback * 60
    const n = parseInt(raw, 10)
    const v = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
    return v * 60
  }

  let WORK = minutesOf(ctx.config, 'work', 25, 5, 60)
  let REST = minutesOf(ctx.config, 'rest', 5, 1, 30)
  let mode = ctx.storage.get('mode') || 'work'
  let total = mode === 'work' ? WORK : REST
  let left = ctx.storage.get('left') ?? total
  let running = false
  let raf = null

  const css = (theme) => `
    .pomo-root{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
      font-family:inherit;color:${theme === 'dark' ? '#dfe3f0' : '#23263a'};user-select:none;}
    /* 圆环区域：占满剩余空间，canvas 铺满，时间文字绝对居中叠在环内 */
    .pomo-ring{position:relative;flex:1 1 auto;width:100%;min-height:0;}
    .pomo-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;user-select:none;}
    .pomo-ring-center{position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:3px;pointer-events:none;}
    .pomo-time{font-weight:700;font-variant-numeric:tabular-nums;line-height:1;user-select:none;}
    .pomo-mode{font-size:11px;padding:1px 9px;border-radius:999px;user-select:none;
      background:${mode === 'work' ? 'rgba(226,84,92,.15)' : 'rgba(46,168,111,.15)'};
      color:${mode === 'work' ? '#e2545c' : '#2ea86f'};}
    .pomo-btns{display:flex;gap:8px;user-select:none;flex:none;}
    .pomo-btn{border:1px solid var(--border,#e4e7f0);border-radius:8px;padding:4px 14px;font-size:12px;cursor:pointer;
      background:transparent;color:inherit;user-select:none;}
    .pomo-btn.primary{background:#4f6bfd;border-color:#4f6bfd;color:#fff;}
  `

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  function draw() {
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (!w || !h) { raf = requestAnimationFrame(draw); return }
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const g = canvas.getContext('2d')
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.scale(dpr, dpr)
    g.clearRect(0, 0, w, h)

    const cx = w / 2, cy = h / 2
    // 环粗随尺寸自适应，并留出线宽一半 + 内边距，避免描边被裁掉
    const lineW = Math.max(5, Math.min(12, Math.min(w, h) * 0.07))
    const r = Math.max(8, Math.min(w, h) / 2 - lineW / 2 - 2)
    const progress = total > 0 ? left / total : 0

    // 背景圆环
    g.strokeStyle = 'rgba(128,128,160,.15)'
    g.lineWidth = lineW
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.stroke()

    // 高亮圆环（从顶部开始，顺时针随剩余时间减少）
    const startAngle = -Math.PI / 2
    const endAngle = startAngle + Math.PI * 2 * progress
    g.strokeStyle = mode === 'work' ? '#e2545c' : '#2ea86f'
    g.lineWidth = lineW
    g.lineCap = 'round'
    g.beginPath()
    // progress 为 0 时 arc 起止点相同，某些实现会画出整圈，故跳过
    if (progress > 0.0005) g.arc(cx, cy, r, startAngle, endAngle)
    g.stroke()

    // 时间字号随环内可用空间自适应，保证「圆环包围时间」且不溢出
    if (timeEl) {
      const inner = Math.max(24, (r - lineW / 2) * 2 * 0.62)   // 环内直径的 ~62% 留给文字宽度
      const size = Math.max(13, Math.min(44, inner / 2.9))
      const next = size.toFixed(1) + 'px'
      if (timeEl.style.fontSize !== next) timeEl.style.fontSize = next
    }

    raf = requestAnimationFrame(draw)
  }

  function switchMode() {
    mode = mode === 'work' ? 'rest' : 'work'
    total = mode === 'work' ? WORK : REST
    left = total
    ctx.storage.set('mode', mode)
    // 文案按实际配置时长生成，避免与用户设定不符
    if (ctx.notify) ctx.notify(
      mode === 'rest' ? '专注结束 🍅' : '休息结束',
      mode === 'rest'
        ? `${WORK / 60} 分钟专注完成，休息 ${REST / 60} 分钟`
        : `休息结束，开始新的 ${WORK / 60} 分钟专注`
    )
  }

  function refreshLabels() {
    if (!root) return
    root.querySelector('.pomo-time').textContent = fmt(left)
    const badge = root.querySelector('.pomo-mode')
    badge.textContent = mode === 'work' ? '专注中' : '休息中'
    badge.style.background = mode === 'work' ? 'rgba(226,84,92,.15)' : 'rgba(46,168,111,.15)'
    badge.style.color = mode === 'work' ? '#e2545c' : '#2ea86f'
    root.querySelector('.style-holder').textContent = css(ctx.getTheme())
    root.querySelector('.toggle').textContent = running ? '暂停' : '开始'
  }

  return {
    mount(container) {
      container.innerHTML = ''
      root = document.createElement('div')
      root.className = 'pomo-root'
      root.innerHTML = `
        <style class="style-holder"></style>
        <div class="pomo-ring">
          <canvas class="pomo-canvas"></canvas>
          <div class="pomo-ring-center">
            <span class="pomo-mode"></span>
            <div class="pomo-time"></div>
          </div>
        </div>
        <div class="pomo-btns">
          <button class="pomo-btn primary toggle">开始</button>
          <button class="pomo-btn reset">重置</button>
        </div>
      `
      container.appendChild(root)
      canvas = root.querySelector('canvas')
      timeEl = root.querySelector('.pomo-time')
      root.querySelector('.toggle').onclick = () => { running = !running; refreshLabels() }
      root.querySelector('.reset').onclick = () => { running = false; left = total; refreshLabels() }
      refreshLabels()
      draw()
    },

    unmount() {
      cancelAnimationFrame(raf)
      ctx.storage.set('left', left)
      if (root) root.remove()
      root = canvas = timeEl = null
    },

    onTick() {
      if (!running) return
      left = Math.max(0, left - 1)
      if (left === 0) switchMode()
      refreshLabels()
    },

    onThemeChange() { refreshLabels() },

    // 设置面板改动时长后即时生效：当前阶段按新时长重置（未运行的计时归零重算）
    onConfigChange(cfg) {
      const nextWork = minutesOf(cfg, 'work', 25, 5, 60)
      const nextRest = minutesOf(cfg, 'rest', 5, 1, 30)
      if (nextWork === WORK && nextRest === REST) return
      WORK = nextWork
      REST = nextRest
      total = mode === 'work' ? WORK : REST
      running = false
      left = total
      ctx.storage.set('left', left)
      refreshLabels()
    },
  }
}