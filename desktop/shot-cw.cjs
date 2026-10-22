/**
 * 深浅两主题下的「时钟 + 天气」桌面截图（4 张），给人工验收本轮背景色改动。
 *
 *   cw-dark-1-desktop.png / cw-dark-2-cards.png
 *   cw-light-1-desktop.png / cw-light-2-cards.png
 *
 * 必须 require('./main.cjs') 起窗口（preload → isDesktop → TitleBar）。
 * 用法：$env:WORKBENCH_DEV='1'; electron.exe desktop/shot-cw.cjs
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
  const shoot = async (name, rect) => {
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
    await wait(600)
    const size = win.getContentSize()
    const r = rect || { x: 0, y: 0, width: size[0], height: size[1] }
    const img = await win.webContents.capturePage(r)
    const p = path.join(OUT, name + '.png')
    const buf = img.toPNG()
    fs.writeFileSync(p, buf)
    const g = img.getSize()
    say('✓ ' + name + '.png ' + JSON.stringify({ width: g.width, height: g.height, kb: Math.round(buf.length / 1024) }))
  }

  /* ---------- 数据：只装 时钟 / 天气（默认工作台自带），清掉多余 ---------- */
  await win.loadURL('about:blank')
  await wait(500)
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
  await win.loadURL(process.env.AUDIT_URL || 'http://localhost:5173/')
  await wait(2600)

  /* 默认工作台已有 时钟/天气/便签；这里只保留前两个，便签挪出视野即可（不删状态） */
  await js(`(() => {
    var raw = JSON.parse(localStorage.getItem('workbench:state:v1') || 'null')
    if (!raw) return 'no-state'
    return 'ok'
  })()`)
  await wait(300)

  /* 关掉便签那张卡，画面只留 时钟 + 天气 */
  await js(`(() => {
    var card = [...document.querySelectorAll('.plugin-card')].find(function (c) {
      var t = c.querySelector('.card-head .title'); return t && t.textContent.includes('便签')
    })
    if (!card) return 'no-note'
    var x = [...card.querySelectorAll('button')].find(function (b) { return (b.getAttribute('aria-label') || b.textContent || '').includes('关闭') })
      || card.querySelectorAll('button')[card.querySelectorAll('button').length - 1]
    if (x) { x.click(); return 'closed' }
    return 'no-btn'
  })()`)
  await wait(900)

  /* ---------- 确保两个 iframe 都活着（reload 竞态兜底） ---------- */
  await js(`(() => {
    for (var i = 0; i < document.querySelectorAll('iframe').length; i++) {
      var f = document.querySelectorAll('iframe')[i]
      try {
        var d = f.contentDocument
        if (!d || !d.scripts || !d.scripts.length) { f.contentWindow.location.href = f.getAttribute('src') }
      } catch (e) {}
    }
    return true
  })()`)
  await wait(2000)

  const read = async () => js(`(() => {
    var out = { theme: document.documentElement.dataset.theme, cards: document.querySelectorAll('.plugin-card').length, frames: [] }
    for (var i = 0; i < document.querySelectorAll('iframe').length; i++) {
      var f = document.querySelectorAll('iframe')[i]
      var m = (f.getAttribute('src') || '').match(/\\/plugins\\/(clock|weather)\\//)
      if (!m) continue
      try {
        var d = f.contentDocument
        var bs = d ? getComputedStyle(d.body) : null
        out.frames.push({ n: m[1], alive: !!(d && d.scripts && d.scripts.length), bg: bs && bs.backgroundColor, fg: bs && bs.color, theme: d && d.documentElement.dataset.theme })
      } catch (e) { out.frames.push({ n: m[1], err: String(e.message || e).slice(0, 40) }) }
    }
    return out
  })()`)

  say('深色 ' + JSON.stringify(await read()))
  await shoot('cw-dark-1-desktop')

  /* 卡片特写：量两张卡的 rect，只给尺寸（dpr 安全） */
  const rects = await js(`(() => {
    var out = []
    for (var i = 0; i < document.querySelectorAll('.plugin-card').length; i++) {
      var c = document.querySelectorAll('.plugin-card')[i]
      var t = c.querySelector('.card-head .title')
      if (!t || !/时钟|天气/.test(t.textContent)) continue
      var r = c.getBoundingClientRect()
      out.push({ n: t.textContent.trim().slice(0, 6), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) })
    }
    return out
  })()`)
  say('rects ' + JSON.stringify(rects))
  if (rects.length) {
    const xs = rects.map((r) => r.x), ys = rects.map((r) => r.y)
    const x0 = Math.min(...xs) - 8, y0 = Math.min(...ys) - 8
    const x1 = Math.max(...rects.map((r) => r.x + r.w)) + 8
    const y1 = Math.max(...rects.map((r) => r.y + r.h)) + 8
    await shoot('cw-dark-2-cards', { x: Math.max(0, x0), y: Math.max(0, y0), width: x1 - Math.max(0, x0), height: y1 - Math.max(0, y0) })
  }

  /* ---------- 切浅色 ---------- */
  await js(`(() => {
    var raw = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}')
    raw.settings = Object.assign({}, raw.settings, { theme: 'light' })
    localStorage.setItem('workbench:state:v1', JSON.stringify(raw))
    return true
  })()`)
  await win.webContents.reload()
  await wait(2800)

  /* 同样兜底确保 iframe 活着 */
  await js(`(() => {
    for (var i = 0; i < document.querySelectorAll('iframe').length; i++) {
      var f = document.querySelectorAll('iframe')[i]
      try {
        var d = f.contentDocument
        if (!d || !d.scripts || !d.scripts.length) { f.contentWindow.location.href = f.getAttribute('src') }
      } catch (e) {}
    }
    return true
  })()`)
  await wait(2000)

  say('浅色 ' + JSON.stringify(await read()))
  await shoot('cw-light-1-desktop')

  const rects2 = await js(`(() => {
    var out = []
    for (var i = 0; i < document.querySelectorAll('.plugin-card').length; i++) {
      var c = document.querySelectorAll('.plugin-card')[i]
      var t = c.querySelector('.card-head .title')
      if (!t || !/时钟|天气/.test(t.textContent)) continue
      var r = c.getBoundingClientRect()
      out.push({ n: t.textContent.trim().slice(0, 6), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) })
    }
    return out
  })()`)
  say('rects2 ' + JSON.stringify(rects2))
  if (rects2.length) {
    const xs = rects2.map((r) => r.x), ys = rects2.map((r) => r.y)
    const x0 = Math.min(...xs) - 8, y0 = Math.min(...ys) - 8
    const x1 = Math.max(...rects2.map((r) => r.x + r.w)) + 8
    const y1 = Math.max(...rects2.map((r) => r.y + r.h)) + 8
    await shoot('cw-light-2-cards', { x: Math.max(0, x0), y: Math.max(0, y0), width: x1 - Math.max(0, x0), height: y1 - Math.max(0, y0) })
  }

  fs.writeFileSync(path.join(OUT, 'shot-cw.txt'), log.join('\n') + '\n', 'utf8')
  clearTimeout(HARD)
  app.exit(0)
}, 1200))
