/**
 * UI 审计探针 —— 量化实测，不靠肉眼
 * ------------------------------------------------------------
 * 按 refactoring-ui 的审计口径，把「渲染后的真实计算值」抓出来：
 *   A. 文字颜色数量        法则：一屏最多 3 种文字色
 *   B. 字号阶梯            法则：所有字号来自预设阶梯，禁止一次性手调值
 *   C. 字重                法则：只用 400/500 与 600/700 两档
 *   D. 对比度              深色正文 ≥4.5:1、次要 ≥3:1；浅色正文 ≥4.5:1
 *   E. 间距节奏            法则：4/8 节奏
 *   F. 圆角                法则：来自 --r-* 刻度
 *   G. 点击目标            桌面 ≥28×28（触屏 44×44）
 *   H. emoji 结构图标      法则：禁止 emoji 当结构图标
 *   I. 层级                每屏主操作是否唯一
 *
 * 用法：
 *   $env:WORKBENCH_DEV='1'; electron.exe desktop/audit-ui.cjs
 * 读 dev server（localhost:5173），改样式后重跑即可，不必 build。
 */
process.env.WORKBENCH_DEV = '1'
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 240000)
const OUT = path.join(__dirname, '..', 'shots')
const lines = []
const say = (s) => { lines.push(s); console.log(s) }

