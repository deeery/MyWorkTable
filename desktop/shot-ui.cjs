/**
 * 工作台 UI 验收截图（4 页 × 深浅两主题 = 8 张）
 * ------------------------------------------------------------
 * 用于人工验收本轮 UI 审计的修复效果。程序化实测见 desktop/audit-ui.cjs
 * 与 docs/UI-AUDIT.md —— 截图只是给人看的，数据以审计报告为准。
 *
 * 出图到 MyWorkTable/shots/：
 *   ui-dark-1-desktop.png  / ui-dark-2-plugins.png  / ui-dark-3-settings.png  / ui-dark-4-profile.png
 *   ui-light-1-desktop.png / ui-light-2-plugins.png / ui-light-3-settings.png / ui-light-4-profile.png
 *
 * 必须 require('./main.cjs') 起窗口 —— 只有它挂了 preload，
 * 渲染进程里 isDesktop() 才为 true、TitleBar 才渲染。
 *
 * 用法：$env:WORKBENCH_DEV='1'; electron.exe desktop/shot-ui.cjs
 * 默认拍 dev server（能立刻看到改动）；想拍 dist 就设 AUDIT_URL=file:...
 */
process.env.WORKBENCH_DEV = '1'
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 300000)
const OUT = path.join(__dirname, '..', 'shots')
const log = []
const say = (s) => { log.push(s); console.log(s) }

const PAGES = [
  ['1-desktop', '桌面'],
  ['2-plugins', '插件'],
  ['3-settings', '设置'],
  ['4-profile', '我的'],
]

app.whenReady().then(() => setTimeout(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  let win = null
  for (let i = 0; i < 80 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] ?? null
    if (!win) await wait(100)
  }
  if (!win) { console.log('NO WINDOW'); app.exit(1); return }
  win.setSize(1400, 900)
  await wait(1500)

  const js = async (s) => {
    try { return await win.webContents.executeJavaScript(s) }
    catch (e) { return { __err: String((e && e.message) || e) } }
  }
  const goPage = async (label) => {
    await js(`(() => {
      var el = [...document.querySelectorAll('.nav-item')].find(function (x) { return x.textContent.includes(${JSON.stringify(label)}) })
      if (el) { el.click(); return true } return false
    })()`)
    await wait(900)
  }

  /* 关掉过渡：离屏窗口不产生合成帧，transition 会冻结在起始值，
     拍出来的就是「上一帧的样式」。同 audit-ui.cjs 里的说明。 */
  const killTransitions = async () => {
    await js(`(() => {
      if (document.getElementById('__shot_no_transition')) return 'kept'
      var s = document.createElement('style')
      s.id = '__shot_no_transition'
      s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'
      document.head.appendChild(s)
      return 'added'
    })()`)
  }

  /**
   * 存一张图。rect 只给尺寸不给数据，避免 dpr 不一致导致的错位。
   * 离屏窗口合成器会缓存上一帧，所以拍之前做一次「改样式 → 强制布局 → 还原」
   * 的双段重绘，再多 invalidate 两次。
   */
  const shoot = async (name) => {
    await killTransitions()
    await js(`(async () => {
      document.body.style.opacity = '0.998'; void document.body.offsetHeight
      await new Promise(function (r) { setTimeout(r, 130) })
      document.body.style.opacity = ''; void document.body.offsetHeight
      return true
    })()`)
    win.webContents.invalidate()
    await wait(1200)
    win.webContents.invalidate()
    await wait(500)
    const size = win.getContentSize()
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size[0], height: size[1] })
    const p = path.join(OUT, name + '.png')
    const buf = img.toPNG()
    fs.writeFileSync(p, buf)
    const g = img.getSize()
    say('✓ ' + name + '.png ' + JSON.stringify({ width: g.width, height: g.height, kb: Math.round(buf.length / 1024) }))
  }

  /* ---------- 准备数据：清干净 + 装 3 个插件 + 开 3 个窗口 ---------- */
  await win.loadURL('about:blank')
  await wait(500)
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
  await win.loadURL(process.env.AUDIT_URL || 'http://localhost:5173/')
  await wait(2400)

  await goPage('插件')
  await js(`(() => { var b = [...document.querySelectorAll('.btn')].find(function (x) { return x.textContent.includes('插件市场') }); if (b) b.click(); return !!b })()`)
  await wait(1100)
  for (const name of ['番茄专注', '快速便签', '世界时钟']) {
    await js(`(() => {
      var card = [...document.querySelectorAll('.market-card')].find(function (c) { return c.textContent.includes(${JSON.stringify(name)}) })
      if (!card) return 'no-card'
      var btn = [...card.querySelectorAll('button')].find(function (b) { return b.textContent.includes('安装') })
      if (!btn) return 'no-btn'
      btn.click(); return 'ok'
    })()`)
    await wait(850)
  }

  /* 收起插件市场面板，免得挡住插件页截图 */
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await wait(600)

  await goPage('桌面')
  for (const name of ['番茄专注', '快速便签', '世界时钟']) {
    await js(`(() => { var b = document.querySelector('.dock-launch'); if (b) b.click(); return !!b })()`)
    await wait(650)
    await js(`(() => {
      var it = [...document.querySelectorAll('.dock-item')].find(function (x) {
        var n = x.querySelector('.dock-name'); return n && n.textContent.startsWith(${JSON.stringify(name)})
      })
      if (!it) return 'no-item'
      it.click(); return 'ok'
    })()`)
    await wait(800)
  }
  await wait(1200)

  const st = await js(`(() => ({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
    titlebar: !!document.querySelector('.titlebar'),
    cards: document.querySelectorAll('.plugin-card').length,
  }))()`)
  say('深色状态 ' + JSON.stringify(st))

  /* ---------- 深色 4 页 ---------- */
  for (const [slug, label] of PAGES) {
    await goPage(label)
    await wait(700)
    await shoot('ui-dark-' + slug)
  }

  /* ---------- 切浅色：走 localStorage + reload，比点按钮可靠 ---------- */
  await js(`(() => {
    var raw = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}')
    raw.settings = Object.assign({}, raw.settings, { theme: 'light' })
    localStorage.setItem('workbench:state:v1', JSON.stringify(raw))
    return true
  })()`)
  await win.webContents.reload()
  await wait(2400)
  await goPage('桌面')
  await wait(1400)
  const st2 = await js(`(() => ({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
    fg: getComputedStyle(document.body).color,
    cards: document.querySelectorAll('.plugin-card').length,
  }))()`)
  say('浅色状态 ' + JSON.stringify(st2))

  /* ---------- 浅色 4 页 ---------- */
  for (const [slug, label] of PAGES) {
    await goPage(label)
    await wait(700)
    await shoot('ui-light-' + slug)
  }

  fs.writeFileSync(path.join(OUT, 'shot-ui.txt'), log.join('\n') + '\n', 'utf8')
  clearTimeout(HARD)
  app.exit(0)
}, 1200))
