/**
 * 验收：贴边滚动（拖动时）
 *
 * 需求（用户原话）：「工作台移动的太快了，而且窗口没有移动」
 *
 * 正确的行为是**两半同时做**：
 *   1. 卡片在画布坐标里前进（窗口跟着鼠标走）
 *   2. 画布反向平移（让卡片视觉上停在鼠标下，新区域露出来）
 * 两者相消 → 卡片稳稳待在鼠标下，而工作台在滚动。
 *
 * 检查链路：
 *   a. 拖动贴边时，**画布**确实在平移
 *   b. 同时**卡片在屏幕上的位置**基本不动（不飞走）
 *   c. 但卡片的**画布坐标**在前进（这才是「窗口移动了」）
 *   d. 速度合理：不是按 mousemove 次数推（那样会 1000+ px/s）
 *   e. 松手后一切停住（严格脱钩）
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
  await js(`localStorage.clear(); true`)
  await win.webContents.reload()
  await wait(2000)

  // 装倒数日并放到桌面中央
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
    mine[0].visible = true; mine[0].x = 600; mine[0].y = 400;
    delete mine[0].w; delete mine[0].h;
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(3500)

  const problems = []

  /** 读画布 transform + 卡片屏幕位置 + 卡片画布坐标 */
  const snap = () => js(`(() => {
    var c = document.querySelector('.desktop-canvas');
    var t = c ? (getComputedStyle(c).transform || 'none') : 'none';
    var z = 1, tx = 0, ty = 0;
    if (t !== 'none') {
      var m = t.match(/matrix\\(([^)]+)\\)/);
      if (m) { var p = m[1].split(',').map(function (v) { return Number(v.trim()); }); z = p[0] || 1; tx = p[4] || 0; ty = p[5] || 0; }
    }
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (x) { return (x.querySelector('.card-head .title') || {}).textContent === '倒数日'; });
    if (!card) return { err: 'no-card' };
    var r = card.getBoundingClientRect();
    return {
      zoom: Number(z.toFixed(4)),
      pan: { x: Math.round(tx), y: Math.round(ty) },
      // 卡片在**屏幕**上的位置（视觉）
      screen: { x: Math.round(r.left), y: Math.round(r.top) },
      // 卡片在**画布**里的坐标（inline style 的 left/top）
      canvas: (function () {
        var st = card.getAttribute('style') || '';
        return {
          x: Math.round(Number((st.match(/left:\\s*([-\\d.]+)px/) || [])[1] || 0)),
          y: Math.round(Number((st.match(/top:\\s*([-\\d.]+)px/) || [])[1] || 0)),
        };
      })(),
    };
  })()`)

  const before = await snap()
  log('拖动前 ' + JSON.stringify(before))
  if (before.err) { problems.push(before.err); }

  /* ---------- 模拟拖动：按住标题栏，把鼠标推到视口右下角并停住 ---------- */
  const result = await js(`(async () => {
    var snap = function () {
      var c = document.querySelector('.desktop-canvas');
      var t = c ? (getComputedStyle(c).transform || 'none') : 'none';
      var z = 1, tx = 0, ty = 0;
      if (t !== 'none') {
        var m = t.match(/matrix\\(([^)]+)\\)/);
        if (m) { var p = m[1].split(',').map(function (v) { return Number(v.trim()); }); z = p[0] || 1; tx = p[4] || 0; ty = p[5] || 0; }
      }
      var cards = [...document.querySelectorAll('.plugin-card')];
      var card = cards.find(function (x) { return (x.querySelector('.card-head .title') || {}).textContent === '倒数日'; });
      if (!card) return null;
      var r = card.getBoundingClientRect();
      var st = card.getAttribute('style') || '';
      return {
        zoom: Number(z.toFixed(4)),
        pan: { x: Math.round(tx), y: Math.round(ty) },
        screen: { x: Math.round(r.left), y: Math.round(r.top) },
        canvas: {
          x: Math.round(Number((st.match(/left:\\s*([-\\d.]+)px/) || [])[1] || 0)),
          y: Math.round(Number((st.match(/top:\\s*([-\\d.]+)px/) || [])[1] || 0)),
        },
      };
    };
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (x) { return (x.querySelector('.card-head .title') || {}).textContent === '倒数日'; });
    if (!card) return { err: 'no-card' };
    var head = card.querySelector('.card-head');
    var r = head.getBoundingClientRect();
    var sx = Math.round(r.left + r.width / 2), sy = Math.round(r.top + r.height / 2);
    head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: sx, clientY: sy, button: 0 }));
    await new Promise(function (res) { setTimeout(res, 200); });
    var start = snap();
    var vw = window.innerWidth, vh = window.innerHeight;
    /**
     * 先把鼠标移到右下角贴边处（这一步卡片跟着鼠标走是**正常**的），
     * 再**停住不动** 2 秒 —— 这才是检验贴边滚动的关键：
     * 鼠标不动时，卡片应该继续前进（画布坐标增加）而屏幕位置不动。
     */
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: vw - 8, clientY: vh - 8 }));
    await new Promise(function (res) { setTimeout(res, 400); });
    // 此刻鼠标已在边缘，记下基准
    var atEdgeStart = snap();
    // 停住 2 秒不动，让贴边滚动跑
    await new Promise(function (res) { setTimeout(res, 2000); });
    var atEdge = snap();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: vw - 8, clientY: vh - 8 }));
    await new Promise(function (res) { setTimeout(res, 900); });
    var afterUp = snap();
    // 松手后再动鼠标，不该再有任何变化
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: vw / 2, clientY: vh / 2 }));
    await new Promise(function (res) { setTimeout(res, 600); });
    var afterMove = snap();
    return { start: start, atEdgeStart: atEdgeStart, atEdge: atEdge, afterUp: afterUp, afterMove: afterMove, vw: vw, vh: vh };
  })()`)

  log('拖动过程 ' + JSON.stringify(result, null, 1))

  if (result && result.err) {
    problems.push('拖动模拟失败：' + result.err)
  } else if (result) {
    // 用「鼠标停住之后」的那一段做基准 —— 那才是贴边滚动的净效果
    const s = result.atEdgeStart, e = result.atEdge

    /* a. 画布必须平移（世界在滚动） */
    const panMoved = Math.abs(e.pan.x - s.pan.x) + Math.abs(e.pan.y - s.pan.y)
    log(`鼠标停住 2 秒内：画布平移 ${panMoved}px`)
    if (panMoved < 20) {
      problems.push(`鼠标停住后画布几乎没平移（${panMoved}px）—— 世界没有滚动`)
    }

    /* b. 卡片在屏幕上的位置应基本不动（待在鼠标下） */
    const screenMoved = Math.abs(e.screen.x - s.screen.x) + Math.abs(e.screen.y - s.screen.y)
    log(`卡片屏幕位移 ${screenMoved}px（应很小 —— 卡片要待在鼠标下）`)
    if (screenMoved > 40) {
      problems.push(`鼠标不动时卡片在屏幕上还跑了 ${screenMoved}px —— 应该基本不动`)
    }

    /* c. 卡片的画布坐标必须在前进（这才是「窗口移动了」） */
    const canvasMoved = Math.abs(e.canvas.x - s.canvas.x) + Math.abs(e.canvas.y - s.canvas.y)
    log(`卡片画布坐标前进 ${canvasMoved}px`)
    if (canvasMoved < 20) {
      problems.push(`卡片的画布坐标没前进（${canvasMoved}px）—— 窗口没有真正移动`)
    }

    /* d. 两者应大致相消：画布前进量 ≈ 画布反向平移量 */
    if (canvasMoved > 20 && panMoved > 20) {
      const ratio = canvasMoved / panMoved
      log(`前进/平移 比值 ${ratio.toFixed(2)}（应接近 1.00 —— 两者相消卡片才不动）`)
      if (ratio < 0.6 || ratio > 1.7) {
        problems.push(`卡片前进量（${canvasMoved}px）与画布平移量（${panMoved}px）不匹配（比值 ${ratio.toFixed(2)}）—— 两半没配合好`)
      }
    }

    /* e. 速度合理：不该失控（按 mousemove 次数推会 1000+ px/s） */
    //
    // ⚠ 这里只断言「不太快」。**不能**断言「够快」：验收窗口是
    //   show:false 的离屏窗口，Chromium 会把 rAF 节流到 ~1fps
    //   （实测可见时 261fps、离屏 1fps），贴边滚动靠 rAF 推进，
    //   于是测试里量到的速度只有真实值的几十分之一。
    //   速度是否合适只能在真实窗口里肉眼确认。
    const speed = canvasMoved / 2
    log(`估算速度 ${Math.round(speed)} px/s（离屏 rAF 被节流，真实值更高）`)
    if (speed > 1500) {
      problems.push(`滚动太快（${Math.round(speed)} px/s）—— 应按时间算而不是按 mousemove 次数`)
    }
    // 只要能看出在动就行，阈值给很低以兼容 rAF 节流
    if (speed < 5) {
      problems.push(`贴边滚动几乎没动（${Math.round(speed)} px/s）`)
    }

    /* f. 缩放不该被改 */
    if (Math.abs(e.zoom - s.zoom) > 0.005) {
      problems.push(`拖动时缩放被改了（${s.zoom} → ${e.zoom}）`)
    }

    /* g. 松手后严格停住 */
    const afterMoved = Math.abs(result.afterMove.pan.x - result.afterUp.pan.x)
      + Math.abs(result.afterMove.pan.y - result.afterUp.pan.y)
    log(`松手后画布又动了 ${afterMoved}px（应 0）`)
    if (afterMoved > 3) {
      problems.push(`松手后画布仍在平移（${afterMoved}px）—— 未脱钩`)
    }
  }

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-edgescroll.txt'), out.join('\n') + '\n', 'utf8')

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))
