/**
 * 亮块探针：在深色主题下找出「大面积亮色区域」。
 *
 * 用途：用户反馈「深色模式下窗口背景还是亮色」时，不靠肉眼猜，直接量。
 * 判定口径与 desktop/audit-ui.cjs 的 effBg 保持一致：
 * 从元素自身向上找第一个不透明的 background-color，做 alpha 合成，
 * 再算相对亮度；面积取 getBoundingClientRect 的可见部分。
 *
 * 同时把每个 iframe 的文档背景也量出来 —— 插件是独立 HTML，
 * 宿主就算全黑，插件内部的浅色底一样刺眼。
 *
 * 用法：$env:WORKBENCH_DEV='1'; electron.exe desktop/probe-bright.cjs
 */
process.env.WORKBENCH_DEV = '1'
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
// dev 模式下必须禁掉 HTTP 缓存，否则 Electron 会拿上一次运行缓存的
// global.css / 插件模块，量出来的令牌是旧值，看着像「改了没生效」。
app.commandLine.appendSwitch('disable-http-cache')
const fs = require('node:fs')
const path = require('node:path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 180000)

const PROBE = `(() => {
  const parse = (s) => {
    if (!s) return null
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
    let m = s.match(/^rgba?\\(([^)]+)\\)$/)
    if (m) {
      const p = m[1].split(',').map(Number)
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
    }
    m = s.match(/^color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)(?: \\/ ([\\d.]+))?\\)$/)
    if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] == null ? 1 : +m[4] }
    return null
  }
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  })
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const effBg = (el) => {
    let acc = null
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0) {
        acc = acc ? over(acc, c) : c
        if (acc.a >= 0.999) return acc
      }
    }
    const body = parse(getComputedStyle(document.body).backgroundColor)
    if (body && body.a > 0) acc = acc ? over(acc, body) : body
    return acc || { r: 255, g: 255, b: 255, a: 1 }
  }
  const sel = (el) => {
    if (!el) return '(null)'
    let s = el.tagName.toLowerCase()
    if (el.id) s += '#' + el.id
    if (el.classList && el.classList.length) s += '.' + [...el.classList].slice(0, 3).join('.')
    return s
  }

  const bright = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 40 || r.height < 40) continue
    const area = Math.min(r.width, innerWidth) * Math.min(r.height, innerHeight)
    if (area < 6000) continue
    const bg = effBg(el)
    const L = lum(bg)
    if (L > 0.45) {
      bright.push({
        sel: sel(el), L: +L.toFixed(3),
        w: Math.round(r.width), h: Math.round(r.height),
        area: Math.round(r.width * r.height),
        bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
      })
    }
  }
  bright.sort((a, b) => b.area - a.area)

  const frames = []
  for (const f of document.querySelectorAll('iframe')) {
    let info = { src: (f.getAttribute('src') || '').split('?')[0], q: (f.getAttribute('src') || '').split('?')[1] || '' }
    try {
      const d = f.contentDocument
      if (d && d.body) {
        const c = parse(getComputedStyle(d.body).backgroundColor)
        const de = d.documentElement
        info.bodyBg = c ? 'rgb(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ')' : '(none)'
        info.bodyL = c ? +lum(c).toFixed(3) : null
        info.htmlTheme = de.dataset.theme || '(none)'
        info.htmlClass = de.className || '(none)'
        info.prefersDark = d.defaultView.matchMedia('(prefers-color-scheme: dark)').matches
      }
    } catch (e) { info.err = String(e.message || e).slice(0, 60) }
    frames.push(info)
  }

  const cs = getComputedStyle(document.documentElement)
  return {
    href: location.href,
    theme: document.documentElement.dataset.theme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyL: +lum(effBg(document.body)).toFixed(3),
    tokens: {
      bg: cs.getPropertyValue('--bg').trim(),
      panel: cs.getPropertyValue('--panel').trim(),
      surface2: cs.getPropertyValue('--surface-2').trim(),
      card: cs.getPropertyValue('--card').trim(),
      sidebar: cs.getPropertyValue('--sidebar').trim(),
    },
    backdrop: (() => {
      const b = document.querySelector('.wb-backdrop')
      if (!b) return '(no .wb-backdrop)'
      const c = parse(getComputedStyle(b).backgroundColor)
      return c ? 'rgb(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ') a=' + c.a : '(none)'
    })(),
    cards: document.querySelectorAll('.plugin-card').length,
    brightCount: bright.length,
    bright: bright.slice(0, 25),
    frames: frames.slice(0, 12),
  }
})()`

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 80 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] ?? null
    if (!win) await wait(100)
  }
  if (!win) { console.log('NO WINDOW'); app.exit(1); return }
  win.setSize(1400, 900)
  await wait(3500)

  const r = await win.webContents.executeJavaScript(PROBE)
  const out = ['===== 亮块探针 =====',
    'href=' + r.href,
    'theme=' + r.theme + '  bodyBg=' + r.bodyBg + '  bodyL=' + r.bodyL,
    'tokens=' + JSON.stringify(r.tokens),
    'backdrop=' + r.backdrop + '  cards=' + r.cards,
    '',
    '大面积亮块（L>0.45，按面积降序）共 ' + r.brightCount + ' 个:']
  for (const b of r.bright) {
    out.push('  L=' + b.L + '  ' + b.w + 'x' + b.h + ' (' + b.area + 'px²)  ' + b.bg + '  ' + b.sel)
  }
  out.push('', 'iframe 文档背景:')
  for (const f of r.frames) {
    out.push('  ' + (f.q || '(no query)') + '  bodyBg=' + f.bodyBg + '  L=' + f.bodyL +
      '  htmlTheme=' + f.htmlTheme + '  class=' + f.htmlClass + '  prefersDark=' + f.prefersDark +
      (f.err ? '  ERR=' + f.err : ''))
  }
  const text = out.join('\n')
  console.log(text)
  const dir = path.join(__dirname, '..', 'shots')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'probe-bright.txt'), text + '\n', 'utf8')
  clearTimeout(HARD)
  app.exit(0)
}, 1200))
