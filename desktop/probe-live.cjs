/**
 * CDP 挂载探针：连到已运行的 shell（--remote-debugging-port=9222），
 * 读取用户**此刻真实看到**的状态，不重启、不打扰窗口。
 *
 * 用法：node desktop/probe-live.cjs
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const out = {}
  try {
    const raw = localStorage.getItem('workbench:state:v1')
    if (raw) {
      const st = JSON.parse(raw)
      out.theme = st.settings && st.settings.theme
      out.zoom = st.settings && st.settings.zoom
      out.ws = (st.workspaces || []).map((w) => ({
        id: w.id, name: w.name,
        win: (w.windows || []).map((x) => ({ p: x.pluginId, v: x.visible, w: x.w, h: x.h, x: x.x, y: x.y, view: (x.config && x.config.view) || '(default)' })),
      }))
    } else out.ws = '(no state)'
  } catch (e) { out.err = String(e.message || e) }
  out.htmlTheme = document.documentElement.dataset.theme
  out.bodyBg = getComputedStyle(document.body).backgroundColor
  out.cards = [...document.querySelectorAll('.plugin-card')].map((c) => {
    const f = c.querySelector('iframe')
    const r = c.getBoundingClientRect()
    return {
      t: ((c.querySelector('.card-head .title') || {}).textContent || '?').trim().slice(0, 16),
      rect: Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height),
      q: f ? ((f.getAttribute('src') || '').split('?')[1] || '(none)') : '(no iframe)',
      txt: (c.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100),
    }
  })
  out.frames = [...document.querySelectorAll('iframe')].map((f) => {
    let o = { q: (f.getAttribute('src') || '').split('?')[1] || '(none)' }
    try {
      const d = f.contentDocument
      if (d && d.body) {
        o.theme = d.documentElement.dataset.theme || '(none)'
        o.bg = getComputedStyle(d.body).backgroundColor
        o.txt = (d.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90)
        o.rect = Math.round(f.getBoundingClientRect().width) + 'x' + Math.round(f.getBoundingClientRect().height)
      } else o.doc = '(null)'
    } catch (e) { o.err = String(e.message || e).slice(0, 60) }
    return o
  })
  return JSON.stringify(out)
})()`

async function main() {
  let targets = null
  for (let i = 0; i < 40 && !targets; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json')
      targets = await res.json()
    } catch (e) { await wait(250) }
  }
  if (!targets) { console.log('CDP not reachable'); process.exit(1) }
  const page = targets.find((t) => t.type === 'page' && !/devtools/.test(t.url)) || targets[0]
  if (!page) { console.log('no page target', JSON.stringify(targets.map(t => t.url))); process.exit(1) }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params) => new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const errs = []
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 200))
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Runtime.enable')
  await send('Log.enable')
  await wait(600)

  const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true })
  let data = {}
  try { data = JSON.parse(r.result.value) } catch (e) { console.log('parse fail', JSON.stringify(r)) }

  console.log('theme=' + data.theme + ' htmlTheme=' + data.htmlTheme + ' bodyBg=' + data.bodyBg)
  if (data.err) console.log('ERR', data.err)
  console.log('--- windows ---')
  if (Array.isArray(data.ws)) for (const w of data.ws) {
    console.log('ws ' + w.name)
    for (const x of w.win) console.log('   ' + x.p + ' v=' + x.v + ' ' + x.w + 'x' + x.h + '@' + x.x + ',' + x.y + ' view=' + x.view)
  } else console.log(String(data.ws))
  console.log('--- cards (' + (data.cards || []).length + ') ---')
  for (const c of data.cards || []) console.log('【' + c.t + '】 ' + c.rect + ' q=' + c.q + ' txt="' + c.txt + '"')
  console.log('--- iframes ---')
  for (const f of data.frames || []) console.log('  q=' + f.q + ' theme=' + (f.theme || f.doc || f.err) + ' ' + (f.rect || '') + ' bg=' + (f.bg || '') + ' txt="' + (f.txt || '') + '"')
  console.log('--- errors (' + errs.length + ') ---')
  errs.slice(0, 30).forEach((e) => console.log('  ' + e))
  ws.close()
  process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
