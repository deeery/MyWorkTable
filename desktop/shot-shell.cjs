/**
 * 桌面壳外观截图（自绘标题栏 + Dark Mode (OLED) 全局样式）
 * ------------------------------------------------------------
 * 出图到 MyWorkTable/shots/：
 *   shell-1-desktop.png  深色桌面页（整窗：自定义标题栏 + OLED 背景 + 插件卡片）
 *   shell-2-titlebar.png 标题栏特写（裁顶部 120px，看三个按钮与拖拽区）
 *   shell-3-maxed.png    最大化之后的标题栏（图标换成「向下还原」）
 *   shell-4-pages.png    插件页 / 设置页（横向拼不现实，出两张）
 *   shell-5-light.png    切到浅色主题，确认两套主题都成立
 *
 * 必须 require('./main.cjs') 起窗口 —— 只有它挂了 preload，
 * 渲染进程里 isDesktop() 才为 true、TitleBar 才渲染。
 * 自己 new BrowserWindow 拍出来的标题栏是空的。
 *
 * 用法：node_modules/electron/dist/electron.exe desktop/shot-shell.cjs
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 240000)
const OUT = path.join(__dirname, '..', 'shots')
const log = []
const say = (s) => { log.push(s); console.log(s) }

app.whenReady().then(() => setTimeout(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  let win = null
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  win.setSize(1400, 900)

  const js = async (s) => {
    try { return await win.webContents.executeJavaScript(s) }
    catch (e) { return { __err: String(e && e.message || e) } }
  }
  const goPage = (label) => js(`(() => {
    var el = [...document.querySelectorAll('.nav-item')].find(function (x) { return x.textContent.includes(${JSON.stringify(label)}) })
    if (el) { el.click(); return true } return false
  })()`)

  /**
   * 存一张图。rect 只给尺寸不给数据，避免 dpr 不一致导致的错位。
   * 离屏窗口合成器会缓存上一帧，所以拍之前做一次「改样式 → 强制布局 → 还原」
   * 的双段重绘，再多 invalidate 两次。
   */
  const shoot = async (name, rect) => {
    await js(`(async () => {
      document.body.style.opacity = '0.998'; void document.body.offsetHeight
      await new Promise(function (r) { setTimeout(r, 130) })
      document.body.style.opacity = ''; void document.body.offsetHeight
      return true
    })()`)
    win.webContents.invalidate()
    await wait(1300)
    win.webContents.invalidate()
    await wait(600)
    const size = win.getContentSize()
    const r = rect || { x: 0, y: 0, width: size[0], height: size[1] }
    const img = await win.webContents.capturePage(r)
    const p = path.join(OUT, name + '.png')
    fs.writeFileSync(p, img.toPNG())
    const g = img.getSize()
    say('✓ ' + name + '.png ' + JSON.stringify({ x: r.x, y: r.y, width: g.width, height: g.height, bytes: img.toPNG().length }))
  }

  /* 清干净：Electron profile 跨进程持久，上一条脚本留下的 light 主题会污染这一轮 */
  await win.loadURL('about:blank')
  await wait(600)
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(1800)

  /* 装两个插件，让桌面不是空的 */
  await goPage('插件')
  await wait(900)
  await js(`(() => { var b = [...document.querySelectorAll('.btn')].find(function (x) { return x.textContent.includes('插件市场') }); if (b) b.click(); return !!b })()`)
  await wait(1100)
  for (const name of ['番茄专注', '快速便签', '世界时钟']) {
    const r = await js(`(() => {
      var card = [...document.querySelectorAll('.market-card')].find(function (c) { return c.textContent.includes(${JSON.stringify(name)}) })
      if (!card) return 'no-card'
      var btn = [...card.querySelectorAll('button')].find(function (b) { return b.textContent.includes('安装') })
      if (!btn) return 'no-btn'
      btn.click(); return 'ok'
    })()`)
    say('装 ' + name + ' ' + r)
    await wait(900)
  }

  await goPage('桌面')
  await wait(900)
  /* 插件坞每点一次就自己关掉，所以每一项之前都要重新打开坞 —— 原来只在
     循环外点了一次，结果只有第一个插件开出了窗口，后面全报 no-item。 */
  for (const name of ['番茄专注', '快速便签', '世界时钟']) {
    await js(`(() => { var b = document.querySelector('.dock-launch'); if (b) b.click(); return !!b })()`)
    await wait(700)
    const r = await js(`(() => {
      var it = [...document.querySelectorAll('.dock-item')].find(function (x) {
        var n = x.querySelector('.dock-name'); return n && n.textContent.startsWith(${JSON.stringify(name)})
      })
      if (!it) return 'no-item'
      it.click(); return 'ok'
    })()`)
    say('开窗 ' + name + ' ' + r)
    await wait(900)
  }
  await wait(1400)

  const state = await js(`(() => {
    var t = document.querySelector('.titlebar');
    return {
      theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.body).backgroundColor,
      titlebar: !!t,
      tbH: t ? Math.round(t.getBoundingClientRect().height) : 0,
      cards: document.querySelectorAll('.plugin-card').length,
    }
  })()`)
  say('状态 ' + JSON.stringify(state))

  /* ---- 1. 深色桌面页整窗 ---- */
  await shoot('shell-1-desktop')

  /* ---- 2. 标题栏特写 ---- */
  await shoot('shell-2-titlebar', { x: 0, y: 0, width: 1400, height: 128 })

  /* ---- 3. 最大化后的标题栏（图标应变成「向下还原」） ---- */
  await js(`document.querySelectorAll('.titlebar .tb-btn')[1].dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(1100)
  const maxed = await js(`(() => {
    var b = document.querySelectorAll('.titlebar .tb-btn')[1];
    return { label: b.getAttribute('aria-label'), rects: b.querySelectorAll('svg rect').length, paths: b.querySelectorAll('svg path').length }
  })()`)
  say('最大化后 ' + JSON.stringify(maxed))
  await shoot('shell-3-maxed', { x: 0, y: 0, width: 1400, height: 128 })
  // 还原
  await js(`document.querySelectorAll('.titlebar .tb-btn')[1].dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(1100)

  /* ---- 4. 插件页 + 设置页（看排版重组） ---- */
  await goPage('插件')
  await wait(1400)
  await shoot('shell-4-plugins')
  await goPage('设置')
  await wait(1400)
  await shoot('shell-5-settings')

  /* ---- 5. 浅色主题（设计库说 OLED 只有深色，但工作台必须两套都成立） ---- */
  await js(`(() => {
    var raw = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}')
    raw.settings = Object.assign({}, raw.settings, { theme: 'light' })
    localStorage.setItem('workbench:state:v1', JSON.stringify(raw))
    return true
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await goPage('桌面')
  await wait(1600)
  const light = await js(`(() => ({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
    fg: getComputedStyle(document.body).color,
    titlebar: !!document.querySelector('.titlebar'),
  }))()`)
  say('浅色 ' + JSON.stringify(light))
  await shoot('shell-6-light')

  fs.writeFileSync(path.join(OUT, 'shot-shell.txt'), log.join('\n') + '\n', 'utf8')
  clearTimeout(HARD)
  app.exit(0)
}, 1200))
