/**
 * 分辨 about:blank 的成因：
 *   (a) iframe 节点是否在文档里（attachShadow / Portal 藏起来？）
 *   (b) 是否 sandbox 属性限制
 *   (c) 直接 contentWindow.location.href = src 强制导航是否能成
 *
 * 用法：node desktop/probe-forcedoc.cjs
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const INSPECT = `(() => {
  const f = document.querySelector('iframe')
  const out = {
    inDoc: document.contains(f),
    parentTag: f.parentElement && (f.parentElement.className || f.parentElement.tagName),
    rect: JSON.stringify(f.getBoundingClientRect()),
    sandbox: f.getAttribute('sandbox'),
    srcdoc: f.getAttribute('srcdoc'),
    style: (f.getAttribute('style') || '').slice(0, 80),
    offsetParent: f.offsetParent ? (f.offsetParent.className || f.offsetParent.tagName) : null,
    isConnected: f.isConnected,
    computedDisplay: getComputedStyle(f).display,
    computedVis: getComputedStyle(f).visibility,
  }
  return JSON.stringify(out, null, 1)
})()`

const FORCE = `(() => {
  const f = document.querySelector('iframe')
  try {
    f.contentWindow.location.href = 'http://localhost:5173/plugins/clock/index.html'
    return 'navigating'
  } catch (e) { return 'ERR ' + String(e.message || e) }
})()`

const READ = `(() => {
  const f = document.querySelector('iframe')
  let r = { doc: 'ERR' }
  try {
    const d = f.contentDocument
    r = { doc: d && d.URL, scripts: d && d.scripts.length, theme: d && d.documentElement.dataset.theme, bg: d && getComputedStyle(d.body).backgroundColor, txt: d && (d.body.innerText || '').replace(/\\s+/g,' ').trim().slice(0,40) }
  } catch (e) { r.doc = 'ERR ' + String(e.message || e).slice(0, 60) }
  return JSON.stringify(r)
})()`

async function connect() {
  let targets = null
  for (let i = 0; i < 40 && !targets; i++) {
    try { targets = await (await fetch('http://127.0.0.1:9222/json')).json() } catch (e) { await wait(250) }
  }
  if (!targets) { console.log('CDP not reachable'); process.exit(1) }
  const page = targets.find((t) => t.type === 'page' && !/devtools/.test(t.url)) || targets[0]
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id
    pending.set(mid, { res, rej, method })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      if (m.error) { p.rej(new Error(p.method + ': ' + m.error.message)) } else { p.res(m.result) }
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  return { send, close: () => ws.close() }
}

async function main() {
  const c = await connect()
  await c.send('Runtime.enable')
  const ins = (await c.send('Runtime.evaluate', { expression: INSPECT, returnByValue: true })).result.value
  console.log('--- inspect first iframe ---')
  console.log(ins)
  const fr = (await c.send('Runtime.evaluate', { expression: FORCE, returnByValue: true })).result.value
  console.log('force: ' + fr)
  await wait(3000)
  const rd = (await c.send('Runtime.evaluate', { expression: READ, returnByValue: true })).result.value
  console.log('read: ' + rd)
  c.close()
  process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
