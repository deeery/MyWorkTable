// 逐元素扫时钟/天气 iframe 里所有「有可见内容」的元素，算每个对真实底色的对比度，
// 标出 < 3:1 的（用户说的「和背景颜色重叠」= 某个元素颜色贴着背景色）。
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
    function rgb(s){ var m=(s||'').match(/[\\d.]+/g); if(!m) return null; return m.slice(0,3).map(Number) }
    function lum(c){ var a=c.map(function(v){v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2] }
    function con(f,b){ var L1=lum(f),L2=lum(b); var hi=Math.max(L1,L2),lo=Math.min(L1,L2); return (hi+0.05)/(lo+0.05) }
    function over(fg,bg,a){ return [0,1,2].map(function(i){ return Math.round(a*fg[i]+(1-a)*bg[i]) }) }
    // 找到不透明的真实底色：沿祖先向上直到遇到非透明背景
    function effBg(el){
      var e=el
      while(e){
        var cs=getComputedStyle(e); var bg=cs.backgroundColor; var c=rgb(bg)
        var alpha = (bg.match(/rgba?\\([^)]*,\\s*([\\d.]+)\\)/)||[])[1]
        if(c && (alpha===undefined || parseFloat(alpha)>0.5)) return c
        e=e.parentElement
      }
      return [14,17,23] // 兜底 = --bg 深色
    }
    var results=[]
    var ifrs=[...document.querySelectorAll('.plugin-card iframe')]
    for(var k=0;k<ifrs.length;k++){
      var card=ifrs[k].closest('.plugin-card')
      var title=((card.querySelector('.card-head .title')||{}).textContent)||'?'
      var d=ifrs[k].contentWindow.document
      var all=[...d.querySelectorAll('*')]
      var lows=[]
      var count=0
      for(var i=0;i<all.length;i++){
        var el=all[i]
        var cs=getComputedStyle(el)
        if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0) continue
        var r=el.getBoundingClientRect(); if(r.width<1||r.height<1) continue
        // 有直接文字 或 是 emoji 装饰（有文本节点/字体图标）
        var directText=''; for(var n=0;n<el.childNodes.length;n++){ if(el.childNodes[n].nodeType===3) directText+=el.childNodes[n].textContent }
        directText=directText.trim()
        var isEmoji = !directText && (el.id==='icon' || el.classList.contains('icon'))
        if(!directText && !isEmoji) continue
        count++
        var color=cs.color
        var fg=rgb(color)
        if(!fg) continue
        var alpha=(color.match(/rgba?\\([^)]*,\\s*([\\d.]+)\\)/)||[])[1]
        var bg=effBg(el)
        if(alpha!==undefined && parseFloat(alpha)<1) fg=over(fg,bg,parseFloat(alpha))
        var ratio=Math.round(con(fg,bg)*100)/100
        var entry={ el:(el.id?'#'+el.id:'')+'.'+(el.className||el.tagName), txt:directText.slice(0,14), color:color, bg:'rgb('+bg.join(',')+')', ratio:ratio }
        if(ratio<3) lows.push(entry)
      }
      results.push({ title:title, checked:count, lowCount:lows.length, lows:lows.slice(0,12) })
    }
    return JSON.stringify(results, null, 1)
  })()`
  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true })
  if (r.exceptionDetails) console.log('EXC ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text))
  else console.log(r.result.value)
  ws.close(); process.exit(0)
}
main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
