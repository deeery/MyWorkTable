// 连上运行中的 shell，找到天气 iframe，手动触发 load() 并读回结果 —— 判断
// 「暂无数据」是瞬时的还是持续性 bug（代理现在是通的，直接在页面里再拉一次看）。
process.env.WORKBENCH_VERIFY = '1'
const HARD = 90000
setTimeout(() => { console.log('FAIL hard timeout'); process.exit(1) }, HARD)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url))
  if (!page) throw new Error('no page target')
  console.log('page=' + page.url.slice(0, 70))
  console.log('targets=' + JSON.stringify(list.map((t) => t.type + ' ' + t.url.slice(0, 60)), null, 1))

  // 天气 iframe 与主页面同源（都是 localhost:5173），没有独立 target ——
  // 直接从主页面用 contentWindow 伸进去调 load() 并读回。
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0; const pending = new Map()
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const cb = pending.get(m.id); pending.delete(m.id); cb(m.result) } })
  const send = (m, p) => new Promise((res, rej) => { const mid = ++id; const t = setTimeout(() => { pending.delete(mid); rej(new Error('timeout ' + m)) }, 15000); pending.set(mid, (v) => { clearTimeout(t); res(v) }); ws.send(JSON.stringify({ id: mid, method: m, params: p })) })
  await send('Runtime.enable')

  const read = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true })
  const dump = (label, expr) => read(expr).then((r) => console.log(label + '=' + (r.exceptionDetails ? 'EXC ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text) : r.result && r.result.value)))

  await dump('locate', `JSON.stringify([...document.querySelectorAll('iframe')].map(f => (f.src||'').split('/').slice(-2).join('/')))`)

  // 找到天气 iframe，先看它当前状态，再手动 load()，等 2.5s 再读
  await dump('before', `(function(){
    var f = [...document.querySelectorAll('iframe')].find(f => /weather\\/index\\.html/.test(f.src||''))
    if (!f) return 'NO iframe'
    try { var w = f.contentWindow; return JSON.stringify({ SK: !!w.SK, code: w.CITY_CODE, temp: document.getElementById('temp') && null }) }
    catch(e){ return 'ERR '+e.message }
  })()`)

  await read(`(function(){
    var f = [...document.querySelectorAll('iframe')].find(f => /weather\\/index\\.html/.test(f.src||''))
    if (f && f.contentWindow && f.contentWindow.load) f.contentWindow.load()
    return 'triggered'
  })()`)

  await wait(2500)
  await dump('after', `(function(){
    var f = [...document.querySelectorAll('iframe')].find(f => /weather\\/index\\.html/.test(f.src||''))
    if (!f) return 'NO iframe'
    try { var w = f.contentWindow; var d = w.document
      return JSON.stringify({ SK: !!w.SK, temp: w.SK&&w.SK.temp, wea: w.SK&&w.SK.weather, upd: w.SK&&w.SK.time,
        cond: d.getElementById('cond') && d.getElementById('cond').textContent,
        tempTxt: d.getElementById('temp') && d.getElementById('temp').textContent,
        sub: d.getElementById('sub') && d.getElementById('sub').textContent })
    } catch(e){ return 'ERR '+e.message }
  })()`)
  ws.close()
  process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
