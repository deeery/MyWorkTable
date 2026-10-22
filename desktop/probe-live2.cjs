/**
 * 深挖时钟 / 天气两个 iframe 内部（连到已运行 shell 的 9222 端口）：
 *  - 完整 src（有没有 ?view= 参数）
 *  - iframe 内是否存在插件自己的 .win 外壳（双层窗口 = 显示异常）
 *  - 内部关键元素的 rect / 是否溢出容器
 *  - 时钟有没有在走、天气有没有数据
 *  - 内部 console 错误
 *
 * 用法：node desktop/probe-live2.cjs
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const out = { frames: [] }
  for (const f of document.querySelectorAll('iframe')) {
    const r = f.getBoundingClientRect()
    const info = {
      src: f.getAttribute('src'),
      q: (f.getAttribute('src') || '').split('?')[1] || '(none)',
      hostRect: Math.round(r.width) + 'x' + Math.round(r.height),
    }
    try {
      const d = f.contentDocument
      const w = f.contentWindow
      if (d && d.body) {
        info.innerHasWin = !!d.querySelector('.win, .win-flat, .window')
        info.innerCls = d.documentElement.className || '(none)'
        info.innerBodyCls = d.body.className || '(none)'
        info.scrollW = d.documentElement.scrollWidth + '/' + d.documentElement.clientWidth
        info.scrollH = d.documentElement.scrollHeight + '/' + d.documentElement.clientHeight
        // 内部最外层元素 rect（是否超出 iframe 视口）
        const root = d.querySelector('.win, .win-flat, .plugin, .wrap, body > *')
        if (root) {
          const rr = root.getBoundingClientRect()
          info.root = root.tagName.toLowerCase() + '.' + [...root.classList].slice(0,3).join('.') + ' ' + Math.round(rr.width) + 'x' + Math.round(rr.height) + '@' + Math.round(rr.x) + ',' + Math.round(rr.y)
        }
        info.text = (d.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200)
        // 天气专属：找温度数字与状态
        const temp = d.body.innerText.match(/(-?\\d+\\s*°)/)
        info.temp = temp ? temp[1] : '(no temp)'
        // 时钟专属：有没有秒在走 —— 记录两次间隔交给外部判断
        info.clockMatch = (d.body.innerText.match(/\\d{1,2}:\\d{2}(:\\d{2})?/) || [])[0] || '(none)'
        // 内部关键容器的样式
        const st = w.getComputedStyle(d.body)
        info.bodyStyle = 'bg=' + st.backgroundColor + ' color=' + st.color + ' overflow=' + st.overflow
      } else info.doc = '(null)'
    } catch (e) { info.err = String(e.message || e).slice(0, 80) }
    out.frames.push(info)
  }
  out.theme = document.documentElement.dataset.theme
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
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
  const errs = []
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300))
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Runtime.enable')
  await wait(400)

  const eval1 = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true })
  let d = {}
  try { d = JSON.parse(eval1.result.value) } catch (e) { console.log('parse fail', JSON.stringify(eval1)) }

  console.log('theme=' + d.theme)
  for (const f of d.frames || []) {
    console.log('--- iframe ---')
    console.log('  src=' + f.src)
    console.log('  q=' + f.q + '  host=' + f.hostRect)
    if (f.doc) { console.log('  doc=' + f.doc); continue }
    if (f.err) { console.log('  ERR=' + f.err); continue }
    console.log('  innerHasWin=' + f.innerHasWin + '  root=' + f.root)
    console.log('  cls=' + f.innerCls + ' / body=' + f.innerBodyCls)
    console.log('  scroll=' + f.scrollW + ' (w)  ' + f.scrollH + ' (h)')
    console.log('  body=' + f.bodyStyle)
    console.log('  temp=' + f.temp + '  clock=' + f.clockMatch)
    console.log('  text="' + f.text + '"')
  }

  // 隔 1.2s 再读一次，看时钟是否在走
  await wait(1200)
  const eval2 = await send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('iframe')].map(f=>{try{return (f.contentDocument.body.innerText.match(/\\\\d{1,2}:\\\\d{2}(:\\\\d{2})?/)||['(none)'])[0]}catch(e){return 'err'}}))`, returnByValue: true })
  console.log('--- 1.2s 后时钟读数（应变化）---')
  console.log('  ' + eval2.result.value)

  console.log('--- exceptions (' + errs.length + ') ---')
  errs.slice(0, 20).forEach((e) => console.log('  ' + e))
  ws.close()
  process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
