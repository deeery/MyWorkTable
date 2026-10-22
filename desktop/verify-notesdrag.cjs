/* ============================================================
   验收：便签拖动标题
   ------------------------------------------------------------
     ① 卡片内拖动      → 只改本窗口的标签顺序，并持久化
     ② 拖出所有卡片    → 拆成一张独立的新窗口，原窗口删去它
     ③ 拖到别的便签窗口 → 并进去，源窗口删去它
     ④ 源窗口只剩一张时 → 两边都不许动（不能做一半留个重影）

   丢落点由宿主仲裁（core/cardDrag.ts + Desktop.tsx 的「卡片间拖放仲裁」），
   插件只负责报坐标与画反馈，所以这里必须驱动**真实**的 mousedown /
   mousemove / mouseup 三条事件，而不能直接改 localStorage —— 后者
   绕过了整条链路，测了等于没测。

   ⚠ 坐标有两套：
     · 插件内部用的是 iframe 局部坐标
     · 宿主判定用的是**父页面视口坐标**
     两边靠 frameElement 的 rect 与 clientWidth 换算（插件里的 toParentXY）。
     本脚本要「落在某张卡片上」或「落在所有卡片之外」，说的是父页面坐标，
     所以要反算回 iframe 局部坐标再派发事件。
   ============================================================ */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 300000)
const out = []
const log = (s) => { out.push(s); console.log(s) }

