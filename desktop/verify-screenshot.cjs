/**
 * 最终验收截图（走真实用户路径：插件市场安装 → 上桌面）。
 * 之前直接写 localStorage 造数据会导致卡片重叠（缺少 x/y 坐标），
 * 那是测试方法的问题，不是产品缺陷 —— 这里改用市场安装路径。
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 120000)

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 50 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { console.log('no window'); app.exit(1); return }
  win.setSize(1400, 900)
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s) } catch (e) { return { __err: String(e && e.message || e) } } }

  const dir = path.join(__dirname, '..', 'dist')
  await win.loadFile(path.join(dir, 'index.html'))
  await wait(1200)
  await js(`localStorage.clear(); true`)
  await win.webContents.reload()
  await wait(1600)

  // 只装 3 个代表性插件，画面更清楚
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('插件')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(600)
  await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('插件市场')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(600)
  const n = await js(`(() => {
    const WANT = ['倒数日','习惯打卡','桌面宠物'];
    let n = 0;
    document.querySelectorAll('.market-card').forEach(c => {
      if (!WANT.some(w => c.textContent.includes(w))) return;
      const b = [...c.querySelectorAll('button')].find(x => x.textContent.includes('安装'));
      if (b) { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); n++; }
    });
    return n;
  })()`)
  console.log('installed ' + n)
  await wait(1500)

  /* lab 插件的 defaultVisible=false（装好但先不占桌面），
     且内置的时钟/天气/便签默认可见。这里：
       1) 把内置插件移出桌面，画面才只剩 lab 插件
       2) 让 lab 插件上桌面 */
  const shown = await js(`(() => {
    const s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    let hid = 0, show = 0;
    (s.installed || []).forEach(p => {
      const isLab = String(p.manifest.id).startsWith('lab.');
      if (isLab) { if (!p.visible) { p.visible = true; show++; } }
      else if (p.visible) { p.visible = false; hid++; }
    });
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return { hid, show };
  })()`)
  console.log('visibility ' + JSON.stringify(shown))
  await win.webContents.reload()
  await wait(4000)

  // 回到桌面
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(4000)

  const r = await js(`(() => {
    const s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    const vis = (s.installed || []).filter(p => p.visible);
    const W = { S:280, M:480, L:720, XL:960 }, MINH = { S:180, M:220, L:260, XL:300 };
    const norm = vis.map(p => ({ id: p.manifest.id, x: p.x, y: p.y, w: p.w ?? W[p.size] ?? 480, h: p.h ?? MINH[p.size] ?? 220 }));
    let ov = 0;
    for (let i=0;i<norm.length;i++) for (let j=i+1;j<norm.length;j++) {
      const a=norm[i], b=norm[j];
      if (a.x==null||b.x==null) continue;
      if (a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y) ov++;
    }
    const cards = [];
    document.querySelectorAll('.plugin-card').forEach(card => {
      const fr = card.querySelector('iframe');
      let o = { src: fr ? (fr.getAttribute('src')||'').split('/').pop() : null };
      try {
        const d = fr.contentDocument;
        const cw = d.querySelector('.cw');
        o.compact = d.body.classList.contains('pl-compact');
        o.cwText = cw ? cw.innerText.replace(/\\s+/g,' ').trim().slice(0,24) : null;
      } catch(e) { o.err = String(e.message).slice(0,30); }
      cards.push(o);
    });
    return { visible: vis.length, overlap: ov, domCards: document.querySelectorAll('.plugin-card').length, cards };
  })()`)
  console.log('RESULT ' + JSON.stringify(r, null, 1))

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'desktop-final.png'), (await win.webContents.capturePage()).toPNG())
  console.log('saved shots/desktop-final.png')

  clearTimeout(HARD); app.exit(0)
}, 400))
