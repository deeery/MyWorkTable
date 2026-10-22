/**
 * 直接向 iframe 导航（targetCreated），绕开 React 挂载时机，观察子 frame 是否真加载，
 * 并对比「React 自己挂载的 src 重设」是否能触发导航。
 *
 * 用法：node desktop/probe-forcenav.cjs
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

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
  const events = []
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
    if (m.method) events.push(m)
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  return { send, events, close: () => ws.close() }
}

async function state(c) {
  const r = await c.send('Runtime.evaluate', {
    expression: `JSON.stringify([...document.querySelectorAll('iframe')].map(f => ({ src: (f.getAttribute('src')||'').split('?')[0], doc: (()=>{try{return f.contentDocument && f.contentDocument.URL}catch(e){return 'ERR'}})(), theme: (()=>{try{return f.contentDocument && f.contentDocument.documentElement.dataset.theme}catch(e){return 'ERR'}})(), bg: (()=>{try{return f.contentDocument && getComputedStyle(f.contentDocument.body).backgroundColor}catch(e){return 'ERR'}})() })))`,
    returnByValue: true,
  })
  return JSON.parse(r.result.value)
}

async function main() {
  let c = await connect()
  await c.send('Page.enable')
  await c.send('Runtime.enable')
  await wait(300)
  console.log('--- before ---')
  console.log(JSON.stringify(await state(c), null, 1))

  // 用 Page.navigate 让主 frame 里的第一个 clock iframe 重新导航（指定 frameId 不行——
  // navigate 只能对 frameId 生效，这里改成直接操作 src 属性以触发浏览器原生导航）
  await c.send('Runtime.evaluate', {
    expression: `(() => {
      const f = document.querySelector('iframe')
      const s = f.getAttribute('src')
      f.src = s
      return 'reset src to ' + s
    })()`,
    returnByValue: true,
  })
  await wait(2500)
  console.log('--- after src reset ---')
  console.log(JSON.stringify(await state(c), null, 1))
  const navs = c.events.filter((m) => /frameNavigated|frameAttached|frameStoppedLoading|frameStartedLoading/.test(m.method))
  console.log('--- frame events ---')
  for (const m of navs) console.log(' ' + m.method + ' ' + ((m.params.frame && m.params.frame.url) || '').slice(0, 120))
  const reqs = c.events.filter((m) => m.method === 'Network.requestWillBeSent' && /plugins\/(clock|weather)/.test(m.params.request.url))
  console.log('--- plugin requests ---')
  for (const m of reqs) console.log(' req ' + m.params.request.url.slice(0, 120))
  const fails = c.events.filter((m) => m.method === 'Network.loadingFailed')
  console.log('--- failed requests (' + fails.length + ') ---')
  for (const m of fails) console.log(' FAIL ' + m.params.errorText + ' ' + (m.params.blockedReason || ''))
  c.close()
  process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
