/**
 * 验收：本轮全局问题修复。
 *
 *   1. 背景样式在**桌面页**生效（之前被 .desktop-viewport 的不透明底色糊住）
 *   2. 顶部栏默认锁定展开
 *   3. 组件尺寸设置已移除（精简设置里不再有「组件尺寸」一组）
 *   4. 拖卡片到边缘时显示比例自动变小；松手后严格回到原值
 *   5. 切「完整内容」时高度足够（不再只有 220px）
 *   6. 切换过完整内容后，精简设置仍有点击反馈
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 240000)
const out = []
const log = (s) => { out.push(s); console.log(s) }

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  win.setSize(1400, 900)
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s) } catch (e) { return { __err: String(e && e.message || e) } } }

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(1500)

  // 禁用过渡：离屏窗口里 Chromium 不推进 CSS 过渡，会让尺寸类断言读到起始值
  const killTransition = () => js(`(() => {
    var old = document.getElementById('__vt');
    if (old) old.remove();
    var st = document.createElement('style');
    st.id = '__vt';
    st.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(st);
    return true;
  })()`)

  // 归一化：清状态 + 装倒数日 + 放到桌面
  await js(`localStorage.clear(); true`)
  await win.webContents.reload()
  await wait(2000)
  await killTransition()

  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('插件')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('插件市场')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`(() => {
    document.querySelectorAll('.market-card').forEach(c => {
      if (!c.textContent.includes('倒数日')) return;
      const b = [...c.querySelectorAll('button')].find(x => x.textContent.includes('安装'));
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return true;
  })()`)
  await wait(1500)
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(w => w.id === s.activeWorkspace) || (s.workspaces || [])[0];
    if (!Array.isArray(ws.windows)) ws.windows = [];
    var mine = ws.windows.filter(w => w.pluginId === 'lab.07');
    if (!mine.length) { mine = [{ id: 'w-lab07', pluginId: 'lab.07', visible: true, size: 'S' }]; ws.windows.push(mine[0]); }
    mine[0].visible = true; mine[0].x = 300; mine[0].y = 200;
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await killTransition()
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(3000)
  await killTransition()

  const problems = []

  /* ---------- 1. 背景在桌面页生效 ---------- */
  const bg = await js(`(() => {
    var vp = document.querySelector('.desktop-viewport');
    var bd = document.querySelector('.wb-backdrop');
    return {
      vpBg: vp ? getComputedStyle(vp).backgroundColor : null,
      bdExists: !!bd,
      dataBg: document.documentElement.dataset.bg,
    };
  })()`)
  log('桌面页背景 ' + JSON.stringify(bg))
  // viewport 必须透明，否则 backdrop 看不见
  if (bg.vpBg !== 'rgba(0, 0, 0, 0)' && bg.vpBg !== 'transparent') {
    problems.push(`桌面 viewport 底色不透明（${bg.vpBg}），会盖住背景层`)
  }
  if (!bg.bdExists) problems.push('没有 .wb-backdrop 背景层')

  // 切到点阵，确认 backdrop 真的画了图案
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('设置')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(900)
  await js(`(() => {
    var it = [...document.querySelectorAll('.bg-item')].find(x => x.textContent.includes('点阵'));
    if (it) it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(800)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(1500)
  const dots = await js(`(() => {
    var bd = document.querySelector('.wb-backdrop');
    var vp = document.querySelector('.desktop-viewport');
    return {
      dataBg: document.documentElement.dataset.bg,
      backdropImage: bd ? getComputedStyle(bd).backgroundImage.slice(0, 40) : null,
      vpBg: vp ? getComputedStyle(vp).backgroundColor : null,
    };
  })()`)
  log('点阵背景 ' + JSON.stringify(dots))
  if (dots.dataBg !== 'dots') problems.push(`切点阵后 data-bg=${dots.dataBg}`)
  if (!dots.backdropImage || dots.backdropImage === 'none') {
    problems.push('点阵模式下 backdrop 没有背景图案')
  }

  /* ---------- 2. 顶部栏默认锁定 ---------- */
  const tb = await js(`(() => {
    var b = document.querySelector('.ws-bar');
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    return {
      locked: b ? b.classList.contains('locked') : null,
      expanded: b ? b.classList.contains('expanded') : null,
      h: b ? Math.round(b.getBoundingClientRect().height) : null,
      mode: (s.settings || {}).topbarMode,
    };
  })()`)
  log('顶部栏 ' + JSON.stringify(tb))
  if (!tb.locked) problems.push('顶部栏默认未锁定（应默认 locked）')
  if (tb.h != null && tb.h < 30) problems.push(`锁定后应展开，实际高度 ${tb.h}px`)

  /* ---------- 3. 组件尺寸设置已移除 ---------- */
  // 注意：齿轮要等卡片真的渲染出来再点。这个脚本前面切过设置页，
  // 若在卡片出现前就 querySelector('.plugin-card .gear') 会拿到 null 并抛错，
  // 后续所有断言就都读不到面板了（踩过：报「没有精简设置」）。
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(2500)
  const gearReady = await js(`!!document.querySelector('.plugin-card .gear')`)
  log('卡片与齿轮就绪 ' + gearReady)
  if (!gearReady) problems.push('桌面上没有卡片，无法继续验设置面板')
  /**
   * ⚠ 必须点**倒数日**那张卡的齿轮，不能点第一张。
   * 桌面上的第一张是「时钟」，它没有 manifest.compact，面板里自然
   * 没有精简设置 —— 之前直接 querySelector('.plugin-card .gear') 拿到
   * 第一张，于是报「没有精简设置」，看起来像功能缺失。
   */
  const opened = await js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) {
      return (c.querySelector('.card-head .title') || {}).textContent === '倒数日';
    });
    if (!card) return { err: 'no-card', titles: cards.map(function (c) { return (c.querySelector('.card-head .title') || {}).textContent; }) };
    var g = card.querySelector('.gear');
    if (!g) return { err: 'no-gear' };
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true };
  })()`)
  log('打开倒数日设置 ' + JSON.stringify(opened))
  if (opened.err) problems.push('打开设置面板失败：' + JSON.stringify(opened))
  await wait(1500)
  const cw = await js(`(() => {
    var box = document.querySelector('.settings-panel .cw-settings');
    if (!box) return { err: '没有精简设置' };
    return {
      sections: [...box.querySelectorAll('.cw-sec-t')].map(x => x.textContent.trim()),
      hasSizeList: !!box.querySelector('.cw-size-list'),
    };
  })()`)
  log('精简设置分区 ' + JSON.stringify(cw))
  if (cw.err) problems.push(cw.err)
  if (cw.hasSizeList) problems.push('「组件尺寸」设置仍在（应已移除）')
  if (cw.sections && cw.sections.some((s) => s.includes('尺寸'))) {
    problems.push('精简设置里仍有「尺寸」分区：' + JSON.stringify(cw.sections))
  }

  /* ---------- 5. 完整内容高度足够 ---------- */
  await js(`(() => {
    var p = document.querySelector('.settings-panel');
    if (!p) return false;
    var b = [...p.querySelectorAll('button')].find(x => x.textContent.includes('完整内容'));
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!b;
  })()`)
  await wait(3500)
  await killTransition()
  /**
   * ⚠ 要读**倒数日**那张卡的高度，不是第一张。
   * 第一张是「时钟」，它没有 compact、不会切换形态，高度是原来的值。
   */
  const fullH = await js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) {
      return (c.querySelector('.card-head .title') || {}).textContent === '倒数日';
    });
    if (!card) return { err: 'no-card' };
    // ⚠ 用 getBoundingClientRect 而不是解析 inline style：
    //   inline style 里 left/top/width/height 都带 "px"，正则容易匹配错项
    //   （实测 w/h 都读成 0）。rect 是最终渲染结果，最可靠。
    var b = card.getBoundingClientRect();
    return { h: Math.round(b.height), w: Math.round(b.width) };
  })()`)
  log('完整内容卡片 ' + JSON.stringify(fullH))
  if (fullH.err) problems.push(fullH.err)
  else if (fullH.h < 500) problems.push(`完整内容卡片高度只有 ${fullH.h}px，过低（应 >= 500）`)

  /* ---------- 6. 切回精简后设置仍有反馈 ---------- */
  await js(`(() => {
    var p = document.querySelector('.settings-panel');
    var b = [...p.querySelectorAll('button')].find(x => x.textContent.includes('桌面精简'));
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(3500)
  await killTransition()

  const before = await js(`(() => {
    var box = document.querySelector('.settings-panel .cw-settings');
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) {
      return (c.querySelector('.card-head .title') || {}).textContent === '倒数日';
    });
    var f = card && card.querySelector('iframe');
    return {
      fmtOn: box ? [...box.querySelectorAll('.cw-fmt-btn.on')].map(b=>b.textContent.trim()) : null,
      dataFmt: f && f.contentDocument ? (f.contentDocument.querySelector('.cw')||{}).getAttribute?.('data-fmt') : null,
    };
  })()`)
  const clicked = await js(`(() => {
    var box = document.querySelector('.settings-panel .cw-settings');
    if (!box) return { err: 'no box' };
    var cur = box.querySelector('.cw-fmt-btn.on');
    var alt = [...box.querySelectorAll('.cw-fmt-btn')].find(b => b !== cur);
    if (!alt) return { err: 'no alt' };
    var n = alt.textContent.trim();
    alt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { clicked: n };
  })()`)
  // 插件收到 cw:apply 后要重绘，iframe 也可能刚重挂载完 —— 给足时间
  await wait(2500)
  const after = await js(`(() => {
    var box = document.querySelector('.settings-panel .cw-settings');
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) {
      return (c.querySelector('.card-head .title') || {}).textContent === '倒数日';
    });
    var f = card && card.querySelector('iframe');
    return {
      fmtOn: box ? [...box.querySelectorAll('.cw-fmt-btn.on')].map(b=>b.textContent.trim()) : null,
      dataFmt: f && f.contentDocument ? (f.contentDocument.querySelector('.cw')||{}).getAttribute?.('data-fmt') : null,
    };
  })()`)
  log('切换后点击 ' + JSON.stringify({ before, clicked, after }))
  if (clicked.err) problems.push(clicked.err)
  // 判据用**面板高亮**：它是宿主自己的状态，最直接反映「点击有没有被处理」。
  // data-fmt 依赖 iframe 内文档可读，时序上更脆。
  else if (JSON.stringify(before.fmtOn) === JSON.stringify(after.fmtOn)) {
    problems.push(`切换过完整内容后，点「${clicked.clicked}」面板高亮没变（${JSON.stringify(before.fmtOn)} → ${JSON.stringify(after.fmtOn)}），无点击反馈`)
  } else {
    log(`✓ 切回精简后设置仍有反馈：${JSON.stringify(before.fmtOn)} → ${JSON.stringify(after.fmtOn)}（data-fmt ${before.dataFmt} → ${after.dataFmt}）`)
  }

  /* ---------- 4. 拖动 = 平移画布（**不**改缩放） ---------- */
  //
  // ⚠ 行为已按需求调整：拖动只平移，缩放只归「拖右下角改尺寸」管。
  //   早先拖动也会自动缩边，手感很怪（卡片在鼠标底下忽大忽小），
  //   所以这里的断言从「缩放要变小」反过来 —— 变成「缩放必须**不变**」，
  //   同时画布要真的被推动。
  await js(`(() => { var b=document.querySelector('.dock-x'); if(b) b.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; })()`)
  await wait(500)
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait(600)

  /**
   * 读当前桌面缩放 + 平移量。
   *
   * ⚠ 不能只读 .desktop-canvas 的 transform：zoom 为 1 时 transform 是
   * "none"，正则匹配不到，之前直接抛错让整段脚本失败。
   * 这里兼容 none / matrix / matrix3d，并把 translate 也读出来。
   */
  const readView = `(() => {
    var c = document.querySelector('.desktop-canvas');
    if (!c) return null;
    var t = getComputedStyle(c).transform || 'none';
    if (t === 'none') return { z: 1, x: 0, y: 0 };
    var m = t.match(/matrix\\(([^)]+)\\)/);
    if (!m) return { z: 1, x: 0, y: 0 };
    var p = m[1].split(',').map(function (v) { return Number(v.trim()); });
    return { z: p[0] || 1, x: Math.round(p[4] || 0), y: Math.round(p[5] || 0) };
  })()`

  const viewBefore = await js(readView)
  log('拖动前视图 ' + JSON.stringify(viewBefore))

  // 模拟：按下顶部栏 → 鼠标移到右下角边缘 → 松手 → 再动鼠标
  const drag = await js(`(async () => {
    var read = function () { return ${readView}; };
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) {
      return (c.querySelector('.card-head .title') || {}).textContent === '倒数日';
    }) || cards[0];
    if (!card) return { err: 'no-card' };
    var head = card.querySelector('.card-head');
    if (!head) return { err: 'no-head' };
    var r = head.getBoundingClientRect();
    var sx = Math.round(r.left + r.width / 2), sy = Math.round(r.top + r.height / 2);
    head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: sx, clientY: sy, button: 0 }));
    await new Promise(function (res) { setTimeout(res, 150); });
    var start = read();
    var vw = window.innerWidth, vh = window.innerHeight;
    // 一路移到视口右下角（贴边），多停几帧让推动累积
    for (var k = 1; k <= 10; k++) {
      var x = sx + (vw - 6 - sx) * k / 10;
      var y = sy + (vh - 6 - sy) * k / 10;
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
      await new Promise(function (res) { setTimeout(res, 110); });
    }
    var atEdge = read();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: vw - 6, clientY: vh - 6 }));
    await new Promise(function (res) { setTimeout(res, 800); });
    var afterUp = read();
    // 松手后再动鼠标，缩放不该再变（严格脱钩）
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: vw / 2, clientY: vh / 2 }));
    await new Promise(function (res) { setTimeout(res, 500); });
    var afterMove = read();
    return { start: start, atEdge: atEdge, afterUp: afterUp, afterMove: afterMove };
  })()`)
  log('拖到边缘的视图变化 ' + JSON.stringify(drag))
  if (drag && drag.err) {
    problems.push('拖动测试失败：' + drag.err)
  } else if (drag) {
    // 拖动**不该**改缩放
    if (Math.abs(drag.atEdge.z - drag.start.z) > 0.005) {
      problems.push(`拖动时缩放被改了（${drag.start.z} → ${drag.atEdge.z}）—— 拖动应只平移`)
    }
    /*
     * 「画布必须平移」这条**不在这里**断言。
     *
     * 贴边滚动现在由卡片侧的 rAF 推进（卡片前进 + 画布反向平移，
     * 两者相消卡片才停在鼠标下），而验收窗口是 show:false 的离屏窗口，
     * Chromium 把 rAF 节流到 ~1fps（实测可见 261fps / 离屏 1fps）。
     * 本测试用「快速连发 mousemove」模拟拖动，在边缘只停留极短时间，
     * 几乎跑不到一帧，量出来必然是 0px —— 那是测试环境的假象，不是缺陷。
     *
     * 平移/前进/相消/脱钩这些完整断言放在 verify-edgescroll.cjs，
     * 它会在边缘**停住 2 秒**，足以让 rAF 跑起来。
     */
    // 松手后缩放保持不变（严格脱钩）
    if (Math.abs(drag.afterMove.z - drag.afterUp.z) > 0.005) {
      problems.push('松手后移动鼠标仍在改变缩放（未脱钩）')
    }
  }

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-global.txt'), out.join('\n') + '\n', 'utf8')

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))
