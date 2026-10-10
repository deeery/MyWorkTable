/**
 * ============ Workbench module 插件：番茄钟 ============
 * 演示 permissions: storage + notify。
 * 默认不出现在桌面（manifest.defaultVisible=false），从插件市场安装后手动添加。
 */
export default function create(ctx) {
  let root = null, timer = null
  const WORK = 25 * 60, REST = 5 * 60
  let mode = ctx.storage.get('mode') || 'work'
  let left = ctx.storage.get('left') || WORK
  let running = false

  const css = (theme) => `
    .pomo-root{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
      font-family:inherit;color:${theme === 'dark' ? '#dfe3f0' : '#23263a'};}
    .pomo-time{font-size:32px;font-weight:700;font-variant-numeric:tabular-nums;}
    .pomo-mode{font-size:12px;padding:2px 10px;border-radius:999px;
      background:${mode === 'work' ? 'rgba(226,84,92,.12)' : 'rgba(46,168,111,.12)'};
      color:${mode === 'work' ? '#e2545c' : '#2ea86f'};}
    .pomo-btns{display:flex;gap:8px;}
    .pomo-btn{border:1px solid var(--border,#e4e7f0);border-radius:8px;padding:4px 14px;font-size:12px;cursor:pointer;
      background:transparent;color:inherit;}
    .pomo-btn.primary{background:#4f6bfd;border-color:#4f6bfd;color:#fff;}
  `

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  function render() {
    if (!root) return
    root.querySelector('.pomo-time').textContent = fmt(left)
    const badge = root.querySelector('.pomo-mode')
    badge.textContent = mode === 'work' ? '专注中' : '休息中'
    root.querySelector('.style-holder').textContent = css(ctx.getTheme())
    root.querySelector('.toggle').textContent = running ? '暂停' : '开始'
  }

  function switchMode() {
    mode = mode === 'work' ? 'rest' : 'work'
    left = mode === 'work' ? WORK : REST
    ctx.storage.set('mode', mode)
    if (ctx.notify) ctx.notify(mode === 'rest' ? '专注结束 🍅' : '休息结束',
      mode === 'rest' ? '25 分钟专注完成，休息 5 分钟' : '休息结束，开始新的专注')
  }

  return {
    mount(container) {
      container.innerHTML = ''
      root = document.createElement('div')
      root.className = 'pomo-root'
      root.innerHTML = `
        <style class="style-holder"></style>
        <span class="pomo-mode"></span>
        <div class="pomo-time"></div>
        <div class="pomo-btns">
          <button class="pomo-btn primary toggle">开始</button>
          <button class="pomo-btn reset">重置</button>
        </div>
      `
      container.appendChild(root)
      root.querySelector('.toggle').onclick = () => { running = !running; render() }
      root.querySelector('.reset').onclick = () => { running = false; left = mode === 'work' ? WORK : REST; render() }
      render()
    },
    unmount() {
      clearInterval(timer)
      ctx.storage.set('left', left)
      if (root) root.remove()
      root = null
    },
    // 秒级 tick：由宿主每秒派发（页面隐藏时自动暂停，回来补一次）
    onTick() {
      if (!running) return
      left = Math.max(0, left - 1)
      if (left === 0) switchMode()
      render()
    },
    onThemeChange() { render() },
  }
}
