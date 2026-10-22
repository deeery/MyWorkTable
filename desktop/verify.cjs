/**
 * 综合验收：面板锚定、点击母界面关闭、右键菜单 IPC
 *
 * 复用 desktop/main.cjs 的真实主进程逻辑（含 ipcMain 的右键菜单处理器），
 * 只在测试期间拦截 Menu.popup 以统计菜单是否真的被弹出。
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow, Menu } = require('electron')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let contextMenuCalls = 0
let lastMenuLabels = []

// 拦截原生菜单弹出：既统计调用次数，也记录菜单项文案
const origPopup = Menu.prototype.popup
Menu.prototype.popup = function (...a) {
  contextMenuCalls++
  try { lastMenuLabels = this.items.map((i) => i.label || i.type) } catch { /* ignore */ }
  // 测试环境不真正弹出（无头环境弹窗会阻塞），仅记录
  return undefined
}

// 载入真实主进程：它会注册 ipcMain 处理器、构建应用菜单并创建窗口
require('./main.cjs')

async function run() {
  // 等主进程把窗口建好
  let win = null
  for (let i = 0; i < 50 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] ?? null
    if (!win) await wait(100)
  }
  if (!win) throw new Error('主进程未创建窗口')

  // 主进程可能还在加载 dev server；这里统一改用本地 dist 以保证可复现
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'))
  await wait(1200)
  await win.webContents.executeJavaScript(`localStorage.clear(); true`)
  await win.webContents.reload()
  await wait(1800)

  const click = (js) => win.webContents.executeJavaScript(js)
  const results = {}

  /* ---------- 1. 打开便签设置面板并测锚定 ---------- */
  await click(`(() => {
    const cards = [...document.querySelectorAll('.plugin-card')];
    const notes = cards.find(c => (c.querySelector('.card-head .title')||{}).textContent === '便签');
    notes.querySelector('.gear').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(700)

  results.anchor = await click(`(() => {
    const panel = document.querySelector('.settings-panel');
    // 必须与被点击的那张卡片的齿轮比较（用第一张会得到错误结论）
    const cards = [...document.querySelectorAll('.plugin-card')];
    const notes = cards.find(c => (c.querySelector('.card-head .title')||{}).textContent === '便签');
    const gear = notes.querySelector('.gear');
    const pb = panel.getBoundingClientRect();
    const gb = gear.getBoundingClientRect();
    return {
      innerW: window.innerWidth, innerH: window.innerHeight,
      gear: { x: Math.round(gb.x), y: Math.round(gb.y), r: Math.round(gb.right), b: Math.round(gb.bottom) },
      panel: { x: Math.round(pb.x), y: Math.round(pb.y), r: Math.round(pb.right), b: Math.round(pb.bottom), w: Math.round(pb.width) },
      // 面板右缘应贴合齿轮右缘（右对齐）
      rightGap: Math.round(Math.abs(pb.right - gb.right)),
      // 面板应在齿轮下方；下方空间不足时允许向上翻转（此时底边贴齿轮上方）
      belowGear: pb.top >= gb.bottom,
      flippedUp: pb.bottom <= gb.top,
      opacity: getComputedStyle(panel).opacity,
      pairCount: document.querySelectorAll('.palette-pair').length,
    };
  })()`)

  /* ---------- 2. 点击母界面（卡片内容区）应关闭面板 ---------- */
  results.closeByParent = await click(`(() => {
    const panel = document.querySelector('.settings-panel');
    if (!panel) return 'no-panel';
    // 模拟点击卡片内容区：命中 .settings-shield
    const shield = document.querySelector('.settings-shield');
    if (!shield) return 'no-shield';
    shield.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return 'clicked';
  })()`)
  await wait(400)
  results.closedAfterParentClick = await click(`!document.querySelector('.settings-panel')`)

  /* ---------- 3. 重新打开后点色块，应同时写入 bg 与 fg ---------- */
  await click(`(() => {
    const cards = [...document.querySelectorAll('.plugin-card')];
    const notes = cards.find(c => (c.querySelector('.card-head .title')||{}).textContent === '便签');
    notes.querySelector('.gear').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(600)
  // 点第 6 个配色对（珊瑚 #ffcdd2 -> #8e2b30）
  await click(`(() => {
    const pairs = [...document.querySelectorAll('.palette-pair')];
    pairs[5].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(700)
  results.pairApplied = await click(`(() => {
    const saved = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    const ws = (saved.workspaces || []).find(w => w.id === saved.activeWorkspace) || (saved.workspaces || [])[0];
    const noteWin = ((ws && ws.windows) || []).find(w => w.pluginId === 'workbench.notes');
    const panel = document.querySelector('.settings-panel');
    const active = panel ? panel.querySelector('.palette-pair.active') : null;
    return {
      config: noteWin ? noteWin.config : null,
      activeIndex: active ? [...panel.querySelectorAll('.palette-pair')].indexOf(active) : -1,
    };
  })()`)

  /* ---------- 4. 顶栏布局：↧ 收起 / ⚙ 设置 / ✕ 最右上角 ---------- */
  // 先关掉设置面板，避免遮挡
  await click(`document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
  await wait(400)
  results.header = await click(`(() => {
    const head = document.querySelector('.plugin-card .card-head');
    const close = head.querySelector('.card-close');
    const kids = [...head.children];
    // 图标已由字符（↧ ✕）改为 SVG，textContent 恒为空串 —— 认图标要看 title。
    const label = (el) => {
      const t = (el.getAttribute('title') || '').trim();
      if (t.includes('收起顶部栏')) return '↧';
      if (t.includes('关闭')) return '✕';
      if ((el.className||'').toString().includes('gear')) return 'gear';
      if (el.tagName === 'BUTTON') return el.querySelector('svg') ? (t || 'svg') : el.textContent.trim();
      return (el.className||'').toString();
    };
    return {
      order: kids.map(label),
      closeIsLast: kids[kids.length-1] === close,
      gapFromRight: Math.round(head.getBoundingClientRect().right - close.getBoundingClientRect().right),
      hasRefreshInHead: [...head.querySelectorAll('button')].some(b => (b.getAttribute('title')||'').includes('刷新')),
    };
  })()`)

  /* ---------- 5. 刷新已移入设置菜单；便签常驻字号按钮已隐去 ---------- */
  await click(`document.querySelector('.plugin-card .gear').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(700)
  results.settingsMenuButtons = await click(`
    [...document.querySelectorAll('.settings-panel .btn-row button')].map(b => b.textContent.trim())
  `)
  results.notesToolbar = await click(`(() => {
    const cards = [...document.querySelectorAll('.plugin-card')];
    const notes = cards.find(c => (c.querySelector('.card-head .title')||{}).textContent === '便签');
    const tb = notes && notes.querySelector('.notes-toolbar');
    return tb ? tb.querySelectorAll('button').length : null;
  })()`)
  await click(`document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
  await wait(400)

  /* ---------- 6. 收起顶部栏 → 仅右上角 ↥ ---------- */
  await click(`(() => {
    const card = document.querySelector('.plugin-card');
    const btn = [...card.querySelectorAll('.card-head button')].find(b => (b.getAttribute('title')||'').includes('收起'));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(600)
  results.collapsed = await click(`(() => {
    const card = document.querySelector('.plugin-card');
    const ex = card.querySelector('.card-expand');
    const b = ex && ex.getBoundingClientRect(), c = card.getBoundingClientRect();
    return {
      // 收起态故意留一条透明拖拽带（.card-head-ghost，绝对定位、不占流），
    // 让收起的卡片仍可拖动 —— 只要求「不留可见的顶栏控件」。
    headGone: !card.querySelector('.card-head:not(.card-head-ghost)'),
      expandText: ex ? (ex.querySelector('svg') ? '↥' : ex.textContent.trim()) : null,
      atTopRight: ex ? (Math.round(b.top - c.top) < 12 && Math.round(c.right - b.right) < 12) : false,
      leftover: card.querySelectorAll('.card-head button, .gear').length,
    };
  })()`)
  await click(`document.querySelector('.card-expand').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  results.expandRestored = await click(`!!document.querySelector('.plugin-card .card-head')`)

  /* ---------- 7. 侧边栏三形态 + 隐藏时按钮仍可见 ---------- */
  // 先归位到「详细」，避免前序步骤（或持久化状态）影响起点
  await click(`(() => {
    const s = JSON.parse(localStorage.getItem('workbench:state:v1')||'{}');
    s.settings = { ...(s.settings||{}), sidebarMode: 'detailed', displayScale: 1 };
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(1600)

  const sidebarState = () => click(`(() => {
    const sb = document.querySelector('.sidebar');
    return {
      mode: sb ? (sb.classList.contains('mini') ? 'mini' : 'detailed') : 'hidden',
      // 用计算样式宽度而非 rect：rect 会随显示比例缩放，不利于跨用例比较
      width: sb ? Math.round(parseFloat(getComputedStyle(sb).width)) : 0,
      toggleVisible: !!document.querySelector('.sidebar-toggle'),
    };
  })()`)
  const toggle = () => click(`document.querySelector('.sidebar-toggle').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  // 侧边栏宽度有 0.18s 过渡，必须等动画结束再测，否则会读到中间值
  const SETTLE = 900

  results.sidebar = []
  results.sidebar.push(await sidebarState())      // detailed
  await toggle(); await wait(SETTLE)
  results.sidebar.push(await sidebarState())      // mini
  await toggle(); await wait(SETTLE)
  results.sidebar.push(await sidebarState())      // hidden
  await toggle(); await wait(SETTLE)
  results.sidebar.push(await sidebarState())      // 回到 detailed

  /* ---------- 9. 左侧边缘调宽（右边固定） ---------- */
  await click(`document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
  await wait(300)
  const before9 = await click(`(() => {
    const c = document.querySelector('.plugin-card');
    const r = c.getBoundingClientRect();
    // 画布坐标才是真值：卡片用 inline left/width（画布 px）定位，不随显示缩放漂移。
    // 屏幕 rect 在改尺寸期间会被 Desktop 的自适应缩放带偏，不能当「右缘固定」的判据。
    const cx = Math.round(parseFloat(c.style.left) || 0);
    const cw = Math.round(parseFloat(c.style.width) || 0);
    const chh = Math.round(parseFloat(c.style.height) || r.height);
    return {
      x: Math.round(r.x), w: Math.round(r.width), r: Math.round(r.right), h: Math.round(r.height),
      cx, cw, ch: chh, cr: cx + cw,
    };
  })()`)
  // 从左侧手柄向左拖 60px：宽度 +60，右缘不动，x -60
  await click(`(() => {
    const c = document.querySelector('.plugin-card');
    const h = c.querySelector('.resize-edge.resize-w');
    const b = h.getBoundingClientRect();
    window.__drag = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    h.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, buttons: 1, clientX: window.__drag.x, clientY: window.__drag.y,
    }));
    return true;
  })()`)
  await wait(150)
  await click(`(() => {
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, buttons: 1, clientX: window.__drag.x - 60, clientY: window.__drag.y,
    }));
    return true;
  })()`)
  await wait(150)
  await click(`document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))`)
  await wait(400)
  const after9 = await click(`(() => {
    const c = document.querySelector('.plugin-card');
    const r = c.getBoundingClientRect();
    // 画布坐标才是真值：卡片用 inline left/width（画布 px）定位，不随显示缩放漂移。
    // 屏幕 rect 在改尺寸期间会被 Desktop 的自适应缩放带偏，不能当「右缘固定」的判据。
    const cx = Math.round(parseFloat(c.style.left) || 0);
    const cw = Math.round(parseFloat(c.style.width) || 0);
    const chh = Math.round(parseFloat(c.style.height) || r.height);
    return {
      x: Math.round(r.x), w: Math.round(r.width), r: Math.round(r.right), h: Math.round(r.height),
      cx, cw, ch: chh, cr: cx + cw,
    };
  })()`)
  results.leftResize = { before: before9, after: after9 }

  /* ---------- 10. 卡片描边可见 ---------- */
  results.cardBorder = await click(`(() => {
    const c = document.querySelector('.plugin-card');
    const cs = getComputedStyle(c);
    return { width: cs.borderTopWidth, style: cs.borderTopStyle, color: cs.borderTopColor };
  })()`)

  /* ---------- 10b. 选中态隐藏右下角三角形（hover 也不复现） ---------- */
  {
    const seBg = (sel) => click(`(() => {
      const card = ${sel};
      const se = card.querySelector('.resize-edge.resize-se');
      const cs = getComputedStyle(se);
      const r = se.getBoundingClientRect();
      return {
        focused: card.classList.contains('focused'),
        bgImage: cs.backgroundImage,
        cursor: cs.cursor,
        w: Math.round(r.width), h: Math.round(r.height),
      };
    })()`)

    const first = `document.querySelectorAll('.plugin-card')[0]`
    const second = `document.querySelectorAll('.plugin-card')[1]`

    // 刷新以重置焦点：focusedId 是内存态，而前序步骤（打开设置面板等）会选中某张卡片。
    // 宿主目前没有「取消选中」的交互，故只能靠重新加载回到初始状态。
    await win.webContents.reload()
    await wait(1700)

    const unfocused = await seBg(first)

    // 让第二张卡片获得焦点
    await click(`(() => {
      const card = document.querySelectorAll('.plugin-card')[1];
      card.querySelector('.card-head').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    })()`)
    await wait(500)
    const focused = await seBg(second)

    // 用真实鼠标移动触发 :hover，确认不会把三角形画回来
    const pt = await click(`(() => {
      const se = document.querySelectorAll('.plugin-card')[1].querySelector('.resize-edge.resize-se');
      const b = se.getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    })()`)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y })
    await wait(500)
    const hovered = await seBg(second)

    results.seTriangle = { unfocused, focused, hovered }
  }

  /* ---------- 11. 显示比例 ---------- */
  results.scale = {}
  results.scale.initial = await click(`(() => ({
    zoom: document.documentElement.style.zoom || '(none)',
    cssVar: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
    innerW: window.innerWidth,
  }))()`)

  // 切到「设置」页，用快捷档位改成 150%
  await click(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('设置')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  results.scale.settingsHasSlider = await click(`!!document.querySelector('input[type=range][min="0.5"]')`)
  await click(`(() => {
    const btns = [...document.querySelectorAll('.panel button')];
    const b = btns.find(x => x.textContent.trim() === '150%');
    if (b) { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
    return false;
  })()`)
  await wait(500)
  results.scale.after150 = await click(`(() => ({
    zoom: document.documentElement.style.zoom,
    cssVar: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
    innerW: window.innerWidth,
  }))()`)

  // 关键：非 1 比例下，设置面板是否仍能正确锚定（这是 CSS zoom 的主要风险点）
  await click(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(600)
  await click(`(() => {
    const cards = [...document.querySelectorAll('.plugin-card')];
    const notes = cards.find(c => (c.querySelector('.card-head .title')||{}).textContent === '便签');
    notes.querySelector('.gear').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(800)
  results.scale.panelAnchorAt150 = await click(`(() => {
    const panel = document.querySelector('.settings-panel');
    if (!panel) return 'no-panel';
    const cards = [...document.querySelectorAll('.plugin-card')];
    const notes = cards.find(c => (c.querySelector('.card-head .title')||{}).textContent === '便签');
    const g = notes.querySelector('.gear').getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    return {
      rightGap: Math.round(Math.abs(p.right - g.right)),
      // 面板可能因下方空间不足而向上翻转，这属于预期行为；
      // 关键是与齿轮「不重叠」且紧贴（下方展开时 top>=gear.bottom，翻转时 bottom<=gear.top）
      belowGear: p.top >= g.bottom - 1,
      flippedAbove: p.bottom <= g.top + 1,
      noOverlap: p.bottom <= g.top + 1 || p.top >= g.bottom - 1,
      withinViewport: p.right <= window.innerWidth + 1 && p.left >= -1
        && p.bottom <= window.innerHeight + 1 && p.top >= -1,
      opacity: getComputedStyle(panel).opacity,
    };
  })()`)

  // 复位比例
  await click(`document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
  await wait(300)
  await click(`(() => {
    const s = JSON.parse(localStorage.getItem('workbench:state:v1')||'{}');
    if (s.settings) { s.settings.displayScale = 1; localStorage.setItem('workbench:state:v1', JSON.stringify(s)); }
    return true;
  })()`)
  await win.webContents.reload()
  await wait(1600)

  /* ---------- 12. 右键卡片 → 原生菜单 ---------- */
  const before = contextMenuCalls
  await click(`(() => {
    const card = document.querySelector('.plugin-card');
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return true;
  })()`)
  await wait(600)
  results.cardContextMenu = { calls: contextMenuCalls - before, labels: lastMenuLabels.slice() }

  /* ---------- 5. 右键空白 → 原生菜单 ---------- */
  const before2 = contextMenuCalls
  await click(`(() => {
    const vp = document.querySelector('.desktop-viewport');
    vp.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return true;
  })()`)
  await wait(600)
  results.blankContextMenu = { calls: contextMenuCalls - before2, labels: lastMenuLabels.slice() }

  /* ---------- 6. 原生菜单命令 → 前端响应 ---------- */
  // 主进程通过 win.webContents.send 下发命令，前端 onCommand 应收到并执行。
  // 用「刷新卡片」命令验证往返：先记录时间文本，再下发，再看是否变化。
  results.commandRoundTrip = await (async () => {
    const bridgeOk = await click(`typeof window.workbenchDesktop?.onCommand === 'function'`)
    if (!bridgeOk) return 'no-bridge'

    // 记录当前便签卡片的动作是否可达（通过注册表）
    const before = await click(`(() => {
      const el = document.querySelector('.plugin-card .card-head .title');
      return el ? el.textContent : null;
    })()`)

    // 主进程下发 open-add 命令，应唤起插件坞
    // （原「选择插件」面板 .add-panel 已与插件坞合并后删除）
    win.webContents.send('workbench:command', { type: 'open-add' })
    await wait(700)
    const addOpen = await click(`!!document.querySelector('.dock')`)
    // 用完收起，免得影响后续断言
    await click(`(() => {
      var b = document.querySelector('.dock-x');
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`)
    await wait(400)

    return { bridgeOk: true, firstCard: before, openAddWorked: addOpen }
  })()

  console.log('RESULT ' + JSON.stringify(results, null, 2))

  /* ---------- 断言 ---------- */
  const problems = []
  const check = (c, m) => { if (!c) problems.push(m) }

  // 面板锚定与配色
  check(results.anchor.rightGap <= 8, `设置面板未右对齐齿轮（差 ${results.anchor.rightGap}px）`)
  // 面板要么在齿轮下方，要么（下方空间不足时）向上翻转并贴在齿轮上方。
  // 两种都是正确行为：以前只断言「在下方」，而面板高度随内容变化
  // （页面描述变高、精简设置展开都会让面板变高），一翻转就误报。
  check(results.anchor.belowGear || results.anchor.flippedUp,
    `设置面板既不在齿轮下方也未向上翻转（top=${results.anchor.panel?.y}）`)
  check(results.anchor.opacity === '1', '设置面板不可见（opacity≠1）')
  check(results.anchor.pairCount === 16, `配色对应为 16，实际 ${results.anchor.pairCount}`)
  check(results.closedAfterParentClick, '点击母界面未关闭设置菜单')
  check(results.pairApplied.config && results.pairApplied.config.bg && results.pairApplied.config.fg,
    '点击配色对未同时写入底色与字色')

  // 顶栏
  const order = results.header.order
  check(JSON.stringify(order.slice(-3)) === JSON.stringify(['↧', 'gear', '✕']),
    `顶栏末尾应为 [↧, gear, ✕]，实际 ${JSON.stringify(order)}`)
  check(results.header.closeIsLast, '✕ 不是顶栏最后一个元素')
  check(results.header.gapFromRight <= 10, `✕ 未贴右上角（距右缘 ${results.header.gapFromRight}px）`)
  check(!results.header.hasRefreshInHead, '顶栏仍有刷新按钮')

  // 设置菜单 / 便签
  check(results.settingsMenuButtons.some(t => t.includes('刷新')), '设置菜单缺少刷新')
  check(results.notesToolbar === 0, `便签工具栏仍常驻字号按钮（${results.notesToolbar} 个）`)

  // 收起顶部栏
  check(results.collapsed.headGone, '收起后顶栏未消失')
  check(results.collapsed.expandText === '↥', `收起后恢复按钮应为 ↥，实际 ${results.collapsed.expandText}`)
  check(results.collapsed.atTopRight, '恢复按钮不在右上角')
  check(results.collapsed.leftover === 0, '收起后仍残留顶栏控件')
  check(results.expandRestored, '点击 ↥ 未恢复顶栏')

  // 侧边栏
  const [d, m, h, back] = results.sidebar
  check(d.mode === 'detailed' && d.width === 216, `初始应为详细(216px)，实际 ${JSON.stringify(d)}`)
  check(m.mode === 'mini' && m.width === 60, `第二态应为迷你(60px)，实际 ${JSON.stringify(m)}`)
  check(h.mode === 'hidden' && h.toggleVisible, `第三态应隐藏侧边栏但保留切换按钮，实际 ${JSON.stringify(h)}`)
  check(back.mode === 'detailed', `应循环回详细形态，实际 ${JSON.stringify(back)}`)

  // 左侧调宽：宽度增加、右缘不动、x 左移。
  // 判据一律用画布坐标（cr / cw / cx）：改尺寸期间 Desktop 以鼠标为锚点
  // 自适应缩放（Desktop.tsx:262-264，松手复原），屏幕 rect 会漂移，属设计而非缺陷。
  const lr = results.leftResize
  check(
    lr.after.cw > lr.before.cw + 40,
    `左侧拖动未增加宽度（画布 ${lr.before.cw} → ${lr.after.cw}）`
  )
  check(
    Math.abs(lr.after.cr - lr.before.cr) <= 2,
    `左侧拖动时右缘应固定（画布 ${lr.before.cr} → ${lr.after.cr}；屏幕 rect ${lr.before.r} → ${lr.after.r} 会因自适应缩放漂移，不作判据）`
  )
  check(
    lr.after.cx < lr.before.cx - 40,
    `左侧拖动时 x 应左移（画布 ${lr.before.cx} → ${lr.after.cx}）`
  )
  check(Math.abs(lr.after.ch - lr.before.ch) <= 2, '左侧拖动不应改变高度')

  // 卡片描边
  check(parseFloat(results.cardBorder.width) >= 1, `卡片描边不可见（width=${results.cardBorder.width}）`)
  check(results.cardBorder.style === 'solid', `卡片描边样式应为 solid，实际 ${results.cardBorder.style}`)

  // 选中态隐藏右下角三角形。
  // 可见性判据用 backgroundImage !== 'none'：渐变里的 transparent 关键字
  // 计算值就是 rgba(0,0,0,0)，拿它当"不可见"会误判。
  {
    const t = results.seTriangle
    check(t.unfocused.focused === false, '前置清理失败：第一张卡片仍处于选中态')
    check(t.unfocused.bgImage !== 'none', `未选中时三角形应可见，实际 ${t.unfocused.bgImage}`)
    check(t.focused.focused === true, '第二张卡片应已选中')
    check(t.focused.bgImage === 'none', `选中时三角形应隐藏，实际 ${t.focused.bgImage}`)
    check(t.hovered.bgImage === 'none', `选中并 hover 时三角形仍应隐藏，实际 ${t.hovered.bgImage}`)
    check(t.hovered.cursor === 'nwse-resize', '手柄光标应保持 nwse-resize（仍可拖动）')
    check(t.hovered.w > 0 && t.hovered.h > 0, '手柄应仍有尺寸（可点击）')
  }

  // 显示比例
  check(results.scale.settingsHasSlider === true, '设置页缺少显示比例滑块')
  check(results.scale.after150.zoom === '1.5', `150% 档位未生效，zoom=${results.scale.after150.zoom}`)
  check(results.scale.after150.cssVar === '1.5', `--ui-scale 未同步，实际 ${results.scale.after150.cssVar}`)
  const pa = results.scale.panelAnchorAt150
  check(pa !== 'no-panel', '150% 比例下设置面板未渲染')
  if (pa !== 'no-panel') {
    check(pa.rightGap <= 8, `150% 下设置面板未右对齐（差 ${pa.rightGap}px）`)
    check(pa.noOverlap, '150% 下设置面板与齿轮重叠')
    check(pa.belowGear || pa.flippedAbove, '150% 下设置面板既不在下方也未向上翻转')
    check(pa.withinViewport, '150% 下设置面板超出视口')
    check(pa.opacity === '1', '150% 下设置面板不可见')
  }

  // 原生右键菜单
  check(results.cardContextMenu.calls >= 1, '右键卡片未弹出原生菜单')
  check(results.cardContextMenu.labels.some(l => l.includes('刷新')), '卡片菜单缺少刷新项')
  check(results.blankContextMenu.calls >= 1, '右键空白未弹出原生菜单')
  check(results.commandRoundTrip && results.commandRoundTrip.openAddWorked, '菜单命令未驱动前端')

  if (problems.length) {
    console.error(`\nFAIL (${problems.length}):`)
    problems.forEach(p => console.error('  ✗ ' + p))
  } else {
    console.log('\nPASS — 全部断言通过')
  }
  app.quit()
  process.exitCode = problems.length ? 1 : 0
}

app.whenReady().then(() => {
  // 等主进程 whenReady 的建窗逻辑跑完
  setTimeout(() => {
    run().catch((e) => { console.error('FATAL', e); app.quit() })
  }, 300)
})
