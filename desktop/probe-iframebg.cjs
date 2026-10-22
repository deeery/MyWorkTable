/**
 * 只刷新时钟/天气两张 iframe，读回它们 body 的实际背景色。
 * 验证「深色背景 #13171e / 浅色 #f5f7fa」是否生效（public/ 是 Vite 静态目录，改完即热更新，
 * 但已加载的 iframe 不会自动重取，必须 reload 才能看到新样式）。
 *
 * 用法：node desktop/probe-iframebg.cjs [dark|light]
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const mode = (process.argv[2] || 'dark').toLowerCase()

const REFRESH = `(() => {
  const out = { theme: document.documentElement.dataset.theme, frames: [] }
  for (const f of document.querySelectorAll('iframe')) {
    const name = /clock/.test(f.src) ? 'clock' : /weather/.test(f.src) ? 'weather' : null
    if (!name) continue
    f.contentWindow.location.reload()
    out.frames.push(name)
  }
  return JSON.stringify(out)
})()`

const READ = `(() => {
  const out = []
  for (const f of document.querySelectorAll('iframe')) {
    const name = /clock/.test(f.src) ? 'clock' : /weather/.test(f.src) ? 'weather' : null
    if (!name) continue
    try {
      const d = f.contentDocument
      out.push({
        name,
        theme: d.documentElement.dataset.theme || '(none)',
        bg: getComputedStyle(d.body).backgroundColor,
        fg: getComputedStyle(d.body).color,
      })
    } catch (e) { out.push({ name, err: String(e.message || e).slice(0, 60) }) }
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

  // 必要时先切主题
  const cur = JSON.parse((await send('Runtime.evaluate', { expression: REFRESH, returnByValue: true })).result.value)
  if (cur.theme !== mode) {
    console.log('theme was ' + cur.theme + ' -> switching to ' + mode)
    await send('Runtime.evaluate', {
      expression: `(() => {
        const raw = localStorage.getItem('workbench:state:v1')
        if (raw) { const st = JSON.parse(raw); st.settings = st.settings || {}; st.settings.theme = '${mode}'
          localStorage.setItem('workbench:state:v1', JSON.stringify(st)) }
        return 'ok'
      })()`,
      returnByValue: true,
    })
    await send('Page.reload')
    await wait(2200)
  } else {
    console.log('theme already ' + mode)
    await wait(300)
  }

  // 重新触发刷新（切主题后 iframe 已经是新的了）
  await send('Runtime.evaluate', { expression: REFRESH, returnByValue: true })
  await wait(1800)

  const r = await send('Runtime.evaluate', { expression: READ, returnByValue: true })
  const list = JSON.parse(r.result.value)
  const expect = mode === 'dark' ? 'rgb(19, 23, 30)' : 'rgb(245, 247, 250)'
  let pass = true
  for (const it of list) {
    const ok = it.bg === expect
    if (!ok) pass = false
    console.log(`${ok ? 'PASS' : 'FAIL'} ${it.name} theme=${it.theme} bg=${it.bg} fg=${it.fg || ''}`)
  }
  console.log(mode + ' expectation: ' + expect)
  ws.close()
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
