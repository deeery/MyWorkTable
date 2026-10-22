// 量卡片「是否和背景重叠」的结构真相：卡片边框/阴影是否在、卡片底 vs 真实桌面底、
// 卡头底 vs 卡身底 是否同色（同色 = 头和内容糊成一片）。
process.env.WORKBENCH_VERIFY = '1'
setTimeout(() => { console.log('FAIL hard timeout'); process.exit(1) }, 90000)

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0; const pending = new Map()
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const cb = pending.get(m.id); pending.delete(m.id); cb(m.result) } })
  const send = (m, p) => new Promise((res, rej) => { const mid = ++id; const t = setTimeout(() => { pending.delete(mid); rej(new Error('timeout ' + m)) }, 15000); pending.set(mid, (v) => { clearTimeout(t); res(v) }); ws.send(JSON.stringify({ id: mid, method: m, params: p })) })
  await send('Runtime.enable')

  const EXPR = `(function(){
    function rgb(s){ var m=(s||'').match(/[\\d.]+/g); return m?m.slice(0,3).map(Number):null }
    function lum(c){ var a=c.map(function(v){v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2] }
    function con(b,f){ if(!b||!f) return null; var L1=lum(b),L2=lum(f); var hi=Math.max(L1,L2),lo=Math.min(L1,L2); return Math.round(((hi+0.05)/(lo+0.05))*100)/100 }
    // 真实桌面底：先看 .wb-backdrop，再看 body/html
    var backdrop = document.querySelector('.wb-backdrop')
    var bdBg = backdrop ? getComputedStyle(backdrop).backgroundColor : 'no-backdrop'
    var bodyBg = getComputedStyle(document.body).backgroundColor
    var realBg = (backdrop && rgb(bdBg) && !(bdBg.includes('rgba') && bdBg.endsWith(', 0)'))) ? rgb(bdBg) : (rgb(bodyBg)||[14,17,23])

    var cards=[...document.querySelectorAll('.plugin-card')]
    var out=cards.map(function(card){
      var ccs=getComputedStyle(card)
      var cardBg=rgb(ccs.backgroundColor)
      var head=card.querySelector('.card-head')
      var headBg=head?rgb(getComputedStyle(head).backgroundColor):null
      var border=ccs.borderTopWidth+' '+ccs.borderTopStyle+' '+ccs.borderTopColor
      var shadow=ccs.boxShadow
      return {
        title:((card.querySelector('.card-head .title')||{}).textContent)||'?',
        cardBg: ccs.backgroundColor,
        headBg: head?getComputedStyle(head).backgroundColor:'n/a',
        headVsBody: (cardBg&&headBg)?con(cardBg,headBg):null,
        cardVsBackdrop: con(realBg, cardBg),
        border: border,
        hasShadow: shadow!=='none',
        shadow: shadow.slice(0,70),
        borderRadius: ccs.borderRadius,
        outline: ccs.outlineWidth+' '+ccs.outlineColor
      }
    })
    return JSON.stringify({ backdropBg: bdBg, bodyBg: bodyBg, realBg:'rgb('+realBg.join(',')+')', cards: out }, null, 1)
  })()`
  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true })
  if (r.exceptionDetails) console.log('EXC ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text))
  else console.log(r.result.value)
  ws.close(); process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
