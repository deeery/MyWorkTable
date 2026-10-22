/**
 * 截图：快速便签的精简形态（供验收）
 *
 * 出五张图：
 *   sticky-1-compact.png   默认精简组件（便签内容 + 标题/时间页脚）
 *   sticky-2-picker.png    精简设置里「显示哪张」的下拉展开态（列出各便签标题）
 *   sticky-3-picked.png    选中「会议」后组件正文真的换掉
 *   sticky-4-edit.png      在精简界面里直接打字（焦点不丢、完整窗口同步）
 *   sticky-5-color.png     精简组件继承完整界面的便签颜色（换色后立刻变）
 *
 * ⚠ 离屏（show:false）窗口 capturePage 会抓到上一帧缓存，
 *   截图前必须强制同步布局 + invalidate()，见 shoot()。
 * ⚠ 设置面板 portal 到 body，会盖在卡片上；拍组件本体前先按 Esc 关掉。
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 240000)
const SHOTS = path.join(__dirname, '..', 'shots')

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  win.setSize(1400, 900)
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s) } catch (e) { return { __err: String(e && e.message || e) } } }

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
      if (!c.textContent.includes('快速便签')) return;
      const b = [...c.querySelectorAll('button')].find(x => x.textContent.includes('安装'));
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return true;
  })()`)
  await wait(1500)

  // 走正规入口建窗口
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(2500)
  await js(`document.querySelector('.dock-launch').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(900)
  await js(`(() => {
    var it = [...document.querySelectorAll('.dock-item')].find(function (x) {
      return ((x.querySelector('.dock-name') || {}).textContent || '').indexOf('快速便签') === 0;
    });
    if (it) it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!it;
  })()`)
  await wait(3000)

  // 卡片挪到左上角，并清掉插件自己的持久化数据（便签内容 + 颜色 + 精简设置），
  // 让每次截图都从同一初始状态出发。
  // ⚠ session.clearStorageData 对本应用的 file:// 源不可靠（跑第二次时上轮的
  //   便签颜色还在），所以这里直接按前缀删 pl: 键，再 reload。
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(w => w.id === s.activeWorkspace) || (s.workspaces || [])[0];
    var mine = ws.windows.filter(w => w.pluginId === 'lab.12' && w.visible);
    if (mine[0]) { mine[0].x = 60; mine[0].y = 40; }
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    Object.keys(localStorage).filter(k => k.startsWith('pl:')).forEach(k => localStorage.removeItem(k));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(3500)

  /** 拍卡片本体（withPanel 时把 portal 到 body 的设置面板一并框进来） */
  const shoot = async (name, withPanel) => {
    // 清掉插件自己的 toast 浮层（「已重命名为「灵感」」这类造数据时的提示）。
    // ⚠ 不能只靠等：离屏（show:false）窗口的渲染进程计时器会被 background
    //   throttling 节流，toast 的 2600ms 被拉得很长，等 3 秒它还在。
    //   toast 在插件 iframe 的 body 里，得进 iframe 删。
    await js(`(() => {
      var card = [...document.querySelectorAll('.plugin-card')].find(function (c) {
        return (c.querySelector('.card-head .title') || {}).textContent === '快速便签';
      });
      var d = card && card.querySelector('iframe') && card.querySelector('iframe').contentDocument;
      if (d) d.querySelectorAll('.toast').forEach(function (t) { t.remove(); });
      return true;
    })()`)
    // 强制同步布局 + 让离屏合成器重绘，否则抓到上一帧
    await js(`(() => { void document.body.offsetHeight; document.body.style.opacity='0.999'; void document.body.offsetHeight; document.body.style.opacity=''; return true; })()`)
    win.webContents.invalidate()
    await wait(1400)
    const r = await js(`(() => {
      var card = [...document.querySelectorAll('.plugin-card')].find(function (c) {
        return (c.querySelector('.card-head .title') || {}).textContent === '快速便签';
      });
      if (!card) return { err: 'no-card' };
      var b = card.getBoundingClientRect();
      var x = b.x, y = b.y, right = b.right, bottom = b.bottom;
      if (${withPanel ? 'true' : 'false'}) {
        // 设置面板 portal 到 body，不在卡片 rect 里，要单独并进来
        var p = document.querySelector('.settings-panel');
        if (p) {
          var pb = p.getBoundingClientRect();
          x = Math.min(x, pb.x); y = Math.min(y, pb.y);
          right = Math.max(right, pb.right); bottom = Math.max(bottom, pb.bottom);
        }
      }
      return {
        x: Math.max(0, x - 10), y: Math.max(0, y - 10),
        width: right - x + 20, height: bottom - y + 20,
      };
    })()`)
    if (r.err) { console.log('❌ ' + name + ' ' + r.err); return }
    const img = await win.webContents.capturePage({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })
    fs.mkdirSync(SHOTS, { recursive: true })
    fs.writeFileSync(path.join(SHOTS, name), img.toPNG())
    console.log('📸 ' + name + '  ' + JSON.stringify(r))
  }

  // 造三张便签（走插件界面）
  const note = (expr) => js(`(() => {
    var card = [...document.querySelectorAll('.plugin-card')].find(function (c) {
      return (c.querySelector('.card-head .title') || {}).textContent === '快速便签';
    });
    if (!card) return { err: 'no-card' };
    var f = card.querySelector('iframe');
    if (!f) return { err: 'no-iframe' };
    var d = f.contentDocument;
    if (!d) return { err: 'no-doc' };
    var $ = function (s) { return d.querySelector(s); };
    return (${expr})($, d);
  })()`)

  const rename = (title, text) => note(`function ($, d) {
    $('#rename').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    var i = $('#rename-input');
    var set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, ${JSON.stringify(title)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    $('#rename-ok').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    var ed = $('#editor');
    var set2 = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    set2.call(ed, ${JSON.stringify(text)});
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    return { title: $('#rename-input').value };
  }`)

  await rename('买菜', '西红柿 2 斤 / 鸡蛋 1 盒')
  await wait(400)
  await note(`function ($, d) { $('#new-note').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }`)
  await wait(600)
  await rename('会议', '周三 14:00 需求评审')
  await wait(400)
  await note(`function ($, d) { $('#new-note').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }`)
  await wait(600)
  await rename('灵感', '给工作台加一面便签墙')
  await wait(400)
  // 切到「灵感」：让当前便签 ≠ 后面要选的「会议」，
  // 否则第 3 张图和第 1 张长得一模一样，看不出「选中后正文真的换了」。
  await note(`function ($, d) {
    var t = [...d.querySelectorAll('.note-tab')].find(x => x.textContent.includes('灵感'));
    if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }`)
  await wait(1500)

  /* 1. 默认精简组件 */
  // ⚠ 造数据时的 toast（「已重命名为「灵感」」）会飘在卡片上，
  //   等它自己消失再拍，否则验收图里挂着一个跟本功能无关的浮层。
  await wait(2600)
  await shoot('sticky-1-compact.png', false)

  /* 2. 打开设置 → 展开「显示哪张」下拉 */
  // ⚠ 不能用 `document.querySelector('.plugin-card .gear')`：那取的是**第一张**
  //   卡片（全新安装时桌面上还有时钟等目录自带插件），齿轮点在了时钟上。
  await js(`(() => {
    var card = [...document.querySelectorAll('.plugin-card')].find(function (c) {
      return (c.querySelector('.card-head .title') || {}).textContent === '快速便签';
    });
    if (!card) return false;
    var g = card.querySelector('.gear');
    if (!g) return false;
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(1400)
  const opened = await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    if (p.length !== 1) return { err: 'want 1 panel, got ' + p.length };
    var has = !!p[0].querySelector('.cw-settings');
    if (!has) {
      var b = p[0].querySelector('.cw-link');
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    return { panel: true, expandedBefore: has };
  })()`)
  console.log('面板 ' + JSON.stringify(opened))
  await wait(1400)
  const dump = await js(`(() => {
    var p = document.querySelector('.settings-panel');
    if (!p) return { err: 'no panel' };
    var link = p.querySelector('.cw-link');
    var box = p.querySelector('.cw-settings');
    return {
      cls: p.className,
      linkText: link ? link.textContent.trim() : null,
      hasCwSettings: !!box,
      secs: box ? [...box.querySelectorAll('.cw-sec-t')].map(x => x.textContent.trim()) : [],
      rows: box ? [...box.querySelectorAll('.cw-opt-row')].map(r => (r.querySelector('.grow') || {}).textContent) : [],
      selects: box ? box.querySelectorAll('select').length : 0,
      hint: p.textContent.includes('正在向插件取') ? 'still-loading' : null,
    };
  })()`)
  console.log('面板内容 ' + JSON.stringify(dump))
  const sel = await js(`(() => {
    var rows = [...document.querySelectorAll('.settings-panel .cw-opt-row')];
    var row = rows.find(r => r.querySelector('.grow').textContent.includes('显示哪张'));
    if (!row) return { err: 'no which row' };
    var s = row.querySelector('select');
    // 展开下拉（Electron 里 select 的展开态截不到，改为把 size 撑开成列表态）
    s.size = Math.min(s.options.length, 6);
    s.style.height = 'auto';
    return { n: s.options.length, labels: [...s.options].map(o => o.textContent) };
  })()`)
  console.log('显示哪张 ' + JSON.stringify(sel))
  await wait(900)
  await shoot('sticky-2-picker.png', true)

  /* 3. 选中「会议」→ 组件正文换掉 */
  await js(`(() => {
    var rows = [...document.querySelectorAll('.settings-panel .cw-opt-row')];
    var row = rows.find(r => r.querySelector('.grow').textContent.includes('显示哪张'));
    if (!row) return false;
    var s = row.querySelector('select');
    var op = [...s.options].find(o => o.textContent.includes('会议'));
    if (!op) return false;
    var set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    set.call(s, op.value);
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`)
  await wait(1200)
  // 关面板再拍组件本体
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait(900)
  const face = await note(`function ($, d) {
    var cw = d.querySelector('.cw');
    var q = d.querySelector('.cw-face .q');
    return {
      fmt: cw && cw.getAttribute('data-fmt'),
      // textarea 读 .value（textContent 是初始内容，输入后不再变）
      text: q ? (q.tagName === 'TEXTAREA' ? q.value : q.textContent) : null,
      by: (d.querySelector('.cw-face .by') || {}).textContent,
    };
  }`)
  console.log('选后组件 ' + JSON.stringify(face))
  await shoot('sticky-3-picked.png', false)

  // 把完整窗口的当前便签也切到「会议」，与组件显示的那张对齐。
  // ⚠ 不对齐的话，后面两节会「看起来坏了」：组件编辑的是「会议」，
  //   而完整窗口的 #editor 和色块操作的是「灵感」—— 两边本来就该不一致。
  await note(`function ($, d) {
    var t = [...d.querySelectorAll('.note-tab')].find(x => x.textContent.includes('会议'));
    if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }`)
  await wait(1200)

  /* 4. 在精简界面里直接打字 */
  // ⚠ textarea 的 textContent 只是初始内容，读当前值必须用 .value
  const typeInCw = (text) => note(`function ($, d) {
    var ta = d.querySelector('.cw-face textarea.q');
    if (!ta) return { err: 'no-textarea' };
    ta.focus();
    var set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return { focused: d.activeElement === ta, val: ta.value };
  }`)
  const typed = await typeInCw('直接在组件里改的正文喵~')
  console.log('精简界面打字 ' + JSON.stringify(typed))
  await wait(2600)   // 跨两轮每秒刷新，验证焦点没被重绘冲掉
  const afterType = await note(`function ($, d) {
    var ta = d.querySelector('.cw-face textarea.q');
    return {
      inFace: ta ? ta.value : null,
      stillFocused: d.activeElement === ta,
      inFullWin: ($('#editor') || {}).value,
    };
  }`)
  console.log('打字两秒后 ' + JSON.stringify(afterType))
  await shoot('sticky-4-edit.png', false)

  /* 5. 继承完整界面的颜色 */
  const cwBg = () => note(`function ($, d) {
    var cw = d.querySelector('.cw');
    if (!cw) return { err: 'no-cw' };
    // getComputedStyle 挂在 window 上，不在 document 上
    return {
      color: d.defaultView.getComputedStyle(cw).backgroundColor,
      inline: cw.style.getPropertyValue('background'),
    };
  }`)
  const pickColor = (c) => note(`function ($, d) {
    // ⚠ 上一节打字后焦点还在 textarea 上，而 data-cw-hold 会让 paint() 跳过重绘
    //   （正是它保护了输入不被打断）—— 于是染底色的 onPaint 也不会跑。
    //   真实使用中点色块本身就会让 textarea 失焦，脚本里得显式 blur。
    if (d.activeElement && d.activeElement.blur) d.activeElement.blur();
    var b = d.querySelector('#colors .swatch-btn[data-color="' + ${JSON.stringify(c)} + '"]');
    if (!b) return { err: 'no-swatch' };
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true };
  }`)
  const before = await cwBg()
  console.log('当前底色 ' + JSON.stringify(before))
  // ⚠ 不能写死点蓝色：便签颜色存在 pl:sticky-notes 里，可能已是蓝的，
  //   再点一次当然「没变化」，看上去像功能坏了。挑一个与当前不同的颜色。
  const want = String(before.inline || '').includes('#bfdbfe') ? 'pink' : 'blue'
  await pickColor(want)
  await wait(1400)
  const after = await cwBg()
  console.log('换成' + want + '后 ' + JSON.stringify(after))
  console.log(after.inline !== before.inline ? '  ✓ 底色已跟随完整界面的颜色变化' : '  ❌ 底色没变')
  await shoot('sticky-5-color.png', false)

  clearTimeout(HARD)
  app.exit(0)
}, 1200))
