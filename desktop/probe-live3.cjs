/**
 * 深挖时钟 / 天气内部布局（连 9222）：dump 根元素 outerHTML + 计算样式，
 * 判断「72px 宽挤右边」是插件自身布局、宿主 CSS、还是主题导致。
 *
 * 用法：node desktop/probe-live3.cjs
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const out = { frames: [] }
  const pick = (el, w) => {
    if (!el) return null
    const cs = w.getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase() + (el.className ? '.' + [...String(el.className).split(/\\s+/)].filter(Boolean).slice(0,4).join('.') : ''),
      rect: Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height),
      display: cs.display, width: cs.width, maxWidth: cs.maxWidth, position: cs.position,
      left: cs.left, right: cs.right, margin: cs.margin, padding: cs.padding,
      fontSize: cs.fontSize, color: cs.color, bg: cs.backgroundColor, flex: cs.flex, transform: cs.transform,
      text: (el.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 80),
    }
  }
  for (const f of document.querySelectorAll('iframe')) {
    const info = { src: (f.getAttribute('src') || '').split('/').slice(-2).join('/') }
    try {
      const d = f.contentDocument, w = f.contentWindow
      if (d && d.body) {
        const de = d.documentElement
        info.theme = de.dataset.theme || '(none)'
        info.rootCls = de.className || '(none)'
        // 顶层直接子节点
        info.bodyKids = [...d.body.children].map((el) => pick(el, w)).filter(Boolean)
        // 最深的那个有文字的容器
        const wrap = d.querySelector('.wrap') || d.body.firstElementChild
        info.wrap = pick(wrap, w)
        if (wrap) info.wrapKids = [...wrap.children].map((el) => pick(el, w)).filter(Boolean)
        // 若有时钟的秒元素
        const time = d.querySelector('.time, .clock, h1, .digits, #t, [class*=time]')
        info.time = pick(time, w)
        // 深色变量
        const cs = w.getComputedStyle(de)
        info.vars = {
          bg: cs.getPropertyValue('--bg').trim(), fg: cs.getPropertyValue('--fg').trim(),
          surface: cs.getPropertyValue('--surface').trim(), brand: cs.getPropertyValue('--brand').trim(),
        }
        info.bodyKidsCount = d.body.children.length
        info.html = d.body.innerHTML.replace(/\\s+/g, ' ').slice(0, 500)
      } else info.doc = '(null)'
    } catch (e) { info.err = String(e.message || e).slice(0, 80) }
    out.frames.push(info)
  }
  return JSON.stringify(out)
})()`

async function main() {
  let targets = null
  for (let i = 0; i < 40 && !targets; i++) {
    try { targets = await (await fetch('http://127.0.0.1:9222/json')).json() } catch (e) { await wait(250) }
  }
  const page = targets.find((t) => t.type === 'page' && !/devtools/.test(t.url)) || targets[0]
  console.log('target=' + page.url.slice(0, 80))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (m, p) => new Promise((res, rej) => {
    const mid = ++id
    const timer = setTimeout(() => { pending.delete(mid); rej(new Error('timeout on ' + m)) }, 15000)
    pending.set(mid, (v) => { clearTimeout(timer); res(v) })
    ws.send(JSON.stringify({ id: mid, method: m, params: p }))
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  console.log('ws open')
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const cb = pending.get(m.id); pending.delete(m.id); cb(m.result) }
  })
  await send('Runtime.enable')
  await wait(300)

  console.log('evaluating...')
  const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true, awaitPromise: false })
  if (r.exceptionDetails) {
    console.log('EVAL EXCEPTION: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    ws.close(); process.exit(1)
  }
  let d = {}
  try { d = JSON.parse(r.result.value) } catch (e) { console.log('parse fail: ' + e.message + ' val=' + String(r.result && r.result.value).slice(0, 200)); process.exit(1) }

  for (const f of d.frames || []) {
    console.log('===== ' + f.src + ' =====')
    if (f.doc) { console.log('  doc=' + f.doc); continue }
    if (f.err) { console.log('  ERR=' + f.err); continue }
    console.log('  theme=' + f.theme + ' rootCls=' + f.rootCls + ' bodyKids=' + f.bodyKidsCount)
    console.log('  vars=' + JSON.stringify(f.vars))
    console.log('  -- body kids --')
    for (const k of f.bodyKids) console.log('    ' + k.tag + '  ' + k.rect + '  disp=' + k.display + ' w=' + k.width + ' pos=' + k.position + ' text="' + k.text + '"')
    if (f.wrap) console.log('  -- wrap --\n    ' + f.wrap.tag + '  ' + f.wrap.rect + '  disp=' + f.wrap.display + ' w=' + f.wrap.width + ' maxW=' + f.wrap.maxWidth + ' margin=' + f.wrap.margin + ' pos=' + f.wrap.position + ' left=' + f.wrap.left + ' right=' + f.wrap.right + ' flex=' + f.wrap.flex + ' text="' + f.wrap.text + '"')
    if (f.wrapKids) for (const k of f.wrapKids) console.log('      ' + k.tag + '  ' + k.rect + '  disp=' + k.display + ' w=' + k.width + ' fs=' + k.fontSize + ' color=' + k.color + ' text="' + k.text + '"')
    if (f.time) console.log('  -- time --\n    ' + f.time.tag + '  ' + f.time.rect + '  fs=' + f.time.fontSize + ' color=' + f.time.color + ' text="' + f.time.text + '"')
    console.log('  -- html --\n    ' + f.html)
    console.log('')
  }
  ws.close(); process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
