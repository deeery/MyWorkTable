/**
 * 拆解 iframe 存活竞态：分「整页 reload」「只切主题」「切主题后 + 实时采样」三段，
 * 各段记录时钟/天气 iframe 的 src / 文档 URL / 脚本数 / 主题 / 背景。
 * 目的：分清是 Vite 模块预载卡死、React key 重挂竞态，还是我探针的 reload 时序问题。
 *
 * 用法：node desktop/probe-framesplit.cjs
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const SNAP = `(() => {
  const out = []
  for (const f of document.querySelectorAll('iframe')) {
    const m = (f.getAttribute('src') || '').match(/\\/plugins\\/(clock|weather)\\//)
    if (!m) continue
    let docUrl = 'ERR', scripts = -1, theme = '-', bg = '-', txt = ''
    try {
      const d = f.contentDocument
      if (d) { docUrl = d.URL; scripts = d.scripts.length; theme = d.documentElement.dataset.theme || '(unset)'
        bg = getComputedStyle(d.body).backgroundColor; txt = (d.body.innerText||'').replace(/\\s+/g,' ').trim().slice(0,40) }
      else docUrl = 'NULL'
    } catch (e) { docUrl = 'ERR ' + String(e.message || e).slice(0, 40) }
    out.push({ n: m[1], src: (f.getAttribute('src') || '').split('?').pop(), docUrl, scripts, theme, bg, txt })
  }
  return JSON.stringify(out)
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
  return { send, close: () => ws.close() }
}

async function show(send, label) {
  const r = await send('Runtime.evaluate', { expression: SNAP, returnByValue: true })
  console.log('=== ' + label + ' ===')
  for (const it of JSON.parse(r.result.value)) {
    console.log(` ${it.n}: src=${it.src} doc=${it.docUrl} scripts=${it.scripts} theme=${it.theme} bg=${it.bg} "${it.txt}"`)
  }
}

async function main() {
  let c = await connect()
  await show(c.send, 'start (state as-is)')

  // 段 1：只切主题（不整页 reload）
  console.log('\n--- segment 1: switch theme dark<->light without full reload ---')
  let r = await c.send('Runtime.evaluate', { expression: `document.documentElement.dataset.theme || '(unset)'`, returnByValue: true })
  const cur = r.result.value
  const next = cur === 'dark' ? 'light' : 'dark'
  console.log('theme ' + cur + ' -> ' + next)
  await c.send('Runtime.evaluate', {
    expression: `(() => {
      const raw = localStorage.getItem('workbench:state:v1')
      if (raw) { const st = JSON.parse(raw); st.settings = st.settings || {}; st.settings.theme = '${next}'
        localStorage.setItem('workbench:state:v1', JSON.stringify(st)) }
      document.documentElement.dataset.theme = '${next}'
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'workbench:theme', payload: { theme: '${next}' } } }))
      return 'ok'
    })()`,
    returnByValue: true,
  })
  await wait(700)
  await show(c.send, 'after in-page theme switch (no reload)')
  c.close()

  // 段 2：整页 reload（保留刚才写入的主题）
  console.log('\n--- segment 2: full page reload, sample at 1s / 3s / 6s / 10s ---')
  c = await connect()
  await c.send('Page.reload')
  for (const t of [1000, 2000, 3000, 4000]) {
    await wait(t)
    await show(c.send, 't+' + t + 'ms cumulative')
  }
  c.close()
  process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
