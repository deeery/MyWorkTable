/**
 * ============ Workbench module 插件：系统监控 ============
 * 演示高频 tick（2s）驱动的实时曲线：插件自身不持有定时器，
 * 全部刷新由宿主 Scheduler 调度（省电/倍率/页面隐藏暂停全局生效）。
 */
export default function create(ctx) {
  let root = null, canvas = null, raf = null
  const cpu = [], mem = []
  const MAX = 60 // 保留 60 个采样点

  const css = (theme) => `
    .mon-root{height:100%;padding:12px 14px;display:flex;flex-direction:column;gap:8px;
      font-family:inherit;color:${theme === 'dark' ? '#dfe3f0' : '#23263a'};}
    .mon-row{display:flex;justify-content:space-between;font-size:12px;}
    .mon-val{font-weight:700;font-variant-numeric:tabular-nums;}
    .mon-canvas{flex:1;width:100%;min-height:0;}
  `

  function draw() {
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr }
    const g = canvas.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    // 网格
    g.strokeStyle = 'rgba(128,128,160,.18)'
    g.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo(0, h * i / 4); g.lineTo(w, h * i / 4); g.stroke()
    }
    // 曲线
    const series = [[cpu, '#3f9ee8'], [mem, '#b06bd4']]
    for (const [data, color] of series) {
      g.strokeStyle = color; g.lineWidth = 2; g.beginPath()
      data.forEach((v, i) => {
        const x = (i / (MAX - 1)) * w
        const y = h - (v / 100) * h
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      })
      g.stroke()
    }
    raf = requestAnimationFrame(draw)
  }

  function sample(arr) {
    arr.push(Math.round(20 + Math.random() * 65))
    if (arr.length > MAX) arr.shift()
    return arr[arr.length - 1]
  }

  function refreshLabels() {
    root.querySelector('.cpu-val').textContent = cpu[cpu.length - 1] + '%'
    root.querySelector('.mem-val').textContent = mem[mem.length - 1] + '%'
  }

  return {
    mount(container) {
      container.innerHTML = ''
      root = document.createElement('div')
      root.className = 'mon-root'
      root.innerHTML = `
        <style>${css(ctx.getTheme())}</style>
        <div class="mon-row"><span>CPU</span><span class="mon-val cpu-val">--</span></div>
        <canvas class="mon-canvas"></canvas>
        <div class="mon-row"><span>内存</span><span class="mon-val mem-val">--</span></div>
      `
      container.appendChild(root)
      canvas = root.querySelector('canvas')
      for (let i = 0; i < 20; i++) { sample(cpu); sample(mem) }
      refreshLabels()
      draw()
    },
    unmount() {
      cancelAnimationFrame(raf)
      if (root) root.remove()
      root = canvas = null
    },
    onTick() { sample(cpu); sample(mem); refreshLabels() },
    onThemeChange(theme) { root.querySelector('style').textContent = css(theme) },
  }
}
