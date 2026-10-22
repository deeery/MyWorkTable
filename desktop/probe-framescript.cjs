/**
 * 看 iframe 内部真实 load 轨迹：Frame.* 事件、网络请求成败、以及页面载入后
 * React 是否把 theme 写进了 documentElement。用来判断「about:blank 是常态还是死锁」。
 *
 * 用法：node desktop/probe-framescript.cjs
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
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id
    pending.set(mid, { res, rej, method })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const events = []
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      if (m.error) { p.rej(new Error(p.method + ': ' + m.error.message)) } else p.res(m.result)
    }
    if (m.method) events.push(m)
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  return { send, events, close: () => ws.close() }
}

async function main() {
  let c = await connect()
  await c.send('Page.enable')
  await c.send('Network.enable')
  await c.send('Runtime.enable')
  await wait(300)

  // 触发一次整页 reload，采集 iframe 内部的 frame/network/runtime 轨迹
  await c.send('Page.reload')
  await wait(6000)

  const keep = c.events.filter((m) =>
    /frameNavigated|frameAttached|frameDetached|frameStartedLoading|frameStoppedLoading|frameClearedScheduledNavigation|frameRequestedNavigation|frameRedirected/.test(m.method)
    || m.method === 'Network.requestWillBeSent'
    || m.method === 'Network.loadingFailed'
    || m.method === 'Network.responseReceived'
    || m.method === 'Runtime.executionContextCreated'
    || m.method === 'Runtime.consoleAPICalled'
    || m.method === 'Runtime.exceptionThrown')

  console.log('--- frame/network/runtime events (' + keep.length + ') ---')
  for (const m of keep) {
    if (m.method === 'Network.requestWillBeSent') {
      console.log(' req ' + m.params.request.url.slice(0, 110))
    } else if (m.method === 'Network.responseReceived') {
      console.log(' res ' + m.params.response.status + ' ' + m.params.response.url.slice(0, 110))
    } else if (m.method === 'Network.loadingFailed') {
      console.log(' FAIL ' + m.params.errorText + ' ' + (m.params.blockedReason || '') + ' reqId=' + m.params.requestId)
    } else if (m.method === 'Runtime.executionContextCreated') {
      const aux = JSON.stringify(m.params.context.auxData || {})
      console.log(' ctx ' + m.params.context.id + ' ' + aux.slice(0, 140))
    } else if (m.method === 'Runtime.consoleAPICalled') {
      console.log(' console[' + m.params.type + '] ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 140))
    } else if (m.method === 'Runtime.exceptionThrown') {
      console.log(' EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 160))
    } else {
      const f = m.params.frame || {}
      console.log(' ' + m.method.replace('Page.', '') + ' ' + (f.url || '').slice(0, 110) + (m.params.frame ? ' id=' + String(f.id).slice(0, 8) : ''))
    }
  }

  // 主文档当前状态
  const r = await c.send('Runtime.evaluate', {
    expression: `JSON.stringify([...document.querySelectorAll('iframe')].map(f => ({ src: (f.getAttribute('src')||'').split('?')[0], doc: (()=>{try{return f.contentDocument && f.contentDocument.URL}catch(e){return 'ERR'}})(), theme: (()=>{try{return f.contentDocument && f.contentDocument.documentElement.dataset.theme}catch(e){return 'ERR'}})() })))`,
    returnByValue: true,
  })
  console.log('--- final iframe state ---')
  console.log(r.result.value)
  c.close()
  process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
