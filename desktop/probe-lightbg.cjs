/**
 * 浅色主题验收探针：确保时钟/天气 iframe 是「活着的」（有 document、有脚本、
 * data-theme 已由宿主下发），再读回各自 body 的背景与前景色。
 * 若发现 iframe 停在 about:blank（reload 竞态），会强制重挂 src。
 *
 * 用法：node desktop/probe-lightbg.cjs
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const ENSURE = `(() => {
  const out = []
  for (const f of document.querySelectorAll('iframe')) {
    const m = f.src.match(/\\/plugins\\/(clock|weather)\\//)
    if (!m) continue
    let alive = false
    try { alive = !!(f.contentDocument && f.contentDocument.scripts && f.contentDocument.scripts.length) } catch (e) {}
    if (!alive) {
      const s = f.src; f.removeAttribute('src'); void f.offsetWidth; f.src = s
    }
    out.push({ name: m[1], wasAlive: alive })
  }
  return JSON.stringify(out)
})()`

const READ = `(() => {
  const out = []
  for (const f of document.querySelectorAll('iframe')) {
    const m = f.src.match(/\\/plugins\\/(clock|weather)\\//)
    if (!m) continue
    try {
      const d = f.contentDocument
      if (!d || !d.scripts.length) { out.push({ name: m[1], alive: false }); continue }
      const bs = getComputedStyle(d.body)
      out.push({
        name: m[1],
        alive: true,
        theme: d.documentElement.dataset.theme || '(unset)',
        bg: bs.backgroundColor,
        fg: bs.color,
        hasRule: /#f5f7fa/.test(d.documentElement.innerHTML),
        txt: (d.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 50),
      })
    } catch (e) { out.push({ name: m[1], err: String(e.message || e).slice(0, 60) }) }
  }
  return JSON.stringify(out)
})()`

async function run(expr) {
  let targets = null
  for (let i = 0; i < 40 && !targets; i++) {
    try { targets = await (await fetch('http://127.0.0.1:9222/json')).json() } catch (e) { await wait(250) }
  }
  if (!targets) { console.log('CDP not reachable'); process.exit(1) }
  const page = targets.find((t) => t.type === 'page' && !/devtools/.test(t.url)) || targets[0]
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params) => new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Runtime.enable')
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  ws.close()
  return r.result.value
}

async function main() {
  const ensured = JSON.parse(await run(ENSURE))
  console.log('ensured: ' + ensured.map((e) => e.name + (e.wasAlive ? '(alive)' : '(reloaded)')).join(' '))
  await wait(2000)
  const list = JSON.parse(await run(READ))
  const expect = 'rgb(245, 247, 250)'
  let pass = true
  for (const it of list) {
    if (!it.alive) { console.log('FAIL ' + it.name + ' not alive'); pass = false; continue }
    const ok = it.bg === expect
    if (!ok) pass = false
    console.log(`${ok ? 'PASS' : 'FAIL'} ${it.name} theme=${it.theme} bg=${it.bg} fg=${it.fg} hasRule=${it.hasRule} txt="${it.txt}"`)
  }
  console.log('light expectation: ' + expect)
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