const TITLE = '快速便签'
const N1 = '便签 1', N2 = '便签 2', N3 = '便签 3'

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  win.setSize(1400, 900)
  const js = async (s) => {
    try { return await win.webContents.executeJavaScript(s) }
    catch (e) { return { __err: String((e && e.message) || e) } }
  }

  /* 清干净上一轮残留。三步顺序不能反：先离开页面（触发便签的
     beforeunload → save()），再清 localStorage，最后才加载应用。 */
  await win.loadURL('about:blank')
  await wait(600)
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(2000)

  /* ---------- 装快速便签 ---------- */
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

  /** 从插件坞开一个新窗口（正规入口，config 由宿主给） */
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

  /**
   * 把一张卡片切到「🪟 完整内容」。
   *
   * ⚠ 拖动**只能**在完整内容形态下测：精简（host）模式里 compact.css 有一条
   *   `body.pl-compact .win { display:none !important }`
   * 整个完整窗口都被藏起来了，`#tabs` 的 getBoundingClientRect() 全是 0，
   * 连按下点都算不出来。上一版脚本就是栽在这 —— 报「拖动无效」，
   * 其实是拖了个不可见的元素。用户的需求原文也是「在**完整界面**拖动便签
   * 顶部栏时可改换顺序」，本来就该在这个形态下验。
   */
  const setFull = async (winId) => {
    const ID = JSON.stringify(winId)
    await js(`(() => {
      var c = document.querySelector('.plugin-card[data-win-id=' + ${ID} + ']');
      var g = c && c.querySelector('.gear');
      if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return !!g;
    })()`)
    await wait(1200)
    const r = await js(`(() => {
      var p = document.querySelector('.settings-panel');
      if (!p) return { err: 'no-panel' };
      var b = [...p.querySelectorAll('button')].find(function (x) { return x.textContent.includes('完整内容'); });
      if (!b) return { err: 'no-full-btn', btns: [...p.querySelectorAll('button')].map(function (x) { return x.textContent; }) };
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true };
    })()`)
    await wait(2800)
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(700)
    return r
  }

  /** 确认完整窗口真的露出来了（标签量得到尺寸，才谈得上拖动） */
  const tabsVisible = (winId) => runIn(winId, `function (d) {
    var t = d.querySelector('.note-tab');
    var r = t ? t.getBoundingClientRect() : null;
    return {
      url: d.location.search,
      winH: (d.querySelector('.win') || {}).offsetHeight || 0,
      tabW: r ? Math.round(r.width) : 0,
      tabs: d.querySelectorAll('.note-tab').length,
    };
  }`)

  await goDesktop()
  await openFromDock()

  /* ---------- 通用探针 ---------- */

  /** 一次拿到全部便签窗口：顺序 + 虚线框状态 */
  const snapshot = () => js(`(() => {
    var list = [];
    document.querySelectorAll('.plugin-card[data-win-id]').forEach(function (c) {
      var t = (c.querySelector('.card-head .title') || {}).textContent;
      if (t !== ${JSON.stringify(TITLE)}) return;
      var f = c.querySelector('iframe');
      var d = f && f.contentDocument;
      var tabs = d ? d.querySelector('#tabs') : null;
      list.push({
        winId: c.dataset.winId,
        tabs: tabs ? [...tabs.querySelectorAll('.note-tab')].map(function (x) { return x.textContent.trim(); }) : null,
        out: tabs ? tabs.classList.contains('out') : null,
        gap: tabs ? !!tabs.querySelector('.note-gap') : null,
      });
    });
    return list;
  })()`)

  /** 某个窗口在 localStorage 里的 config.notes（本窗口的归属，逗号分隔 id） */
  const cfgNotes = (winId) => js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(function (w) { return w.id === s.activeWorkspace; }) || (s.workspaces || [])[0];
    if (!ws) return { err: 'no-ws' };
    var w = (ws.windows || []).find(function (x) { return x.id === ${JSON.stringify(winId)}; });
    if (!w) return { err: 'no-win' };
    return { notes: (w.config && w.config.notes) || '', visible: w.visible };
  })()`)

  /** 某个窗口里各标签对应的便签 id（按标签顺序） */
  const tabIds = (winId) => runIn(winId, `function (d) {
    return { ids: [...d.querySelectorAll('.note-tab')].map(function (x) { return x.dataset.id; }) };
  }`)

  /** 在某个窗口里点按钮 / 读内容 */
  const runIn = (winId, expr) => js(`(() => {
    var card = document.querySelector('.plugin-card[data-win-id="' + ${JSON.stringify(winId)} + '"]');
    if (!card) return { err: 'no-card' };
    var f = card.querySelector('iframe');
    if (!f || !f.contentDocument) return { err: 'no-doc' };
    var d = f.contentDocument;
    try { return (${expr})(d); } catch (e) { return { err: String(e.message) }; }
  })()`)

  const addNote = (winId) => runIn(winId, `function (d) {
    var b = d.querySelector('#new-note');
    if (!b) return { err: 'no new-note' };
    b.dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true }));
    return { n: d.querySelectorAll('.note-tab').length };
  }`)

  /**
   * 拖动一个标签。
   *
   *   opts.before  → 落在同卡片内某一个标签的左半边（改顺序）
   *   opts.px/py   → 落在**父页面视口坐标**的某一点（拆出 / 合并）
   */
  const dragTab = (winId, label, opts) => runIn(winId, `function (d) {
    var w = d.defaultView;
    var tabs = [...d.querySelectorAll('.note-tab')];
    var src = tabs.find(function (t) { return t.textContent.trim() === ${JSON.stringify(label)}; });
    if (!src) return { err: 'no-tab ' + ${JSON.stringify(label)} + ' in [' + tabs.map(function (t) { return t.textContent.trim(); }).join('|') + ']' };
    var r = src.getBoundingClientRect();
    var sx = r.left + r.width / 2, sy = r.top + r.height / 2;

    var tx, ty;
    var BEFORE = ${JSON.stringify(opts && opts.before ? opts.before : null)};
    var PX = ${JSON.stringify(opts && typeof opts.px === 'number' ? opts.px : null)};
    if (BEFORE) {
      var ref = tabs.find(function (t) { return t.textContent.trim() === BEFORE; });
      if (!ref) return { err: 'no ref tab ' + BEFORE };
      var rr = ref.getBoundingClientRect();
      // 落在参照标签的**左半区**才会插到它前面（见插件的 moveGap）
      tx = rr.left + 2;
      ty = rr.top + rr.height / 2;
    } else {
      // 父页面视口坐标 → iframe 局部坐标。
      // 画布带 transform:scale()，光靠 clientX 会偏，必须用 rect 与
      // clientWidth 的比值换算（与插件里 toParentXY 互逆）。
      var fe = w.frameElement;
      if (!fe) return { err: 'no frameElement' };
      var fr = fe.getBoundingClientRect();
      var iw = fe.clientWidth || 1, ih = fe.clientHeight || 1;
      tx = (PX - fr.left) * iw / fr.width;
      ty = (${JSON.stringify(opts && typeof opts.py === 'number' ? opts.py : null)} - fr.top) * ih / fr.height;
    }

    var ME = w.MouseEvent;
    src.dispatchEvent(new ME('mousedown', { button: 0, clientX: sx, clientY: sy, bubbles: true }));
    d.dispatchEvent(new ME('mousemove', { clientX: tx, clientY: ty, bubbles: true }));
    d.dispatchEvent(new ME('mouseup', { button: 0, clientX: tx, clientY: ty, bubbles: true }));
    return { ok: true, from: [Math.round(sx), Math.round(sy)], to: [Math.round(tx), Math.round(ty)] };
  }`)

  /** 所有卡片之外的一点（父页面视口坐标），用于「拖出去」 */
  const outsidePoint = () => js(`(() => {
    var vp = document.querySelector('.desktop-viewport').getBoundingClientRect();
    var cards = [...document.querySelectorAll('.plugin-card[data-win-id]')].map(function (c) { return c.getBoundingClientRect(); });
    var pts = [
      [vp.left + 6, vp.bottom - 6], [vp.left + 6, vp.top + 6],
      [vp.right - 6, vp.bottom - 6], [vp.right - 6, vp.top + 6],
      [vp.left + vp.width / 2, vp.bottom - 6],
    ];
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][0], y = pts[i][1];
      var hit = cards.some(function (r) { return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
      if (!hit) return { x: Math.round(x), y: Math.round(y) };
    }
    return { err: '没有卡片之外的空位' };
  })()`)

  /** 某张卡片的中心（父页面视口坐标） */
  const cardCenter = (winId) => js(`(() => {
    var c = document.querySelector('.plugin-card[data-win-id="' + ${JSON.stringify(winId)} + '"]');
    if (!c) return { err: 'no-card' };
    var r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 30) };
  })()`)

  const problems = []
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  /* ============================================================
     准备：一张便签窗口 + 三张便签
     ============================================================ */
  let snap = await snapshot()
  log('初始窗口 ' + JSON.stringify(snap))
  if (!Array.isArray(snap) || snap.length !== 1) {
    problems.push(`准备阶段应有 1 个便签窗口，实际 ${Array.isArray(snap) ? snap.length : JSON.stringify(snap)}`)
  }
  const W1 = Array.isArray(snap) && snap[0] && snap[0].winId
  if (!W1) { finish(); return }

  // 用插件自己的「新建」按钮造数据（不能直接写 localStorage —— 插件
  // 的 notes 是内存里的，界面之外改的数据它根本看不见）
  await addNote(W1); await wait(400)
  await addNote(W1); await wait(900)
  snap = await snapshot()
  const w1 = snap.find(s => s.winId === W1)
  log('三张便签 ' + JSON.stringify(w1.tabs))
  if (!w1 || !eq(w1.tabs, [N1, N2, N3])) {
    problems.push(`应有 [${N1},${N2},${N3}]，实际 ${JSON.stringify(w1 && w1.tabs)}`)
  }

  /* ============================================================
     ① 卡片内拖动 → 只改顺序
     ============================================================ */
  /* 先切到「完整内容」：精简（host）模式下 compact.css 把整个 .win 藏了
     （body.pl-compact .win { display:none !important }），标签一个都量不到
     尺寸，拖动无从谈起。用户的需求本来也是「完整界面拖动便签顶部栏」。 */
  log('切完整内容 ' + JSON.stringify(await setFull(W1)))
  const vis = await tabsVisible(W1)
  log('完整内容下的标签 ' + JSON.stringify(vis))
  if (!vis || !vis.tabW) {
    problems.push(`完整内容下标签量不到尺寸（拖动无从下手）：${JSON.stringify(vis)}`)
    finish(); return
  }

  const idsBefore = await tabIds(W1)
  log('拖动前的标签 id ' + JSON.stringify(idsBefore.ids))
  log('拖「' + N3 + '」到「' + N1 + '」之前 ' + JSON.stringify(await dragTab(W1, N3, { before: N1 })))
  await wait(1600)

  snap = await snapshot()
  const w1b = snap.find(s => s.winId === W1)
  log('① 卡片内排序后 ' + JSON.stringify(w1b && w1b.tabs))
  if (!w1b || !eq(w1b.tabs, [N3, N1, N2])) {
    problems.push(`卡片内排序失败：期望 [${N3},${N1},${N2}]，实际 ${JSON.stringify(w1b && w1b.tabs)}`)
  }
  if (w1b && w1b.out) problems.push('① 排序结束后标签栏还描着虚线框（out 类没摘掉）')
  if (snap.length !== 1) problems.push(`① 卡片内排序不该新建窗口，实际有 ${snap.length} 个`)

  const orderIds = (await tabIds(W1)).ids
  const cfg1 = await cfgNotes(W1)
  log('① 归属 ' + JSON.stringify(cfg1))
  if (cfg1.notes !== orderIds.join(',')) {
    problems.push(`① 新顺序没落到窗口 config：config="${cfg1.notes}"，标签顺序="${orderIds.join(',')}"`)
  }

  /* ============================================================
     ② 拖出所有卡片 → 拆成独立新窗口
     ============================================================ */
  const pt = await outsidePoint()
  log('卡片外的落点 ' + JSON.stringify(pt))
  if (pt.err) problems.push('② ' + pt.err)
  log('拖「' + N2 + '」到卡片外 ' + JSON.stringify(await dragTab(W1, N2, { px: pt.x, py: pt.y })))
  await wait(3000)

  snap = await snapshot()
  log('② 拆出之后 ' + JSON.stringify(snap))
  if (snap.length !== 2) {
    problems.push(`② 拖出卡片外应拆成 2 个窗口，实际 ${snap.length} 个`)
  } else {
    const src = snap.find(s => s.winId === W1)
    const dst = snap.find(s => s.winId !== W1)
    if (!src || !eq(src.tabs, [N3, N1])) {
      problems.push(`② 原窗口应剩 [${N3},${N1}]，实际 ${JSON.stringify(src && src.tabs)}`)
    }
    if (!dst || !eq(dst.tabs, [N2])) {
      problems.push(`② 新窗口应只显示 [${N2}]，实际 ${JSON.stringify(dst && dst.tabs)}`)
    }
    if (src && src.out) problems.push('② 拆分后原窗口的虚线框没摘掉（宿主没回 final 回执）')
    if (dst) {
      const c = await cfgNotes(dst.winId)
      const dids = (await tabIds(dst.winId)).ids
      if (c.notes !== dids.join(',')) {
        problems.push(`② 新窗口的归属没写进它自己的 config：config="${c.notes}"，实际显示="${dids.join(',')}"`)
      }
      // 同一张便签不能同时留在两个窗口里
      const srcIds = (await tabIds(W1)).ids
      const dup = srcIds.filter(x => dids.includes(x))
      if (dup.length) problems.push(`② 拆出后同一张便签仍在原窗口：${dup.join(',')}`)
    }
  }

  /* ============================================================
     ③ 源窗口只剩一张时，并进去必须被整体拒绝
        （不能做一半：目标窗口加了、源窗口却没删 → 同一张便签出现两次）
     ============================================================ */
  const W2 = snap.find(s => s.winId !== W1)
  if (!W2) {
    problems.push('③ 跳过：② 没有拆出新窗口')
  } else {
    // 新窗口是 host（精简）形态开的，它的 .win 被藏了，同样得先切完整内容
    log('③ 新窗口切完整内容 ' + JSON.stringify(await setFull(W2.winId)))
    const vis2 = await tabsVisible(W2.winId)
    if (!vis2 || !vis2.tabW) problems.push(`③ 新窗口在完整内容下标签量不到尺寸：${JSON.stringify(vis2)}`)

    // ⚠ 一律用**便签 id** 比较，不能拿标签文字和 id 混着比：
    //   标签文字会重名（三张都叫「便签 N」时更是如此），config 里存的是 id。
    const idOf = async (winId) => (await tabIds(winId)).ids.join(',')
    const before3 = { src: await idOf(W1), dst: await idOf(W2.winId), cfg: (await cfgNotes(W1)).notes }

    const ctr = await cardCenter(W1)
    log('拖「' + N2 + '」（源窗口只剩这一张）到 W1 身上 ' + JSON.stringify(await dragTab(W2.winId, N2, { px: ctr.x, py: ctr.y })))
    await wait(2200)

    snap = await snapshot()
    const a = snap.find(s => s.winId === W1)
    const b = snap.find(s => s.winId === W2.winId)
    log('③ 整体拒绝后 ' + JSON.stringify(snap.map(s => ({ id: s.winId, tabs: s.tabs, out: s.out }))))
    if (snap.length !== 2) problems.push(`③ 拒绝时不该增删窗口，实际 ${snap.length} 个`)
    if (!a) problems.push('③ 目标窗口不见了')
    if (!b) problems.push('③ 源窗口不见了')
    if (a && (await idOf(W1)) !== before3.src) {
      problems.push(`③ 源窗口只剩一张时，目标窗口却还是被改了：原来 [${before3.src}]，现在 [${await idOf(W1)}]`)
    }
    if (b && (await idOf(W2.winId)) !== before3.dst) {
      problems.push(`③ 源窗口不该有变化：原来 [${before3.dst}]，现在 [${await idOf(W2.winId)}]`)
    }
    const cfgAfter = (await cfgNotes(W1)).notes
    if (cfgAfter !== before3.cfg) {
      problems.push(`③ 目标窗口的 config.notes 被改了：原来 "${before3.cfg}"，现在 "${cfgAfter}"`)
    }
    if (a && a.out) problems.push('③ 被拒绝后目标窗口不该有虚线框')
    if (b && b.out) problems.push('③ 被拒绝后源窗口的虚线框没摘掉（宿主回了 none 但没带 final）')
  }

  /* ============================================================
     ④ 真的合并：从第三个窗口（没记归属 → 显示全部三张）拖一张到 W1
     ============================================================ */
  await openFromDock()
  snap = await snapshot()
  const W3 = snap.map(s => s.winId).find(id => id !== W1 && (!W2 || id !== W2.winId))
  log('④ 第三个窗口 ' + JSON.stringify(snap.map(s => ({ id: s.winId, tabs: s.tabs }))))
  if (!W3) {
    problems.push('④ 跳过：没开出第三个窗口')
  } else {
    log('④ 第三个窗口切完整内容 ' + JSON.stringify(await setFull(W3)))
    const tgtBefore = (await tabIds(W1)).ids
    const ctr = await cardCenter(W1)
    log('拖「' + N2 + '」到 W1 身上 ' + JSON.stringify(await dragTab(W3, N2, { px: ctr.x, py: ctr.y })))
    await wait(2400)

    snap = await snapshot()
    const a = snap.find(s => s.winId === W1)
    const c = snap.find(s => s.winId === W3)
    log('④ 合并后 ' + JSON.stringify(snap.map(s => ({ id: s.winId, tabs: s.tabs, out: s.out }))))
    if (!a || !a.tabs.includes(N2)) {
      problems.push(`④ 合并后目标窗口应含「${N2}」，实际 ${JSON.stringify(a && a.tabs)}`)
    }
    if (c && c.tabs.includes(N2)) {
      problems.push(`④ 合并后源窗口应删去「${N2}」，实际 ${JSON.stringify(c.tabs)}`)
    }
    if (c && c.out) problems.push('④ 合并后源窗口的虚线框没摘掉（宿主没回 final 回执）')
    if (a && c) {
      const ai = (await tabIds(W1)).ids
      // 目标窗口原有的条目顺序不能被打乱，新来的追加在后面
      const kept = ai.filter(x => tgtBefore.includes(x))
      if (kept.join(',') !== tgtBefore.join(',')) {
        problems.push(`④ 合并把目标窗口原有顺序打乱了：原来 [${tgtBefore.join(',')}]，现在 [${kept.join(',')}]`)
      }
      const cfgA = await cfgNotes(W1)
      if (cfgA.notes !== ai.join(',')) {
        problems.push(`④ 目标窗口的 config 顺序与实际标签不一致：config="${cfgA.notes}"，标签="${ai.join(',')}"`)
      }
      /**
       * ⚠ 这里只查**被拖的那一张**有没有重复，不能查两个窗口的 id 集合交集。
       *
       * 从插件坞新开的窗口没有 config.notes，按设计「没记归属 = 显示全部」，
       * 所以它本来就会显示别的窗口已经拥有的那几张 —— 交集非空是正常的。
       * 唯一必须成立的排他性约束是：刚被拖进去的那一张不能在源窗口里还留着。
       */
    }
  }

  finish()

  function finish() {
    log('')
    log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')
    fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
    fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-notesdrag.txt'), out.join('\n') + '\n', 'utf8')
    clearTimeout(HARD)
    app.exit(problems.length ? 1 : 0)
  }
}, 400))