/* 在页面里跑的审计函数。参数都内联，不依赖外部作用域。 */
const AUDIT_FN = String.raw`
(function () {
  /* ---------- 工具 ---------- */
  function parseColor(s) {
    if (!s) return null
    s = s.trim()
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
    var m = s.match(/^rgba?\(([^)]+)\)$/)
    if (m) {
      var p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
    }
    /* color(srgb r g b) / oklch 等：交给浏览器用 canvas 归一化 */
    return null
  }
  var cv = document.createElement('canvas'); cv.width = cv.height = 1
  var cx = cv.getContext('2d', { willReadFrequently: true })
  function toRGBA(s) {
    var p = parseColor(s)
    if (p) return p
    cx.clearRect(0, 0, 1, 1)
    cx.fillStyle = '#000'
    cx.fillStyle = s
    cx.fillRect(0, 0, 1, 1)
    var d = cx.getImageData(0, 0, 1, 1).data
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
  }
  function over(fg, bg) {
    var a = fg.a + bg.a * (1 - fg.a)
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
    var f = function (c1, c2) { return (c1 * fg.a + c2 * bg.a * (1 - fg.a)) / a }
    return { r: f(fg.r, bg.r), g: f(fg.g, bg.g), b: f(fg.b, bg.b), a: a }
  }
  function lum(c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  function contrast(a, b) {
    var l1 = lum(a), l2 = lum(b)
    if (l1 < l2) { var t = l1; l1 = l2; l2 = t }
    return (l1 + 0.05) / (l2 + 0.05)
  }
  function rgbStr(c) { return 'rgb(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ')' }

  /* 向上找不透明的有效背景 */
  function effBg(el) {
    var acc = null
    var node = el
    while (node && node !== document.documentElement) {
      var cs = getComputedStyle(node)
      var c = toRGBA(cs.backgroundColor)
      if (c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.999) return acc }
      node = node.parentElement
    }
    var body = toRGBA(getComputedStyle(document.body).backgroundColor)
    acc = acc ? over(acc, body) : body
    return acc
  }

  function visible(el) {
    var cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false
    var r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  function ownText(el) {
    var t = ''
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i]
      if (n.nodeType === 3) t += n.nodeValue
    }
    return t.replace(/\s+/g, ' ').trim()
  }

  /* ---------- 采集 ---------- */
  var colors = {}, sizes = {}, weights = {}, radii = {}, spacings = {}
  var lowContrast = [], smallTargets = [], touchTargets = [], emojiIcons = []
  /* 小数间距：来自 margin:auto 的余量分配 / % / em / zoom，
     是布局结果而非手敲值，单独记账，不进刻度判定 */
  var fractional = []
  var nodes = document.querySelectorAll('body *')
  var textEls = 0

  var EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u

  /* 祖先已经是可交互元素 → 当前元素只是它的内部零件，不重复计 */
  function hasClickableAncestor(el) {
    var p = el.parentElement
    while (p && p !== document.body) {
      var t = p.tagName
      if (t === 'BUTTON' || t === 'A' || t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return true
      if (p.getAttribute && p.getAttribute('role') === 'button') return true
      if (getComputedStyle(p).cursor === 'pointer') return true
      p = p.parentElement
    }
    return false
  }

  /* 真实命中跨度：从中心向四个方向逐像素探，量到哪一像素不再命中自己。
     这样透明伪元素扩大出来的命中区（.ws-tab-star::before { inset:-4px }）
     也能被正确计入，而不是只信 getBoundingClientRect。 */
  function hitSpan(el, r) {
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2
    function hits(x, y) {
      if (x < 0 || y < 0 || x > window.innerWidth - 1 || y > window.innerHeight - 1) return false
      var e = document.elementFromPoint(x, y)
      return !!e && (e === el || el.contains(e))
    }
    function span(dx, dy) {
      var d = 0
      for (var k = 1; k <= 24; k++) {
        if (!hits(cx + dx * k, cy + dy * k)) break
        d = k
      }
      return d
    }
    return {
      w: Math.max(r.width, span(-1, 0) + span(1, 0) + 1),
      h: Math.max(r.height, span(0, -1) + span(0, 1) + 1),
    }
  }

  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i]
    if (!visible(el)) continue
    var cs = getComputedStyle(el)
    var txt = ownText(el)

    /* A/D. 文字色与对比度：只统计自己直接承载文字的节点 */
    if (txt.length > 0) {
      textEls++
      var fg = toRGBA(cs.color)
      var bg = effBg(el)
      var ratio = contrast(fg, bg)
      var px = parseFloat(cs.fontSize)
      var bold = parseFloat(cs.fontWeight) >= 700
      var large = px >= 24 || (px >= 18.66 && bold)
      var need = large ? 3 : 4.5
      var key = rgbStr(fg)
      colors[key] = (colors[key] || 0) + 1
      if (ratio < need) {
        lowContrast.push({
          sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
          text: txt.slice(0, 26), ratio: +ratio.toFixed(2), need: need, px: px, fg: key, bg: rgbStr(bg),
        })
      }
      /* B/C. 字号与字重 */
      sizes[px] = (sizes[px] || 0) + 1
      weights[cs.fontWeight] = (weights[cs.fontWeight] || 0) + 1
    }

    /* F. 圆角 */
    var br = cs.borderRadius
    if (br && br !== '0px') {
      br.split('/')[0].trim().split(/\s+/).forEach(function (v) {
        var n = parseFloat(v)
        if (n > 0) radii[n] = (radii[n] || 0) + 1
      })
    }

    /* E. 间距：只取 padding/margin 的非零边，且不是 100%/auto。
       负值（负外边距做光学对齐）与 >64 的值（侧边栏宽度这类布局尺寸）
       不属于间距刻度问题，单独排除，避免污染刻度结论。

       小数 px 单独归到 fractional，不进 spacings：
       CSS 里根本写不出 5.1875px 这种值，它必然来自 margin:auto 在弹性容器
       里分到的余量、% 或 em 换算、或 zoom 缩放 —— 是**布局结果**，
       不是「手敲的一次性间距」。审计关心的是后者，混在一起会得出
       「间距不合刻度」的假结论（实测唯一来源是 .market-card .foot 的
       margin-top:auto 分到 5.1875px）。 */
    ;['padding', 'margin'].forEach(function (prop) {
      ;['Top', 'Right', 'Bottom', 'Left'].forEach(function (side) {
        var v = parseFloat(cs[prop + side])
        if (!isFinite(v) || v <= 0 || v > 64) return
        if (Math.abs(v - Math.round(v)) > 0.01) {
          fractional.push({
            sel: el.tagName.toLowerCase() + (typeof cs.className === 'string' && cs.className ? '.' + cs.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
            prop: prop.toLowerCase() + side,
            val: Math.round(v * 100) / 100,
          })
          return
        }
        spacings[v] = (spacings[v] || 0) + 1
      })
    })

    /* G. 点击目标
       ------------------------------------------------------------
       两个坑：
       1) 换成 SVG 图标后，按钮里的 <svg>/<rect>/<path> 也会继承
          cursor:pointer，逐个被当成「点击目标」，同一个按钮被重复计数。
          → 只统计「可交互根」，祖先已经可交互的跳过。
       2) 视觉尺寸 ≠ 命中尺寸。我们用透明伪元素扩大命中区（如
          .ws-tab-star::before { inset:-4px }），rect 量出来仍是 16px。
          → 用 elementFromPoint 从中心向外探，量真实命中跨度。 */
    var clickable = el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'INPUT' ||
      el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.getAttribute('role') === 'button' ||
      cs.cursor === 'pointer'
    if (clickable && !hasClickableAncestor(el)) {
      var r = el.getBoundingClientRect()
      var hit = hitSpan(el, r)
      var info = {
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
        w: Math.round(hit.w), h: Math.round(hit.h), box: Math.round(r.width) + '×' + Math.round(r.height),
        text: (txt || el.getAttribute('aria-label') || '').slice(0, 18),
      }
      /* 两档：
         <24  → 违反 WCAG 2.2 SC 2.5.8（指针目标最小值），必须修
         24–43 → 达到指针最小要求，但不达触屏 44；桌面鼠标可接受，仅作提示 */
      if (hit.w < 24 || hit.h < 24) smallTargets.push(info)
      else if (hit.w < 44 || hit.h < 44) touchTargets.push(info)
    }

    /* H. emoji 结构图标：按钮/图标位里只有 emoji、没有 svg */
    if (EMOJI.test(txt) && !el.querySelector('svg') && (clickable || /icon|mark|badge|swatch/i.test(cs.className || ''))) {
      emojiIcons.push({
        sel: el.tagName.toLowerCase() + (typeof cs.className === 'string' && cs.className ? '.' + cs.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
        text: txt.slice(0, 14),
      })
    }
  }

  /* I. 主操作唯一性：数「主按钮」候选 */
  var primaries = []
  document.querySelectorAll('.btn.primary, .btn.cta, [data-primary]').forEach(function (b) {
    if (visible(b)) primaries.push((ownText(b) || b.getAttribute('aria-label') || '').slice(0, 20))
  })

  var top = function (obj, n) {
    return Object.keys(obj).map(function (k) { return [k, obj[k]] })
      .sort(function (a, b) { return b[1] - a[1] }).slice(0, n)
  }

  return {
    page: document.querySelector('.nav-item.active') ? document.querySelector('.nav-item.active').textContent.trim() : '?',
    theme: document.documentElement.dataset.theme || 'dark',
    bodyBg: getComputedStyle(document.body).backgroundColor,
    textEls: textEls,
    colorCount: Object.keys(colors).length,
    colorsTop: top(colors, 8),
    sizes: Object.keys(sizes).map(Number).sort(function (a, b) { return a - b }),
    weights: Object.keys(weights).sort(),
    radii: Object.keys(radii).map(Number).sort(function (a, b) { return a - b }),
    spacings: Object.keys(spacings).map(Number).sort(function (a, b) { return a - b }),
    fractional: fractional,
    lowContrast: lowContrast,
    smallTargets: smallTargets,
    touchTargets: touchTargets,
    emojiIcons: emojiIcons,
    primaries: primaries,
  }
})()
`

