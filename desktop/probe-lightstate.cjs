/**
 * 看一眼浅色主题下 iframe 的真实状态：宿主 data-theme、init 是否已下发、
 * 以及三处（:root / body / html）的实际背景色。
 *
 * 用法：node desktop/probe-lightstate.cjs
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const out = { hostTheme: document.documentElement.dataset.theme, frames: [] }
  for (const f of document.querySelectorAll('iframe')) {
    const name = /clock/.test(f.src) ? 'clock' : /weather/.test(f.src) ? 'weather' : null
    if (!name) continue
    try {
      const d = f.contentDocument
      if (!d) { out.frames.push({ name, doc: 'null' }); continue }
      const cs = getComputedStyle(d.documentElement)
      const bs = getComputedStyle(d.body)
      out.frames.push({
        name,
        htmlDataTheme: d.documentElement.dataset.theme || '(unset)',
        htmlBg: cs.backgroundColor,
        bodyBg: bs.backgroundColor,
        bodyFg: bs.color,
        rootVarBg: cs.getPropertyValue('--bg').trim(),
        headHasNewRule: /#f5f7fa/.test(d.documentElement.innerHTML),
        scripts: d.scripts.length,
        ready: !!d.querySelector('.time, .temp, .wrap, #time, #temp'),
      })
    } catch (e) { out.frames.push({ name, err: String(e.message || e).slice(0, 60) }) }
  }
  return JSON.stringify(out)
})()`

async function main() {
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

  await wait(2500)
  const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true })
  const d = JSON.parse(r.result.value)
  console.log('hostTheme=' + d.hostTheme)
  for (const f of d.frames) console.log(JSON.stringify(f))
  ws.close()
  process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
