/**
 * 验收：快速便签精简形态「默认显示便签内容」+「可按便签标题选显示哪一条」。
 *
 * 用户原话：默认精简界面改为便签内容，并可以通过选择便签标题选择显示的选项。
 *
 * 验收点：
 *   1. 精简组件默认格式是「便签内容」（不是列表、不是计数）
 *   2. 组件里显示的就是当前便签的正文 + 标题页脚
 *   3. 只有一张便签时，「显示哪张」只列两项（当前 / 最近修改），不重复列标题
 *   4. 有多张便签时，候选项**按标题实时生成**（这是本轮 compact.js 的改动：
 *      options 允许写成函数）
 *   5. 选中某个标题后，组件内容真的换成那一张
 *   6. 选「最近修改的」拿到 at 最大的那张（与「当前便签」不是同一张）
 *   7. 选中的那张被删掉后，组件回落到当前便签，且下拉里显示「（已不存在）」
 *      而不是静默跳到第一项（那会让面板显示与实际状态对不上）
 *
 * ⚠ 造数据必须走**插件自己的界面**（新建 / 重命名 / 编辑正文），
 *   不能直接往 localStorage 里写 pl:sticky-notes。
 *   插件注册了 window.addEventListener('beforeunload', save)，
 *   我们写完数据一 reload，iframe 卸载时 save() 又把内存里的旧便签
 *   覆盖回去 —— 数据看着写进去了，插件读到的还是旧的。
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

const CARD_TITLE = '快速便签'

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  win.setSize(1400, 900)
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s) } catch (e) { return { __err: String(e && e.message || e) } } }

  /* 清干净上一次跑残留的数据。三步顺序不能反：
       1) 先离开当前页面（main.cjs 启动时已经加载过一次 dist/index.html），
          这一步会触发便签插件的 beforeunload → save()，把内存里的旧便签写回 localStorage；
       2) 再清 localStorage —— 必须在第 1 步之后，否则又被写回来；
       3) 最后才加载应用，此时插件读到的是空数据，会自建那张欢迎便签。
     直接在页面里 `localStorage.clear()` 然后 reload 是不行的（上一版脚本就栽在这，
     「初始组件」里显示的已经是上一次跑剩下的买菜/会议/灵感）。 */
  await win.loadURL('about:blank')
  await wait(600)
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(2000)

  // 装快速便签
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('插件')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('插件市场')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`(() => {
    document.querySelectorAll('.market-card').forEach(c => {
      if (!c.textContent.includes(${JSON.stringify(CARD_TITLE)})) return;
      const b = [...c.querySelectorAll('button')].find(x => x.textContent.includes('安装'));
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return true;
  })()`)
  await wait(1500)

  // 走正规入口（插件坞点一下）建窗口
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(2500)
  await js(`document.querySelector('.dock-launch').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(900)
  await js(`(() => {
    var it = [...document.querySelectorAll('.dock-item')].find(function (x) {
      return ((x.querySelector('.dock-name') || {}).textContent || '').indexOf(${JSON.stringify(CARD_TITLE)}) === 0;
    });
    if (it) it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!it;
  })()`)
  await wait(3000)

  // 卡片挪到不与其它卡片重叠的位置
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(w => w.id === s.activeWorkspace) || (s.workspaces || [])[0];
    var mine = ws.windows.filter(w => w.pluginId === 'lab.12' && w.visible);
    if (mine[0]) { mine[0].x = 300; mine[0].y = 120; }
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(3500)

  const problems = []

  /** 在便签 iframe 里执行（d = 插件的 document） */
  const note = (expr) => js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var card = cards.find(function (c) {
      return (c.querySelector('.card-head .title') || {}).textContent === ${JSON.stringify(CARD_TITLE)};
    });
    if (!card) return { err: 'no-card' };
    var f = card.querySelector('iframe');
    if (!f || !f.contentDocument) return { err: 'no-doc' };
    var d = f.contentDocument;
    try { return (${expr})(d); } catch (e) { return { err: String(e.message) }; }
  })()`)

  /** 打开宿主的设置面板（精简设置默认展开） */
  const openSettings = async () => {
    await js(`(() => {
      var cards = [...document.querySelectorAll('.plugin-card')];
      var card = cards.find(function (c) { return (c.querySelector('.card-head .title') || {}).textContent === ${JSON.stringify(CARD_TITLE)}; });
      var g = card && card.querySelector('.gear');
      if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return !!g;
    })()`)
    await wait(1400)
  }
  const closeSettings = async () => {
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(700)
  }

  /** 读「显示哪张」下拉：候选项 + 当前值 */
  const readWhich = () => js(`(() => {
    var p = document.querySelector('.settings-panel');
    var box = p && p.querySelector('.cw-settings');
    if (!box) return { err: 'no cw-settings' };
    var row = [...box.querySelectorAll('.cw-opt-row')].find(function (r) {
      var g = r.querySelector('.grow');
      return g && g.textContent.includes('显示哪张');
    });
    if (!row) return { err: 'no which row' };
    var sel = row.querySelector('select');
    if (!sel) return { err: 'no select' };
    return {
      value: sel.value,
      choices: [...sel.options].map(function (o) { return { value: o.value, label: o.textContent }; }),
    };
  })()`)

  /** 改「显示哪张」的值（React 受控 select，要走原生 setter） */
  const setWhich = (v) => js(`(() => {
    var p = document.querySelector('.settings-panel');
    var box = p && p.querySelector('.cw-settings');
    if (!box) return { err: 'no box' };
    var row = [...box.querySelectorAll('.cw-opt-row')].find(function (r) {
      var g = r.querySelector('.grow');
      return g && g.textContent.includes('显示哪张');
    });
    if (!row) return { err: 'no row' };
    var sel = row.querySelector('select');
    var setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, ${JSON.stringify(v)});
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, now: sel.value };
  })()`)

  /** 组件正面显示的正文与页脚 */
  const faceText = () => note(`function (d) {
    var cw = d.querySelector('.cw');
    var q = d.querySelector('.cw-face .q');
    var by = d.querySelector('.cw-face .by');
    return {
      fmt: cw ? cw.getAttribute('data-fmt') : null,
      // 正文现在是 <textarea>：textContent 只是初始内容，输入后不变，
      // 必须读 .value 才能看到用户敲进去的东西
      text: q ? (q.tagName === 'TEXTAREA' ? q.value : q.textContent).trim() : null,
      by: by ? by.textContent.trim() : null,
    };
  }`)

  /* ---------- 1/2/3. 默认格式 + 只有一张便签时的候选项 ---------- */
  const first = await faceText()
  log('初始组件 ' + JSON.stringify(first))
  if (first.err) problems.push(first.err)
  else {
    if (first.fmt !== 'text') problems.push(`精简默认格式应为 text（便签内容），实际 ${first.fmt}`)
    if (!first.text || !first.text.includes('欢迎来到快速便签')) {
      problems.push(`组件里应是当前便签的正文，实际「${first.text}」`)
    }
    if (!first.by || !first.by.includes('便签 1')) {
      problems.push(`页脚应显示便签标题，实际「${first.by}」`)
    }
  }

  await openSettings()
  const only = await readWhich()
  log('一张便签时的候选项 ' + JSON.stringify(only))
  if (only.err) problems.push(only.err)
  else if (only.choices.length !== 2) {
    // 只有一张时不该再把那张的标题列一遍（会与「当前便签」重复）
    problems.push(`只有一张便签时「显示哪张」应只有 2 项，实际 ${only.choices.length} 项：${JSON.stringify(only.choices)}`)
  }
  await closeSettings()

  /* ---------- 用插件自己的界面造三张便签 ---------- */
  /** 激活标题含 title 的标签页 */
  const activate = (title) => note(`function (d) {
    var t = [...d.querySelectorAll('.note-tab')].find(function (b) { return b.textContent.includes(${JSON.stringify(title)}); });
    if (!t) return { err: 'no-tab ' + ${JSON.stringify(title)} };
    t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true };
  }`)
  /** 把当前便签改名 */
  const rename = (title) => note(`function (d) {
    d.querySelector('#rename').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    var inp = d.querySelector('#rename-input');
    var setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value').set;
    setter.call(inp, ${JSON.stringify(title)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    d.querySelector('#rename-ok').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true, now: (d.querySelector('.note-tab.active') || {}).textContent };
  }`)
  /** 把当前便签正文改成 text */
  const setText = (text) => note(`function (d) {
    var ed = d.querySelector('#editor');
    var setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ed), 'value').set;
    setter.call(ed, ${JSON.stringify(text)});
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, now: ed.value.slice(0, 20) };
  }`)
  const newNote = () => note(`function (d) {
    d.querySelector('#new-note').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true, n: d.querySelectorAll('.note-tab').length };
  }`)

  log('改名 1 → 买菜 ' + JSON.stringify(await rename('买菜')))
  log('正文 1 ' + JSON.stringify(await setText('西红柿 2 斤 / 鸡蛋 1 盒')))
  log('新建 ' + JSON.stringify(await newNote()))
  await wait(400)
  log('改名 2 → 会议 ' + JSON.stringify(await rename('会议')))
  log('正文 2 ' + JSON.stringify(await setText('周三 14:00 需求评审')))
  log('新建 ' + JSON.stringify(await newNote()))
  await wait(400)
  log('改名 3 → 灵感 ' + JSON.stringify(await rename('灵感')))
  log('正文 3 ' + JSON.stringify(await setText('给工作台加一面便签墙')))
  await wait(400)
  // 回头碰一下「买菜」让它成为「最近修改的」，再切回「灵感」当当前便签
  log('激活买菜 ' + JSON.stringify(await activate('买菜')))
  await wait(300)
  log('再编辑买菜 ' + JSON.stringify(await setText('西红柿 2 斤 / 鸡蛋 1 盒（已买）')))
  await wait(300)
  log('激活灵感 ' + JSON.stringify(await activate('灵感')))
  await wait(1600)

  /* ---------- 2'. 默认（当前便签）应显示「灵感」 ---------- */
  const active = await faceText()
  log('当前便签 ' + JSON.stringify(active))
  if (active.err) problems.push(active.err)
  else if (!active.text || !active.text.includes('便签墙')) {
    problems.push(`默认应显示当前便签（灵感），实际「${active.text}」`)
  }

  /* ---------- 4. 三张便签时的候选项按标题生成 ---------- */
  await openSettings()
  const three = await readWhich()
  log('三张便签时的候选项 ' + JSON.stringify(three))
  if (three.err) problems.push(three.err)
  const idOf = (t) => {
    const c = (three.choices || []).find((x) => x.label.includes(t))
    return c ? c.value : null
  }
  if (!three.err) {
    const labels = three.choices.map((c) => c.label)
    for (const t of ['买菜', '会议', '灵感']) {
      if (!labels.some((l) => l.includes(t))) {
        problems.push(`「显示哪张」里没有便签标题「${t}」：${JSON.stringify(labels)}`)
      }
    }
    if (three.choices.length !== 5) {
      problems.push(`三张便签时应有 5 项（2 固定 + 3 标题），实际 ${three.choices.length}：${JSON.stringify(labels)}`)
    }
  }

  /* ---------- 5. 选「会议」→ 组件换成它的正文 ---------- */
  const idMeeting = idOf('会议')
  if (!idMeeting) problems.push('拿不到「会议」的候选项值')
  else {
    const pick = await setWhich(idMeeting)
    await wait(2200)
    const shown = await faceText()
    log('选「会议」后 ' + JSON.stringify(pick) + ' → ' + JSON.stringify(shown))
    if (pick.err) problems.push('切换显示哪张失败：' + pick.err)
    else if (!shown.text || !shown.text.includes('需求评审')) {
      problems.push(`选了「会议」后组件应显示它的正文，实际「${shown.text}」`)
    }
  }

  /* ---------- 6. 选「最近修改的」→ 买菜（不是当前便签） ---------- */
  await setWhich('latest')
  await wait(2200)
  const shownLatest = await faceText()
  log('选「最近修改的」后 ' + JSON.stringify(shownLatest))
  if (!shownLatest.text || !shownLatest.text.includes('已买')) {
    problems.push(`选「最近修改的」应显示 at 最大的那张（买菜），实际「${shownLatest.text}」`)
  }
  await closeSettings()

  /* ---------- 7. 选中的那张被删掉 → 回落 + 占位项 ---------- */
  const idIdea = idOf('灵感')
  if (!idIdea) problems.push('拿不到「灵感」的候选项值')
  else {
    await openSettings()
    await setWhich(idIdea)
    await wait(1800)
    await closeSettings()
    // 让「灵感」成为当前便签再删它 —— #del-note 删的是当前便签
    log('激活灵感 ' + JSON.stringify(await activate('灵感')))
    await wait(600)
    log('删除当前便签 ' + JSON.stringify(await note(`function (d) {
      d.querySelector('#del-note').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true, left: d.querySelectorAll('.note-tab').length };
    }`)))
    await wait(1800)

    const fallback = await faceText()
    log('选中的便签被删后 ' + JSON.stringify(fallback))
    if (fallback.err) problems.push(fallback.err)
    else if (!fallback.text || fallback.text === '') {
      problems.push('选中的便签被删掉后组件空着，应回落到当前便签')
    }
    await openSettings()
    const orphan = await readWhich()
    log('被删后的下拉 ' + JSON.stringify(orphan))
    if (orphan.err) problems.push(orphan.err)
    else {
      if (orphan.value !== idIdea) {
        problems.push(`被删的选中值应保留在状态里，实际 ${orphan.value}`)
      }
      if (!orphan.choices.some((c) => c.label.includes('已不存在'))) {
        problems.push(`下拉里应显示「（已不存在）」占位项，实际 ${JSON.stringify(orphan.choices.map((c) => c.label))}`)
      }
    }
    await closeSettings()
  }

  /* ---------- 8. 精简界面就地编辑正文 ---------- */
  const ctrl = await note(`function (d) {
    var ta = d.querySelector('.cw-face textarea.q');
    if (!ta) return { err: 'no-textarea', has: !!d.querySelector('.cw-face .q') };
    return { tag: ta.tagName, hold: ta.hasAttribute('data-cw-hold'), val: ta.value.slice(0, 12) };
  }`)
  log('就地编辑控件 ' + JSON.stringify(ctrl))
  if (ctrl.err) problems.push('精简正文不是可编辑控件：' + JSON.stringify(ctrl))
  else {
    if (ctrl.tag !== 'TEXTAREA') problems.push(`精简正文应是 textarea，实际 ${ctrl.tag}`)
    if (!ctrl.hold) problems.push('精简正文缺 data-cw-hold，每秒刷新会把正在输入的元素换掉（打字会断）')
  }

  /** 在精简界面的正文里打字 */
  const typeInCw = (text) => note(`function (d) {
    var ta = d.querySelector('.cw-face textarea.q');
    if (!ta) return { err: 'no-textarea' };
    ta.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, focused: d.activeElement === ta, val: ta.value };
  }`)

  const TYPED = '在精简界面里直接改的正文'
  log('打字 ' + JSON.stringify(await typeInCw(TYPED)))
  // 组件每秒会 refresh 一次；等两轮，验证打字内容没被重绘冲掉
  await wait(2400)
  const afterType = await note(`function (d) {
    var ta = d.querySelector('.cw-face textarea.q');
    var ed = d.querySelector('#editor');
    return {
      inFace: ta ? ta.value : null,
      stillFocused: d.activeElement === ta,
      inFullWin: ed ? ed.value : null,
    };
  }`)
  log('打字两秒后 ' + JSON.stringify(afterType))
  if (afterType.inFace !== TYPED) {
    problems.push(`打完字 2.4 秒后组件里的内容被重绘冲掉了：期望「${TYPED}」，实际「${afterType.inFace}」`)
  }
  if (!afterType.stillFocused) {
    problems.push('打字过程中焦点丢失（说明重绘没有被 data-cw-hold 挡住）')
  }
  if (afterType.inFullWin !== TYPED) {
    problems.push(`精简界面改的正文没同步到完整窗口：实际「${afterType.inFullWin}」`)
  }

  /* 刷新后仍在（真的存进了便签，不是只改了 DOM） */
  await win.webContents.reload()
  await wait(2200)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(3500)
  const persisted = await faceText()
  log('刷新后组件 ' + JSON.stringify(persisted))
  if (persisted.text !== TYPED) {
    problems.push(`精简界面改的正文没落盘：刷新后期望「${TYPED}」，实际「${persisted.text}」`)
  }

  /* ---------- 9. 精简组件继承便签颜色 ---------- */
  /** 读 .cw 的底色（宿主模式抹了背景，颜色必须靠内联 important 压回去） */
  const cwBg = () => note(`function (d) {
    var cw = d.querySelector('.cw');
    if (!cw) return { err: 'no-cw' };
    // getComputedStyle 挂在 window 上，不在 document 上 —— 这里 d 是 iframe 的
    // contentDocument，写 d.getComputedStyle(...) 会报 "is not a function"。
    var cs = d.defaultView.getComputedStyle(cw);
    return { color: cs.backgroundColor, inline: cw.style.getPropertyValue('background') };
  }`)
  /** 在完整窗口里点色块换颜色（色块在精简模式下被隐藏，但 onclick 仍可触发） */
  const pickColor = (c) => note(`function (d) {
    var b = d.querySelector('#colors .swatch-btn[data-color="' + ${JSON.stringify(c)} + '"]');
    if (!b) return { err: 'no-swatch ' + ${JSON.stringify(c)} };
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true, on: (d.querySelector('.swatch-btn.on') || {}).dataset };
  }`)

  const bgYellow = await cwBg()
  log('当前底色 ' + JSON.stringify(bgYellow))
  const clear = (s) => String(s || '').replace(/\s/g, '')
  if (bgYellow.err) problems.push(bgYellow.err)
  else if (clear(bgYellow.color) === 'rgba(0,0,0,0)' || clear(bgYellow.color) === 'transparent') {
    problems.push(`精简组件没有继承便签颜色（底色是全透明）${JSON.stringify(bgYellow)}`)
  }

  log('换蓝色 ' + JSON.stringify(await pickColor('blue')))
  await wait(2400)
  const bgBlue = await cwBg()
  log('换色后底色 ' + JSON.stringify(bgBlue))
  if (bgBlue.err) problems.push(bgBlue.err)
  else {
    if (clear(bgBlue.color) === clear(bgYellow.color)) {
      problems.push(`完整窗口换了颜色，精简组件没跟着变：都是 ${bgBlue.color}`)
    }
    if (clear(bgBlue.color) === 'rgba(0,0,0,0)') {
      problems.push('换色后精简组件底色变成全透明（内联 important 没压过宿主模式的 background:transparent !important）')
    }
  }

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-sticky.txt'), out.join('\n') + '\n', 'utf8')

  // 截图：组件在真实卡片里的样子（设置面板已 Escape 关闭）
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
    var card = cards.find(function (c) { return (c.querySelector('.card-head .title') || {}).textContent === ${JSON.stringify(CARD_TITLE)}; });
    if (!card) return null;
    var b = card.getBoundingClientRect();
    return { x: Math.max(0, Math.round(b.left) - 6), y: Math.max(0, Math.round(b.top) - 6), width: Math.round(b.width) + 12, height: Math.round(b.height) + 12 };
  })()`)
  if (rect) {
    fs.writeFileSync(path.join(__dirname, '..', 'shots', 'sticky-card.png'), (await win.webContents.capturePage(rect)).toPNG())
  }

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))
