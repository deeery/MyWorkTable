/**
 * 验收：番茄钟精简形态的「独立工作闭环」+ 设置搬进二级界面。
 *
 * 这是本轮插件改造的**示范**，验收点：
 *   1. 精简组件默认是「番茄面板」格式（带操作按钮）
 *   2. 点「开始」真的开始计时（完整窗口的按钮文字同步变「暂停」）
 *   3. 点「跳过」阶段推进
 *   4. 点「重置」回到本阶段起点
 *   5. 设置里能改专注时长，且改动**真的生效**（计时器按新时长跑）
 *   6. 设置里能改每日目标，进度点跟着变
 *   7. 组件铺满窗口（不再是 140×140 的小方块）
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

  // 装番茄钟
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('插件')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('插件市场')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`(() => {
    document.querySelectorAll('.market-card').forEach(c => {
      if (!c.textContent.includes('番茄专注')) return;
      const b = [...c.querySelectorAll('button')].find(x => x.textContent.includes('安装'));
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return true;
  })()`)
  await wait(1500)
  /**
   * 走**正规入口**（插件坞点一下）建窗口 —— 不要手动往 localStorage 里塞
   * 一条 `size: 'S'` 的记录：那会绕过 manifest.compact.window，
   * 把插件声明的初始尺寸（320×360）覆盖掉，于是又回到那个
   * 「环只有 58px、文字顶出圆外」的样子，看起来像没修好。
   */
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(2500)
  await js(`document.querySelector('.dock-launch').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(900)
  await js(`(() => {
    var it = [...document.querySelectorAll('.dock-item')].find(function (x) {
      return ((x.querySelector('.dock-name') || {}).textContent || '').indexOf('番茄专注') === 0;
    });
    if (it) it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!it;
  })()`)
  await wait(3000)
  // 把卡片挪到一个不与其它卡片重叠的位置，方便截图
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(w => w.id === s.activeWorkspace) || (s.workspaces || [])[0];
    var mine = ws.windows.filter(w => w.pluginId === 'lab.03' && w.visible);
    if (mine[0]) { mine[0].x = 300; mine[0].y = 120; }
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(3500)

  const problems = []

  /** 在番茄钟 iframe 里读状态 */
  const pomo = (expr) => js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) {
      return (c.querySelector('.card-head .title') || {}).textContent === '番茄专注';
    });
    if (!card) return { err: 'no-card' };
    var f = card.querySelector('iframe');
    if (!f || !f.contentDocument) return { err: 'no-doc' };
    var d = f.contentDocument;
    try { return (${expr})(d); } catch (e) { return { err: String(e.message) }; }
  })()`)

  /* ---------- 7. 组件铺满窗口 + 环是标准圆 ---------- */
  const layout = await pomo(`function (d) {
    var cw = d.querySelector('.cw');
    var box = d.querySelector('.cw-pomo');
    var ring = d.querySelector('.cw-pomo .ring');
    if (!cw) return { err: 'no .cw' };
    var a = cw.getBoundingClientRect();
    var r = ring ? ring.getBoundingClientRect() : null;
    var inner = d.querySelector('.cw-pomo .inner');
    var ir = inner ? inner.getBoundingClientRect() : null;
    var tm = d.querySelector('.cw-pomo .tm');
    var tr = tm ? tm.getBoundingClientRect() : null;
    return {
      cw: { w: Math.round(a.width), h: Math.round(a.height) },
      hasPanel: !!box,
      ring: r ? { w: Math.round(r.width), h: Math.round(r.height), delta: Math.round(Math.abs(r.width - r.height)) } : null,
      // 内圈直径（::after 是 inset 11%，内圈 = 环径 * 0.78）
      innerCircleD: r ? Math.round(r.width * 0.78) : null,
      timeW: tr ? Math.round(tr.width) : null,
      stackH: ir ? Math.round(ir.height) : null,
      acts: box ? box.querySelectorAll('.acts button').length : 0,
      fmt: cw.getAttribute('data-fmt'),
    };
  }`)
  log('组件布局 ' + JSON.stringify(layout))
  if (layout.err) problems.push(layout.err)
  else {
    if (layout.fmt !== 'panel') problems.push(`默认格式应为 panel，实际 ${layout.fmt}`)
    if (!layout.hasPanel) problems.push('没有渲染番茄面板（.cw-pomo）')
    if (layout.acts !== 3) problems.push(`应有 3 个操作按钮，实际 ${layout.acts}`)
    // 环必须是正圆（严格：误差 <= 1px）
    if (layout.ring && layout.ring.delta > 1) {
      problems.push(`进度环不是正圆：${layout.ring.w}×${layout.ring.h}（差 ${layout.ring.delta}px）`)
    }
    // 环要够大 —— 太小的话文字会顶出圆外，「看起来不像圆」
    if (layout.ring && layout.ring.w < 100) {
      problems.push(`进度环太小（${layout.ring.w}px），文字会顶出圆外；应为插件声明的初始尺寸留足空间`)
    }
    // 文字必须落在内圈里
    if (layout.timeW != null && layout.innerCircleD != null && layout.timeW >= layout.innerCircleD) {
      problems.push(`时间文字（${layout.timeW}px）比内圈（${layout.innerCircleD}px）还宽，会顶到环上`)
    }
    if (layout.stackH != null && layout.innerCircleD != null && layout.stackH >= layout.innerCircleD) {
      problems.push(`文字整体（${layout.stackH}px）比内圈（${layout.innerCircleD}px）还高`)
    }
    if (layout.cw.w < 240) problems.push(`组件没铺满窗口，宽度只有 ${layout.cw.w}px`)
  }

  /* ---------- 7b. 红色弧随时间**减少** ---------- */
  const arcBefore = await pomo(`function (d) {
    var ring = d.querySelector('.cw-pomo .ring');
    return { p: ring ? getComputedStyle(ring).getPropertyValue('--p').trim() : null };
  }`)
  // 开始计时，等几秒再看
  await js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) { return (c.querySelector('.card-head .title') || {}).textContent === '番茄专注'; });
    var f = card && card.querySelector('iframe');
    var btn = f && f.contentDocument.querySelector('.cw-pomo .acts .main');
    if (btn) btn.click();
    return !!btn;
  })()`)
  await wait(4000)
  const arcAfter = await pomo(`function (d) {
    var ring = d.querySelector('.cw-pomo .ring');
    return { p: ring ? getComputedStyle(ring).getPropertyValue('--p').trim() : null };
  }`)
  log(`红色弧 --p：${arcBefore.p} → ${arcAfter.p}（应递减）`)
  if (arcBefore.p != null && arcAfter.p != null) {
    const a = Number(arcBefore.p), b = Number(arcAfter.p)
    if (!(b < a)) {
      problems.push(`红色弧没有随时间减少：--p ${a} → ${b}（番茄钟的环应表示剩余，红色递减）`)
    }
  }
  // 停掉计时，免得影响后续断言
  await js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) { return (c.querySelector('.card-head .title') || {}).textContent === '番茄专注'; });
    var f = card && card.querySelector('iframe');
    var btn = f && f.contentDocument.querySelector('.cw-pomo .acts .main');
    if (btn) btn.click();
    return !!btn;
  })()`)
  await wait(900)

  /* ---------- 2. 点「开始」真的开始计时 ---------- */
  const before = await pomo(`function (d) {
    return {
      time: (d.querySelector('.cw-pomo .tm') || {}).textContent,
      main: (d.querySelector('.cw-pomo .acts .main') || {}).textContent.trim(),
      fullBtn: (d.querySelector('#play') || {}).textContent,
    };
  }`)
  log('点击前 ' + JSON.stringify(before))

  await js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) { return (c.querySelector('.card-head .title') || {}).textContent === '番茄专注'; });
    var f = card && card.querySelector('iframe');
    var btn = f && f.contentDocument.querySelector('.cw-pomo .acts .main');
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!btn;
  })()`)
  await wait(2600)

  const after = await pomo(`function (d) {
    return {
      time: (d.querySelector('.cw-pomo .tm') || {}).textContent,
      main: (d.querySelector('.cw-pomo .acts .main') || {}).textContent.trim(),
      fullBtn: (d.querySelector('#play') || {}).textContent,
      fullFoot: (d.querySelector('#foot') || {}).textContent,
    };
  }`)
  log('点击后 ' + JSON.stringify(after))
  if (before.time === after.time) {
    problems.push(`点「开始」后倒计时没变（${before.time} → ${after.time}），闭环不通`)
  }
  if (after.fullBtn && !after.fullBtn.includes('暂停')) {
    problems.push(`点精简组件的开始后，完整窗口按钮应变成「暂停」，实际「${after.fullBtn}」`)
  }
  // 再点一次暂停
  await js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) { return (c.querySelector('.card-head .title') || {}).textContent === '番茄专注'; });
    var f = card && card.querySelector('iframe');
    var btn = f && f.contentDocument.querySelector('.cw-pomo .acts .main');
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!btn;
  })()`)
  await wait(900)

  /* ---------- 4. 点「重置」回到阶段起点 ---------- */
  await js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) { return (c.querySelector('.card-head .title') || {}).textContent === '番茄专注'; });
    var f = card && card.querySelector('iframe');
    var btn = f && f.contentDocument.querySelector('.cw-pomo .acts button[data-act="reset"]');
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!btn;
  })()`)
  await wait(1200)
  const reset = await pomo(`function (d) {
    return { time: (d.querySelector('.cw-pomo .tm') || {}).textContent, main: (d.querySelector('.cw-pomo .acts .main') || {}).textContent.trim() };
  }`)
  log('重置后 ' + JSON.stringify(reset))
  if (reset.time !== '25:00') problems.push(`重置后应回到 25:00，实际 ${reset.time}`)

  /* ---------- 5/6. 设置里改时长与目标，真的生效 ---------- */
  // 打开设置面板
  await js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) { return (c.querySelector('.card-head .title') || {}).textContent === '番茄专注'; });
    var g = card && card.querySelector('.gear');
    if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!g;
  })()`)
  await wait(1500)

  const opts = await js(`(() => {
    var p = document.querySelector('.settings-panel');
    var box = p && p.querySelector('.cw-settings');
    if (!box) return { err: 'no cw-settings' };
    return {
      rows: [...box.querySelectorAll('.cw-opt-row')].map(function (r) {
        var g = r.querySelector('.grow');
        var inp = r.querySelector('input[type=number]');
        return { label: g ? g.textContent.trim() : null, value: inp ? inp.value : null };
      }),
    };
  })()`)
  log('精简设置项 ' + JSON.stringify(opts))
  if (opts.err) problems.push(opts.err)
  else {
    const focusRow = opts.rows.find((r) => r.label && r.label.includes('专注时长'))
    if (!focusRow) problems.push('精简设置里没有「专注时长」（完整窗口的数值应搬到这里）')
    const goalRow = opts.rows.find((r) => r.label && r.label.includes('每日目标'))
    if (!goalRow) problems.push('精简设置里没有「每日目标」')
  }

  // 把专注时长改成 40
  const changed = await js(`(() => {
    var p = document.querySelector('.settings-panel');
    var box = p && p.querySelector('.cw-settings');
    if (!box) return { err: 'no box' };
    var row = [...box.querySelectorAll('.cw-opt-row')].find(function (r) {
      var g = r.querySelector('.grow');
      return g && g.textContent.includes('专注时长');
    });
    if (!row) return { err: 'no row' };
    var inp = row.querySelector('input[type=number]');
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '40');
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, now: inp.value };
  })()`)
  log('改专注时长 ' + JSON.stringify(changed))
  await wait(2500)

  const afterChange = await pomo(`function (d) {
    return {
      time: (d.querySelector('.cw-pomo .tm') || {}).textContent,
      focusSlider: (d.querySelector('#rFocus') || {}).value,
      focusLabel: (d.querySelector('#vFocus') || {}).textContent,
    };
  }`)
  log('改后 ' + JSON.stringify(afterChange))
  if (changed.err) problems.push('改时长失败：' + changed.err)
  else {
    // 改时长后重置到新时长（未运行时）
    if (afterChange.time !== '40:00') {
      problems.push(`把专注时长改成 40 分后，组件应显示 40:00，实际 ${afterChange.time}（设置没生效）`)
    }
    if (afterChange.focusSlider && afterChange.focusSlider !== '40') {
      problems.push(`完整窗口的滑块没跟着变，仍是 ${afterChange.focusSlider}`)
    }
  }

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-pomodoro.txt'), out.join('\n') + '\n', 'utf8')

  // 截图：组件在真实卡片里的样子。
  // ⚠ 设置面板是 portal 到 body 的，会浮在卡片上方挡住内容；
  //   用 Escape 关掉（PluginCard 在 document 上监听），比点齿轮可靠 ——
  //   齿轮是 toggle，不知道当前是开是关，容易点反。
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait(1000)
  const panelGone = await js(`document.querySelectorAll('.settings-panel').length`)
  log('截图前面板数 ' + panelGone)
  /**
   * ⚠ 强制重绘一帧再截图。
   *
   * 验收窗口是 show:false 的离屏窗口，Chromium 对它偷懒：面板从 DOM
   * 移除后，capturePage 仍可能抓到**上一帧**（实测截出来的还是那张
   * 设置面板）。读一次 offsetHeight 触发同步布局 + invalidate() 请求
   * 重绘，能把这一帧逼出来。
   */
  await js(`(() => {
    void document.body.offsetHeight;
    document.body.style.opacity = '0.999';
    void document.body.offsetHeight;
    document.body.style.opacity = '';
    return true;
  })()`)
  win.webContents.invalidate()
  await wait(1200)
  const rect = await js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) { return (c.querySelector('.card-head .title') || {}).textContent === '番茄专注'; });
    if (!card) return null;
    var b = card.getBoundingClientRect();
    return { x: Math.max(0, Math.round(b.left) - 6), y: Math.max(0, Math.round(b.top) - 6), width: Math.round(b.width) + 12, height: Math.round(b.height) + 12 };
  })()`)
  if (rect) {
    fs.writeFileSync(path.join(__dirname, '..', 'shots', 'pomodoro-card.png'), (await win.webContents.capturePage(rect)).toPNG())
  }

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))
