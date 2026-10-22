/**
 * 深浅主题下时钟/天气 iframe 背景色验收（挂在 9222 的运行中 shell 上）。
 *
 * 判据（grill 锁定的三条）：
 *   深色 body 背景 = rgb(19, 23, 30)   (#13171e，比卡片 #1e2430 更深一档)
 *   浅色 body 背景 = rgb(245, 247, 250) (#f5f7fa)
 *   文字仍随主题切换（深色白字 / 浅色深字），插件内容正常渲染（有文本、有脚本）
 *
 * 做法：切主题 → 整页 reload → 等 iframe 自己导航完 → 读回。若 iframe 卡在
 * about:blank（已知的 React 挂载竞态，reload 偶发），补一次 contentWindow 导航再读。
 *
 * 用法：node desktop/verify-cwbg.cjs
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const READ = `(() => {
  const out = []
  for (const f of document.querySelectorAll('iframe')) {
    const m = (f.getAttribute('src') || '').match(/\\/plugins\\/(clock|weather)\\//)
    if (!m) continue
    let d = null
    try { d = f.contentDocument } catch (e) { out.push({ n: m[1], err: String(e.message || e).slice(0, 50) }); continue }
    if (!d || !d.scripts || !d.scripts.length) { out.push({ n: m[1], alive: false, doc: d ? String(d.URL) : 'null' }); continue }
    const bs = getComputedStyle(d.body)
    out.push({
      n: m[1], alive: true,
      theme: d.documentElement.dataset.theme || '(unset)',
      bg: bs.backgroundColor, fg: bs.color,
      txt: (d.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 46),
    })
  }
  return JSON.stringify(out)
})()`

const NAVIGATE_STUCK = `(() => {
  const done = []
  for (const f of document.querySelectorAll('iframe')) {
    const m = (f.getAttribute('src') || '').match(/\\/plugins\\/(clock|weather)\\//)
    if (!m) continue
    let alive = false
    try { const d = f.contentDocument; alive = !!(d && d.scripts && d.scripts.length) } catch (e) {}
    if (!alive) { try { f.contentWindow.location.href = f.getAttribute('src'); done.push(m[1]) } catch (e) {} }
  }
  return JSON.stringify(done)
})()`

async function connect() {
  let targets = null
  for (let i = 0; i < 60 && !targets; i++) {
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
  await send('Runtime.enable')
  return { send, close: () => ws.close(), eval: async (expr) => {
    const v = (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value
    if (typeof v !== 'string') return v
    try { return JSON.parse(v) } catch (e) { return v }
  } }
}

async function runTheme(mode) {
  const c = await connect()
  const expectBg = mode === 'dark' ? 'rgb(19, 23, 30)' : 'rgb(245, 247, 250)'
  const expectFg = mode === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(35, 38, 58)'

  // 1) 写主题
  await c.eval(`(() => {
    const raw = localStorage.getItem('workbench:state:v1')
    if (raw) { const st = JSON.parse(raw); st.settings = st.settings || {}; st.settings.theme = '${mode}'
      localStorage.setItem('workbench:state:v1', JSON.stringify(st)) }
    return 'ok'
  })()`)

  // 2) 整页 reload，等宿主把新主题下发给插件
  await c.send('Page.reload')
  await wait(3000)

  // 3) 卡在 about:blank 的话补一次导航（已知竞态）
  const stuck = await c.eval(NAVIGATE_STUCK)
  if (stuck && stuck.length) { console.log('  (' + mode + ') re-navigated: ' + stuck.join(',')); await wait(1600) }

  const list = await c.eval(READ)
  c.close()

  let pass = true
  const lines = []
  for (const it of list || []) {
    if (!it.alive) { pass = false; lines.push('  FAIL ' + it.n + ' not alive (doc=' + (it.doc || it.err) + ')'); continue }
    const bgOk = it.bg === expectBg
    const fgOk = it.fg === expectFg
    const themeOk = it.theme === mode
    const hasText = it.txt && it.txt.length > 3
    const ok = bgOk && fgOk && themeOk && hasText
    if (!ok) pass = false
    lines.push(`  ${ok ? 'PASS' : 'FAIL'} ${it.n} theme=${it.theme} bg=${it.bg} fg=${it.fg} txt="${it.txt}"`)
  }
  console.log(`[${mode}] expect bg=${expectBg} fg=${expectFg}`)
  lines.forEach((l) => console.log(l))
  if (!list || !list.length) { console.log('  FAIL no clock/weather iframe found'); pass = false }
  return pass
}

async function main() {
  const darkOk = await runTheme('dark')
  const lightOk = await runTheme('light')
  console.log(darkOk && lightOk ? 'ALL PASS' : 'FAILED')
  process.exit(darkOk && lightOk ? 0 : 1)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
