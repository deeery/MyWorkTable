/* ============================================================
   便签拖动标题：验收截图
   ------------------------------------------------------------
   拍四张：
     notes-1-tabs.png      完整内容下的标签栏（可拖动的起点）
     notes-2-dragging.png  拖动中：卡片内插入位竖条 / 拖出卡片时的虚线框
     notes-3-tearout.png   松手后：拆成了两张卡片，各自只显示自己那几张
     notes-4-merge.png     合并回一张窗口（标签顺序保持拖放结果）

   ⚠ 拖动只能在「完整内容」形态下拍：精简（host）模式有
     `body.pl-compact .win { display:none !important }`，标签栏根本不可见，
     getBoundingClientRect 全是 0。
   ============================================================ */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 300000)
const TITLE = '快速便签'
const SHOTS = path.join(__dirname, '..', 'shots')

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  win.setSize(1400, 900)
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s) } catch (e) { return { __err: String((e && e.message) || e) } } }

  await win.loadURL('about:blank')
  await wait(600)
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(2000)

  // 装插件
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('插件')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('插件市场')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`(() => {
    document.querySelectorAll('.market-card').forEach(c => {
      if (!c.textContent.includes(${JSON.stringify(TITLE)})) return;
      const b = [...c.querySelectorAll('button')].find(x => x.textContent.includes('安装'));
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return true;
  })()`)
  await wait(1500)

  const goDesktop = async () => {
    await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
    await wait(3000)
  }
  const openFromDock = async () => {
    await js(`document.querySelector('.dock-launch').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
    await wait(900)
    await js(`(() => {
      var it = [...document.querySelectorAll('.dock-item')].find(function (x) {
        return ((x.querySelector('.dock-name') || {}).textContent || '').indexOf(${JSON.stringify(TITLE)}) === 0;
      });
      if (it) it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return !!it;
    })()`)
    await wait(2800)
  }
  /** 读某张卡片 iframe 当前的视图（'embed' / 'host'） */
  const viewOf = (winId) => js(`(() => {
    var c = document.querySelector('.plugin-card[data-win-id="' + ${JSON.stringify(winId)} + '"]');
    var f = c && c.querySelector('iframe');
    if (!f) return { err: 'no-iframe' };
    var u = f.getAttribute('src') || '';
    return { url: u, view: u.indexOf('view=embed') >= 0 ? 'embed' : 'host' };
  })()`)

  /**
   * 把一张卡片切到「完整内容」形态，**并确认真的切过去了**。
   *
   * 为什么要确认：reload 之后所有 iframe 都回到 host 形态，没有标签栏；
   * 切形态靠「点齿轮 → 点面板里的『🪟 完整内容』」，而齿轮是 toggle ——
   * 上一张卡片的面板若还开着（面板 portal 到 body，多张可以并存），
   * 点到的可能是别人那个面板。所以先 Esc 关干净，切完再核对 iframe 的
   * src 是不是 view=embed，不是就重来。
   */
  const setFull = async (winId) => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const v0 = await viewOf(winId)
      if (v0 && v0.view === 'embed') return { id: winId, view: 'embed', attempts: attempt - 1 }
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await wait(320)
      const clicked = await js(`(() => {
        var c = document.querySelector('.plugin-card[data-win-id="' + ${JSON.stringify(winId)} + '"]');
        var g = c && c.querySelector('.gear');
        if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return !!g;
      })()`)
      if (!clicked) return { id: winId, err: 'no-gear' }
      await wait(900)
      const hit = await js(`(() => {
        var ps = [...document.querySelectorAll('.settings-panel')];
        // 用最后出现的那个（刚点的），它就是当前卡片的
        var p = ps[ps.length - 1];
        if (!p) return { err: 'no-panel', n: ps.length };
        var b = [...p.querySelectorAll('button')].find(function (x) { return x.textContent.indexOf('完整内容') >= 0; });
        if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { ok: !!b, panels: ps.length };
      })()`)
      await wait(2400)
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await wait(400)
      const v1 = await viewOf(winId)
      if (v1 && v1.view === 'embed') return { id: winId, view: 'embed', attempts: attempt }
      if (attempt === 4) return { id: winId, err: 'still-host', hit: hit, last: v1 }
    }
  }
  const runIn = (winId, expr) => js(`(() => {
    var card = document.querySelector('.plugin-card[data-win-id="' + ${JSON.stringify(winId)} + '"]');
    if (!card) return { err: 'no-card' };
    var f = card.querySelector('iframe');
    if (!f || !f.contentDocument) return { err: 'no-doc' };
    var d = f.contentDocument;
    try { return (${expr})(d); } catch (e) { return { err: String(e.message) }; }
  })()`)
  const ids = () => js(`(() => {
    var o = [];
    document.querySelectorAll('.plugin-card[data-win-id]').forEach(function (c) {
      if ((c.querySelector('.card-head .title') || {}).textContent !== ${JSON.stringify(TITLE)}) return;
      var d = (c.querySelector('iframe') || {}).contentDocument;
      o.push({ winId: c.dataset.winId, tabs: d ? [...d.querySelectorAll('.note-tab')].map(function (x) { return x.textContent.trim(); }) : null });
    });
    return o;
  })()`)

  /**
   * 强制重绘 + 截图。
   *
   * 离屏（show:false）窗口的合成器会缓存上一帧 —— 只调 invalidate() 偶尔
   * 仍抓到旧画面。这里走「微调 opacity → 强制同步布局 → 还原」两段式，
   * 再 invalidate + 等足够久。另外便签插件的 toast（「已拆成独立窗口喵~」）
   * 会飘在卡片上，离屏窗口的后台节流会把它的 2600ms 拖得极长，手动摘掉。
   */
  const shoot = async (name, winIds) => {
    await js(`(() => {
      document.querySelectorAll('.plugin-card[data-win-id]').forEach(function (c) {
        var d = (c.querySelector('iframe') || {}).contentDocument;
        if (d) d.querySelectorAll('.toast').forEach(function (t) { t.remove(); });
      });
      return true;
    })()`)
    await js(`(() => {
      void document.body.offsetHeight;
      document.body.style.opacity = '0.999';
      void document.body.offsetHeight;
      document.body.style.opacity = '';
      return true;
    })()`)
    win.webContents.invalidate()
    await wait(1300)
    const rect = await js(`(() => {
      var ids = ${JSON.stringify(winIds)};
      var sel = ids.map(function (i) { return '.plugin-card[data-win-id="' + i + '"]'; }).join(',');
      var els = [...document.querySelectorAll(sel)];
      if (!els.length) return null;
      var l = Math.min(...els.map(function (e) { return e.getBoundingClientRect().left; }));
      var t = Math.min(...els.map(function (e) { return e.getBoundingClientRect().top; }));
      var r = Math.max(...els.map(function (e) { return e.getBoundingClientRect().right; }));
      var b = Math.max(...els.map(function (e) { return e.getBoundingClientRect().bottom; }));
      return { x: Math.max(0, Math.round(l) - 14), y: Math.max(0, Math.round(t) - 14), width: Math.round(r - l) + 28, height: Math.round(b - t) + 28 };
    })()`)
    if (!rect) { console.log(name + ' 取不到 rect'); return }
    win.webContents.invalidate()
    await wait(500)
    fs.writeFileSync(path.join(SHOTS, name + '.png'), (await win.webContents.capturePage(rect)).toPNG())
    console.log('✓ ' + name + '.png ' + JSON.stringify(rect))
  }

  /** 拖动一个标签；opts.before 指定卡片内参照，opts.px/py 指定父页面坐标 */
  const dragTab = (winId, label, opts) => runIn(winId, `function (d) {
    var w = d.defaultView;
    var tabs = [...d.querySelectorAll('.note-tab')];
    var src = tabs.find(function (t) { return t.textContent.trim() === ${JSON.stringify(label)}; });
    if (!src) return { err: 'no-tab' };
    var r = src.getBoundingClientRect();
    var sx = r.left + r.width / 2, sy = r.top + r.height / 2;
    var tx, ty;
    var BEFORE = ${JSON.stringify((opts && opts.before) || null)};
    if (BEFORE) {
      var ref = tabs.find(function (t) { return t.textContent.trim() === BEFORE; });
      if (!ref) return { err: 'no-ref' };
      var rr = ref.getBoundingClientRect();
      tx = rr.left + 2; ty = rr.top + rr.height / 2;
    } else {
      var fe = w.frameElement, fr = fe.getBoundingClientRect();
      tx = (${JSON.stringify((opts && opts.px) || 0)} - fr.left) * (fe.clientWidth || 1) / fr.width;
      ty = (${JSON.stringify((opts && opts.py) || 0)} - fr.top) * (fe.clientHeight || 1) / fr.height;
    }
    var ME = w.MouseEvent;
    src.dispatchEvent(new ME('mousedown', { button: 0, clientX: sx, clientY: sy, bubbles: true }));
    d.dispatchEvent(new ME('mousemove', { clientX: tx, clientY: ty, bubbles: true }));
    if (${JSON.stringify(!!(opts && opts.hold))}) return { ok: true, held: true, to: [Math.round(tx), Math.round(ty)] };
    d.dispatchEvent(new ME('mouseup', { button: 0, clientX: tx, clientY: ty, bubbles: true }));
    return { ok: true, to: [Math.round(tx), Math.round(ty)] };
  }`)

  /**
   * 把便签窗口摆成整齐的一行，并把其它插件卡片收起来。
   *
   * 为什么不「用真实拖拽事件把卡片挪过去」——试过了，不行：
   *   拖动卡片靠近画布边缘时，宿主会**沿拖动方向平移整个工作台**
   *   （这是用户要的行为：拖窗口只平移、不缩放）。于是第一张卡片一挪，
   *   画布就跟着跑，后面几张的目标坐标全部失效，最后卡片被甩到视口外，
   *   iframe 的 frameElement 跑到屏幕下方，拖标签的落点算出来是负值 ——
   *   合并自然打不中目标。
   *
   * 直接写 localStorage 再 reload 是确定的：位置就是写进去的位置。
   * 代价是 reload 会把所有 iframe 重建成默认的 host（精简）形态，
   * 所以之后必须逐个切回「完整内容」——那就得切得可靠（见 setFull）。
   */
  const place = async (winIds) => {
    const wrote = await js(`(() => {
      var ids = ${JSON.stringify(winIds)};
      var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
      var ws = (s.workspaces || []).find(function (w) { return w.id === s.activeWorkspace; }) || (s.workspaces || [])[0];
      if (!ws) return { err: 'no-ws' };
      var n = 0, hidden = 0;
      (ws.windows || []).forEach(function (w) {
        var i = ids.indexOf(w.id);
        if (i >= 0) { w.visible = true; w.x = 40 + i * 470; w.y = 40; w.w = 440; w.h = 520; n++; }
        // 别的插件卡片全部收起来：既让截图干净，也避免它恰好压在落点上
        // 被 cardAtPoint 先命中（那样落点会被判成 'none'，合并直接不做）
        else if (w.pluginId !== 'lab.12' && w.visible) { w.visible = false; hidden++; }
      });
      localStorage.setItem('workbench:state:v1', JSON.stringify(s));
      return { placed: n, hidden: hidden };
    })()`)
    await win.webContents.reload()
    await wait(2400)
    await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
    await wait(2800)
    const out = []
    for (const id of winIds) out.push({ id: id, full: await setFull(id) })
    return { wrote: wrote, full: out }
  }

  fs.mkdirSync(SHOTS, { recursive: true })
  await goDesktop()
  await openFromDock()

  let snap = await ids()
  const W1 = snap[0] && snap[0].winId
  await runIn(W1, `function (d) {
    var b = d.querySelector('#new-note');
    b.dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true }));
    b.dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true }));
    return true;
  }`)
  await wait(1200)
  // 摆到视口左上角、收起其它插件卡片，并切回「完整内容」——
  // 刚开出来的窗口是精简形态，没有标签栏，拍不到拖动的样子
  console.log('① 摆位 ' + JSON.stringify(await place([W1])))
  snap = await ids()
  console.log('三张便签 ' + JSON.stringify(snap))

  // ① 标签栏起点
  await shoot('notes-1-tabs', [W1])

  // ② 拖动中：落在卡片内 → 出现插入位竖条
  await dragTab(W1, '便签 3', { before: '便签 1', hold: true })
  await wait(500)
  await shoot('notes-2-dragging', [W1])
  await js(`(() => {
    var d = document.querySelector('.plugin-card[data-win-id="' + ${JSON.stringify(W1)} + '"] iframe').contentDocument;
    d.dispatchEvent(new d.defaultView.MouseEvent('mouseup', { button: 0, clientX: 12, clientY: 24, bubbles: true }));
    return true;
  })()`)
  await wait(1500)
  console.log('① 排序后 ' + JSON.stringify(await ids()))

  // ③ 拖出卡片 → 拆成独立窗口
  const pt = await js(`(() => {
    var vp = document.querySelector('.desktop-viewport').getBoundingClientRect();
    return { x: Math.round(vp.left + 8), y: Math.round(vp.bottom - 8) };
  })()`)
  await dragTab(W1, '便签 2', { px: pt.x, py: pt.y })
  await wait(3000)
  snap = await ids()
  console.log('② 拆出后 ' + JSON.stringify(snap))
  // 拖出去的新窗口出生时是 host（精简）形态，没有标签栏可看；
  // place() 会写位置 + reload + 逐个切回「完整内容」
  console.log('② 摆位 ' + JSON.stringify(await place(snap.map(s => s.winId))))
  await shoot('notes-3-tearout', snap.map(s => s.winId))

  // ④ 再并回去：把 W1 的「便签 3」拖到 W2 身上
  //
  // 为什么不从插件坞再开第三个窗口当目标 —— 试过了，讲不清故事：
  // 坞里新开的窗口 config.notes 是空的，按「没写归属 = 显示全部」的约定，
  // 它会一次性列出全部三张便签，截图上看像是「所有窗口都有所有便签」，
  // 反而把「每个窗口各管几张」这件事拍糊了。
  // W1（便签 3 / 便签 1）与 W2（便签 2）本来就是拆出来的两个互补子集，
  // 把 W1 的「便签 3」并到 W2，结果 W1 只剩「便签 1」、W2 变成「便签 2 / 便签 3」，
  // 两张图前后对照，一眼就能看出「条目在窗口之间搬家」。
  const W2 = snap[1] && snap[1].winId
  if (W2) {
    const ctr = await js(`(() => {
      var r = document.querySelector('.plugin-card[data-win-id="' + ${JSON.stringify(W2)} + '"]').getBoundingClientRect();
      // 落点取目标卡片的标题栏（避开 body：拖到 body 上也算命中该卡片，
      // 但标题栏更稳 —— 它一定在卡片矩形内且不会被别的卡片盖住）
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 14) };
    })()`)
    console.log('④ 拖向 W2 ' + JSON.stringify(ctr) + ' ' +
      JSON.stringify(await dragTab(W1, '便签 3', { px: ctr.x, py: ctr.y })))
    await wait(2800)
    snap = await ids()
    console.log('④ 合并后 ' + JSON.stringify(snap))
    await shoot('notes-4-merge', snap.map(s => s.winId))
  }

  clearTimeout(HARD)
  app.exit(0)
}, 400))
