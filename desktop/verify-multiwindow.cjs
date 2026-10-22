/**
 * 验收：同一个插件可以创建多个窗口。
 *
 * 需求：「我希望能给同一个插件创建多个窗口」
 * 已确认：每个窗口独立设置；✕ 只关这一个窗口。
 *
 * 检查链路：
 *   1. 数据模型：workspace.windows 是数组，同一 pluginId 可出现多次
 *   2. 从插件坞连点两次同一个插件 → 桌面出现 2 张卡片（不是 1 张）
 *   3. 两张卡片有**不同的窗口 id**，React key 不冲突
 *   4. 位置各自独立：拖开一个，另一个不动
 *   5. 尺寸各自独立
 *   6. 设置各自独立：改 A 的配置，B 不变
 *   7. 卡片头显示序号 #2（多窗口时才出现）
 *   8. 关掉其中一个 → 只剩 1 张；另一个仍在
 *   9. 卸载插件 → 该插件的**全部**窗口一并消失
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

  const problems = []

  /* ---------- 准备：空工作台 ---------- */
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    s.workspaces = [{ id: 'ws-a', name: '默认工作台', windows: [] }];
    s.activeWorkspace = 'ws-a';
    // 每个已安装插件补一个不可见窗口（与 AppContext.addWorkspace 一致）
    (s.installed || []).forEach(function (p) {
      s.workspaces[0].windows.push({
        id: 'w-' + p.manifest.id,
        pluginId: p.manifest.id,
        visible: false,
        size: p.manifest.defaultSize || 'M',
      });
    });
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(3000)

  /** 读窗口层数据 */
  const wsSnap = () => js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(function (w) { return w.id === s.activeWorkspace; });
    var wins = ws ? ws.windows : [];
    var vis = wins.filter(function (w) { return w.visible; });
    return {
      total: wins.length,
      visible: vis.length,
      cards: document.querySelectorAll('.plugin-card').length,
      byPlugin: vis.reduce(function (a, w) { a[w.pluginId] = (a[w.pluginId] || 0) + 1; return a; }, {}),
    };
  })()`)

  const empty = await wsSnap()
  log('初始 ' + JSON.stringify(empty))
  if (empty.cards !== 0) problems.push(`准备阶段桌面应为空，实际 ${empty.cards} 张`)

  /* ---------- 2. 从插件坞连点两次同一个插件 ---------- */
  const TARGET = 'lab.07'   // 倒数日（有 settings，便于验配置独立）

  /**
   * ⚠ 直接给 input.value 赋值再派发 input 事件对 React 无效 ——
   * React 的受控组件走的是自己的 value tracker，绕过 setter 赋值不会
   * 触发 onChange（实测搜索词没生效，点到了列表第一条「倒数日」而不是
   * 想搜的「世界时钟」）。这里改用 nativeInputValueSetter 强制同步。
   */
  const setSearch = (text) => js(`(() => {
    var inp = document.querySelector('.dock-search input');
    if (!inp) return false;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, ${JSON.stringify(text)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)

  /** 按插件名找坞里那一项并点它 */
  const clickDockItem = (name) => js(`(() => {
    var items = [...document.querySelectorAll('.dock-item')];
    var it = items.find(function (x) {
      var n = (x.querySelector('.dock-name') || {}).textContent || '';
      return n.indexOf(${JSON.stringify(name)}) === 0;
    });
    if (!it) return { err: 'not-found', have: items.map(function (x) { return (x.querySelector('.dock-name') || {}).textContent; }) };
    it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true };
  })()`)

  const openDock = () => js(`(() => {
    var b = document.querySelector('.dock-launch');
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)

  for (let k = 0; k < 2; k++) {
    await openDock()
    await wait(700)
    await setSearch('倒数日')
    await wait(600)
    const r = await clickDockItem('倒数日')
    if (r && r.err) { problems.push('坞里找不到「倒数日」：' + JSON.stringify(r.have)); break }
    await wait(1800)
  }
  // 收起坞
  await js(`(() => { var b = document.querySelector('.dock-x'); if (b) b.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; })()`)
  await wait(800)

  const two = await wsSnap()
  log('连点两次后 ' + JSON.stringify(two))
  if (two.cards !== 2) {
    problems.push(`连点两次应出现 2 张卡片，实际 ${two.cards}`)
  }
  if (two.byPlugin[TARGET] !== 2) {
    problems.push(`世界时钟应有 2 个窗口，实际 ${two.byPlugin[TARGET] || 0}`)
  }

  /* ---------- 3. 两张卡片的窗口 id 不同 ---------- */
  const ids = await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(function (w) { return w.id === s.activeWorkspace; });
    var mine = ws.windows.filter(function (w) { return w.pluginId === '${TARGET}' && w.visible; });
    return {
      ids: mine.map(function (w) { return w.id; }),
      unique: new Set(mine.map(function (w) { return w.id; })).size,
      positions: mine.map(function (w) { return (w.x || 0) + ',' + (w.y || 0); }),
      cards: document.querySelectorAll('.plugin-card').length,
    };
  })()`)
  log('两个窗口 ' + JSON.stringify(ids))
  if (ids.ids.length !== 2) problems.push(`应有 2 个窗口记录，实际 ${ids.ids.length}`)
  if (ids.unique !== 2) problems.push('两个窗口的 id 重复（React key 会冲突，只渲染一张）')
  if (ids.cards !== 2) problems.push(`DOM 里应有 2 张卡片，实际 ${ids.cards}`)
  // 位置应错开（否则两张完全重叠，用户以为只开了一个）
  if (ids.positions[0] === ids.positions[1]) {
    problems.push(`两个窗口坐标相同（${ids.positions[0]}），会完全重叠`)
  }

  /* ---------- 4. 序号徽标：第一个不带（=#1），第二个带 #2 ---------- */
  const ordinals = await js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    return cards.map(function (c) {
      var o = c.querySelector('.win-ordinal');
      return { title: (c.querySelector('.card-head .title') || {}).textContent, ordinal: o ? o.textContent : null };
    });
  })()`)
  log('卡片头 ' + JSON.stringify(ordinals))
  // 序号从 #1 起算，但 #1 不显示徽标（单窗口时也不该显示），
  // 所以两张卡片里应恰好一个 ordinal 为 null、一个为 '#2'
  const withTwo = ordinals.filter((x) => x.ordinal === '#2')
  const withNull = ordinals.filter((x) => x.ordinal === null)
  if (withTwo.length !== 1) {
    problems.push(`应恰好有 1 张卡片带 #2 序号，实际 ${withTwo.length}（${JSON.stringify(ordinals)}）`)
  }
  if (withNull.length !== 1) {
    problems.push(`应恰好有 1 张卡片不带序号（=#1），实际 ${withNull.length}`)
  }

  /* ---------- 5. 位置独立：拖开一个，另一个不动 ---------- */
  const beforeMove = await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(function (w) { return w.id === s.activeWorkspace; });
    return ws.windows.filter(function (w) { return w.pluginId === '${TARGET}' && w.visible; })
      .map(function (w) { return { id: w.id, x: w.x, y: w.y }; });
  })()`)
  // 直接改第一个窗口的坐标（模拟拖拽结束后的 setPosition）
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(function (w) { return w.id === s.activeWorkspace; });
    var mine = ws.windows.filter(function (w) { return w.pluginId === '${TARGET}' && w.visible; });
    if (mine[0]) { mine[0].x = 1234; mine[0].y = 567; }
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(2500)
  const afterMove = await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(function (w) { return w.id === s.activeWorkspace; });
    return ws.windows.filter(function (w) { return w.pluginId === '${TARGET}' && w.visible; })
      .map(function (w) { return { id: w.id, x: w.x, y: w.y }; });
  })()`)
  log('移动前后 ' + JSON.stringify({ before: beforeMove, after: afterMove }))
  if (afterMove.length === 2) {
    const moved = afterMove.filter((w) => w.x === 1234 && w.y === 567)
    const stayed = afterMove.filter((w) => w.x !== 1234 || w.y !== 567)
    if (moved.length !== 1) problems.push('改动只应影响 1 个窗口的位置')
    if (stayed.length !== 1) problems.push('另一个窗口的位置被连带动了（位置未隔离）')
  }

  /* ---------- 6. 关掉其中一个 → 另一个仍在 ---------- */
  await js(`(() => {
    var cards = [...document.querySelectorAll('.plugin-card')];
    var target = cards.find(function (c) { return c.querySelector('.win-ordinal'); }) || cards[0];
    var x = target.querySelector('.card-close');
    if (x) x.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(1800)
  const afterClose = await wsSnap()
  log('关掉一个后 ' + JSON.stringify(afterClose))
  if (afterClose.cards !== 1) {
    problems.push(`关掉一个后应剩 1 张卡片，实际 ${afterClose.cards}`)
  }
  if ((afterClose.byPlugin[TARGET] || 0) !== 1) {
    problems.push(`关掉一个后世界时钟应剩 1 个窗口，实际 ${afterClose.byPlugin[TARGET] || 0}`)
  }
  // 插件本身必须还在（✕ 关的是窗口，不是插件）
  const stillInstalled = await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    return (s.installed || []).some(function (p) { return p.manifest.id === '${TARGET}'; });
  })()`)
  log('插件仍在已安装列表 ' + stillInstalled)
  if (!stillInstalled) problems.push('✕ 把插件也卸载了（应只关窗口）')

  /* ---------- 7. 卸载插件 → 全部窗口消失 ---------- */
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    s.installed = (s.installed || []).filter(function (p) { return p.manifest.id !== '${TARGET}'; });
    (s.workspaces || []).forEach(function (w) {
      w.windows = w.windows.filter(function (x) { return x.pluginId !== '${TARGET}'; });
    });
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(2500)
  const afterUninstall = await wsSnap()
  log('卸载后 ' + JSON.stringify(afterUninstall))
  if (afterUninstall.byPlugin[TARGET]) {
    problems.push(`卸载后仍残留 ${afterUninstall.byPlugin[TARGET]} 个窗口`)
  }
  // 卸载的只是目标插件；其他插件的窗口本就都是 visible:false，桌面上不该有卡片
  if (afterUninstall.cards !== 0) {
    problems.push(`卸载目标插件后桌面应为空，实际 ${afterUninstall.cards} 张`)
  }

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-multiwindow.txt'), out.join('\n') + '\n', 'utf8')

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))
