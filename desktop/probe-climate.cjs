/**
 * 状态 + 显示联合探针（第二版）：
 *  1. 倒出 localStorage 里每个 workspace 的窗口清单（id/pluginId/visible/尺寸/折叠）
 *  2. 列出 DOM 里实际渲染的 .plugin-card（标题、rect、iframe query）
 *  3. 每个 iframe 的主题 / body 背景 / 是否真的有内容
 *  4. 控制台报错
 *
 * 用法：$env:WORKBENCH_DEV='1'; electron.exe desktop/probe-climate.cjs
 */
process.env.WORKBENCH_DEV = '1'
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
app.commandLine.appendSwitch('disable-http-cache')
const fs = require('node:fs')
const path = require('node:path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 180000)

const PROBE = `(() => {
  const out = {}
  // 1. 持久化状态
  try {
    const raw = localStorage.getItem('workbench:state:v1')
    out.stateRawLen = raw ? raw.length : 0
    if (raw) {
      const st = JSON.parse(raw)
      out.theme = st.settings && st.settings.theme
      out.workspaces = (st.workspaces || []).map((w) => ({
        id: w.id, name: w.name, current: !!w.current,
        windows: (w.windows || []).map((x) => ({
          id: x.id, p: x.pluginId, v: x.visible, w: x.w, h: x.h, x: x.x, y: x.y,
          col: !!x.collapsed, view: (x.config && x.config.view) || '(default)',
        })),
      }))
    } else out.workspaces = '(no state)'
  } catch (e) { out.stateErr = String(e.message || e) }

  // 2. DOM 卡片
  out.htmlTheme = document.documentElement.dataset.theme
  out.bodyBg = getComputedStyle(document.body).backgroundColor
  out.cards = [...document.querySelectorAll('.plugin-card')].map((c) => {
    const t = c.querySelector('.card-head .title')
    const f = c.querySelector('iframe')
    const r = c.getBoundingClientRect()
    return {
      title: (t ? t.textContent : '(no title)').trim().slice(0, 20),
      win: c.dataset.winId || '(none)',
      rect: Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height),
      collapsed: c.classList.contains('collapsed') || c.classList.contains('win-collapsed'),
      focus: c.classList.contains('focused'),
      iframe: f ? (f.getAttribute('src') || '').split('?')[1] || '(no query)' : '(no iframe)',
      text: (c.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90),
    }
  })

  // 3. iframe 内部
  out.frames = [...document.querySelectorAll('iframe')].map((f) => {
    let info = { q: (f.getAttribute('src') || '').split('?')[1] || '(none)' }
    try {
      const d = f.contentDocument
      if (d && d.body) {
        info.theme = d.documentElement.dataset.theme || '(none)'
        info.cls = d.documentElement.className || '(none)'
        info.bg = getComputedStyle(d.body).backgroundColor
        info.color = getComputedStyle(d.body).color
        info.hasClock = /\\d\\d:\\d\\d/.test(d.body.innerText || '')
        info.len = (d.body.innerText || '').replace(/\\s+/g, ' ').trim().length
        info.text = (d.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
      } else info.doc = '(null)'
    } catch (e) { info.err = String(e.message || e).slice(0, 60) }
    return info
  })
  return out
})()`

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 80 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] ?? null
    if (!win) await wait(100)
  }
  if (!win) { console.log('NO WINDOW'); app.exit(1); return }
  win.setSize(1400, 900)

  const errs = []
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 3 || /error/i.test(message)) errs.push('L' + line + ' ' + String(message).slice(0, 180) + ' @' + String(sourceId || '').split('/').pop())
  })

  await wait(5500)
  const r = await win.webContents.executeJavaScript(PROBE).catch((e) => ({ err: String(e.message || e) }))

  const out = ['===== 状态 + 显示探针 =====',
    'theme=' + r.theme + '  htmlTheme=' + r.htmlTheme + '  bodyBg=' + r.bodyBg,
    'stateRawLen=' + r.stateRawLen + (r.stateErr ? ' ERR=' + r.stateErr : '')]
  out.push('', '--- 持久化窗口清单 ---')
  if (Array.isArray(r.workspaces)) {
    for (const w of r.workspaces) {
      out.push('workspace ' + w.id + ' ' + w.name + (w.current ? ' (current)' : ''))
      for (const x of w.windows) {
        out.push('   ' + x.p + '  v=' + x.v + '  ' + x.w + 'x' + x.h + '@' + x.x + ',' + x.y +
          (x.col ? ' COLLAPSED' : '') + '  view=' + x.view + '  id=' + x.id)
      }
    }
  } else out.push(String(r.workspaces))
  out.push('', '--- DOM 卡片 (' + (r.cards || []).length + ') ---')
  for (const c of (r.cards || [])) {
    out.push('【' + c.title + '】 ' + c.rect + (c.collapsed ? ' COLLAPSED' : '') + (c.focus ? ' focused' : '') +
      '  iframe=' + c.iframe)
    out.push('    text="' + c.text + '"')
  }
  out.push('', '--- iframe 内部 ---')
  for (const f of (r.frames || [])) {
    out.push('  q=' + f.q + ' theme=' + (f.theme || f.doc || f.err) + ' bg=' + (f.bg || '') +
      ' color=' + (f.color || '') + ' clock=' + f.hasClock + ' len=' + (f.len ?? '?') + ' text="' + (f.text || '') + '"')
  }
  out.push('', 'console errors: ' + (errs.length ? 'none' : ''))
  errs.slice(0, 40).forEach((e) => out.push('  ' + e))

  const text = out.join('\n')
  console.log(text)
  const dir = path.join(__dirname, '..', 'shots')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'probe-climate.txt'), text + '\n', 'utf8')
  clearTimeout(HARD)
  app.exit(0)
}, 1200))