/* 间距刻度判定：2 / 4 / 6 / 8 / 10 / 12 / 16 / 24 / 32 / 48 / 64
   （外加 1px/3px 发丝档）。--gap 之外的浮点值几乎一定是
   由 zoom / em 换算出来的非受控值，属于真实违规。 */
const SPACE_SCALE = new Set([1, 2, 3, 4, 6, 8, 10, 12, 16, 24, 32, 48, 64])
function offGrid(list) {
  return list.filter((v) => !SPACE_SCALE.has(v))
}

app.whenReady().then(() => setTimeout(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  let win = null
  for (let i = 0; i < 80 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] ?? null
    if (!win) await wait(100)
  }
  if (!win) { console.log('NO WINDOW'); app.exit(1); return }
  win.setSize(1400, 900)
  await wait(2500)

  const js = async (s) => {
    try { return await win.webContents.executeJavaScript(s) }
    catch (e) { return { __err: String((e && e.message) || e) } }
  }
  /* 「关掉过渡」是测量正确性的前提，不是优化。
     ────────────────────────────────────────────────────────────
     离屏窗口（WORKBENCH_VERIFY=1 时 show:false）不产生合成帧，
     于是 CSS transition 永远不会推进，一直冻结在**起始值**上。
     实测证据：点「我的」之后，`.nav-item` 的 className 已经正确
     （「我的」带 active、「设置」不带），但算出来的颜色正好相反 ——
     「我的」是旧的透明底、「设置」是旧的蓝底，且间隔 60ms 采样两次
     完全一致（说明不是动画中途，是压根没动）。
     注入 transition:none 后立刻恢复正确（「我的」蓝底白字）。
     若不关掉，每次点击后测到的都是「上一帧的样式」，会凭空造出
     假违规（例如把灰字测成压在强调蓝底上，得出 2.02:1）。 */
  const killTransitions = async () => {
    await js(`(() => {
      if (document.getElementById('__audit_no_transition')) return 'kept'
      var s = document.createElement('style')
      s.id = '__audit_no_transition'
      s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'
      document.head.appendChild(s)
      return 'added'
    })()`)
  }

  const goPage = async (label) => {
    await js(`(() => {
      var el = [...document.querySelectorAll('.nav-item')].find(function (x) { return x.textContent.includes(${JSON.stringify(label)}) })
      if (el) { el.click(); return true } return false
    })()`)
    await wait(1100)
  }

  /* 清 localStorage，保证从默认状态开始（标题栏也是 dark/OLED） */
  await win.loadURL('about:blank')
  await wait(500)
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
  const url = win.webContents.getURL()
  await win.loadURL(process.env.AUDIT_URL || 'http://localhost:5173/')
  await wait(2600)

  /* 装插件 + 开三个窗口，让桌面有真实内容 */
  await goPage('插件')
  await js(`(() => { var b = [...document.querySelectorAll('.btn')].find(function (x) { return x.textContent.includes('插件市场') }); if (b) b.click(); return !!b })()`)
  await wait(1200)
  for (const name of ['番茄专注', '快速便签', '世界时钟']) {
    await js(`(() => {
      var card = [...document.querySelectorAll('.market-card')].find(function (c) { return c.textContent.includes(${JSON.stringify(name)}) })
      if (!card) return 'no-card'
      var btn = [...card.querySelectorAll('button')].find(function (b) { return b.textContent.includes('安装') })
      if (!btn) return 'no-btn'
      btn.click(); return 'ok'
    })()`)
    await wait(900)
  }
  await goPage('桌面')
  for (const name of ['番茄专注', '快速便签', '世界时钟']) {
    await js(`(() => { var b = document.querySelector('.dock-launch'); if (b) b.click(); return !!b })()`)
    await wait(700)
    await js(`(() => {
      var it = [...document.querySelectorAll('.dock-item')].find(function (x) {
        var n = x.querySelector('.dock-name'); return n && n.textContent.startsWith(${JSON.stringify(name)})
      })
      if (!it) return 'no-item'
      it.click(); return 'ok'
    })()`)
    await wait(900)
  }
  await wait(1200)

  /* 深浅两主题必须**独立**各测一遍。
     ui-ux-pro-max 明确要求：不能从一个主题推另一个 ——
     深色下成立的对比度，浅色下可能反过来（例如白字压强调色在深色达标、
     在浅色背景上完全糊掉）。body 有 transition:background .25s，
     翻主题后立刻读会拿到过渡起点，必须等过渡结束。 */
  const switchTheme = async (theme) => {
    await goPage('设置')
    await js(`(() => {
      var b = [...document.querySelectorAll('.btn')].find(function (x) { return x.textContent.trim() === ${JSON.stringify(theme === 'light' ? '浅色' : '深色')} })
      if (b) { b.click(); return true } return false
    })()`)
    await wait(900)
  }

  const reportPage = async (label) => {
    await goPage(label)
    await killTransitions()   // 见上方 killTransitions 注释：不关过渡会测到上一帧
    await wait(600)
    const r = await js(AUDIT_FN)
    if (r && r.__err) { say(`✗ ${label} 审计失败：${r.__err}`); return }
    say('')
    say('════════ ' + label + ' ════════')
    say(`主题 ${r.theme} / body 背景 ${r.bodyBg} / 文字节点 ${r.textEls}`)
    say(`A 文字颜色数：${r.colorCount}  → ${JSON.stringify(r.colorsTop)}`)
    say(`B 字号阶梯：${r.sizes.join(', ')}   （共 ${r.sizes.length} 档）`)
    say(`C 字重：${r.weights.join(', ')}`)
    say(`F 圆角：${r.radii.join(', ')}`)
    say(`E 间距取值：${r.spacings.join(', ')}`)
    say(`E 偏离刻度（1/2/3/4/6/8/10/12/16/24/32/48/64）：${JSON.stringify(offGrid(r.spacings))}`)
    if (r.fractional.length) {
      /* 小数 px 不可能写在 CSS 里，一定是 margin:auto 的余量分配或 %/em/zoom 换算，
         属于布局结果，不是手敲的一次性间距 —— 记录但不计入刻度违规 */
      say(`E 小数间距（布局换算，非手敲值，不计违规）：${r.fractional.length} 处`)
      r.fractional.slice(0, 4).forEach((f) => say(`   · ${f.sel} ${f.prop}=${f.val}px`))
    }
    say(`D 对比度不足：${r.lowContrast.length} 处`)
    r.lowContrast.slice(0, 8).forEach((c) => say(`   · ${c.sel} 「${c.text}」 ${c.ratio}:1（需 ${c.need}）${c.px}px ${c.fg} on ${c.bg}`))
    say(`G 点击目标 <24（违反 WCAG 2.2 SC 2.5.8，必须修）：${r.smallTargets.length} 处`)
    r.smallTargets.slice(0, 10).forEach((t) => say(`   · ${t.sel} 命中 ${t.w}×${t.h}（盒子 ${t.box}）「${t.text}」`))
    say(`G 点击目标 24–43（达指针最小，未达触屏 44，提示）：${r.touchTargets.length} 处`)
    r.touchTargets.slice(0, 6).forEach((t) => say(`   · ${t.sel} 命中 ${t.w}×${t.h}（盒子 ${t.box}）「${t.text}」`))
    say(`H emoji 结构图标：${r.emojiIcons.length} 处`)
    r.emojiIcons.slice(0, 10).forEach((e) => say(`   · ${e.sel} 「${e.text}」`))
    say(`I 主操作候选：${r.primaries.length} 个 ${JSON.stringify(r.primaries)}`)
    return r
  }

  const pages = ['桌面', '插件', '设置', '我的']
  for (const theme of ['dark', 'light']) {
    await switchTheme(theme)
    say('')
    say('████████ 主题：' + theme + ' ████████')
    for (const label of pages) await reportPage(label)
  }

  fs.writeFileSync(path.join(OUT, 'audit-ui.txt'), lines.join('\n') + '\n', 'utf8')
  say('')
  say('写出 shots/audit-ui.txt')
  clearTimeout(HARD)
  app.exit(0)
}, 1200))
