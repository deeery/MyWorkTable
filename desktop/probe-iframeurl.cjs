/**
 * 读 iframe 的实际文档 URL —— 判断它是否还在指向我刚改的 public/plugins/*（dev 服务）。
 *
 * 用法：node desktop/probe-iframeurl.cjs
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const out = []
  for (const f of document.querySelectorAll('iframe')) {
    out.push({
      src: f.src,
      href: (() => { try { return f.contentWindow.location.href } catch (e) { return 'ERR ' + String(e.message||e).slice(0,60) } })(),
      loaded: (() => { try { return f.contentDocument && f.contentDocument.readyState + ' scripts=' + f.contentDocument.scripts.length } catch (e) { return 'ERR' } })(),
    })
  }
  return JSON.stringify(out, null, 1)
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
  await wait(500)
  const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true })
  console.log(r.result.value)
  ws.close()
  process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
