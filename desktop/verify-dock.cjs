/**
 * 验收：插件坞 = 「新建窗口」入口（已与旧的「＋」按钮合并）。
 *
 * 需求：「合并插件坞和新增按钮」+「点击时新建该窗口」。
 *
 * 检查链路：
 *   1. 旧的「＋新建窗口」按钮（.new-window-btn / .add-panel）已不存在
 *   2. 右下角只剩插件坞一个圆钮
 *   3. 点圆钮 → 面板展开，标题是「新建窗口」
 *   4. 点一个「不在桌面」的插件 → 真的建出窗口（卡片数 +1，该插件 visible）
 *   5. 建完面板自动收起（让用户直接看到新窗口）
 *   6. 再点同一个（已在桌面）→ 不重复建，只置顶（卡片数不变）
 *   7. 停用的插件点一下 → 自动启用并建窗口
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 180000)
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

  /* ---------- 准备：清空桌面，只留一个工作台 ---------- */
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    s.workspaces = [{ id: 'ws-a', name: '默认工作台', windows: [] }];
    s.activeWorkspace = 'ws-a';
    (s.installed || []).forEach(function (p) {
      s.workspaces[0].windows.push({
        id: 'w-' + p.manifest.id, pluginId: p.manifest.id, visible: false, size: 'S',
      });
    });
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(3000)

  const snap = () => js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(function (w) { return w.id === s.activeWorkspace; });
    var wins = ws && Array.isArray(ws.windows) ? ws.windows : [];
    var vis = wins.filter(function (x) { return x.visible; }).map(function (x) { return x.pluginId; });
    return {
      cards: document.querySelectorAll('.plugin-card').length,
      visibleCount: vis.length,
      dockOpen: !!document.querySelector('.dock'),
      focused: (document.querySelector('.plugin-card.focused .card-head .title') || {}).textContent || null,
    };
  })()`)

  /* ---------- 1. 旧按钮已不存在 ---------- */
  const legacy = await js(`({
    newWindowBtn: document.querySelectorAll('.new-window-btn').length,
    addPanel: document.querySelectorAll('.add-panel').length,
    addWindow: document.querySelectorAll('.add-window').length,
    addShield: document.querySelectorAll('.add-shield').length,
    dockLaunch: document.querySelectorAll('.dock-launch').length,
  })`)
  log('旧控件残留 ' + JSON.stringify(legacy))
  if (legacy.newWindowBtn) problems.push('旧「＋新建窗口」按钮仍存在')
  if (legacy.addPanel) problems.push('旧 .add-panel 面板仍存在')
  if (legacy.addWindow) problems.push('旧 .add-window 容器仍存在')
  if (legacy.addShield) problems.push('旧 .add-shield 遮罩仍存在')
  if (legacy.dockLaunch !== 1) problems.push(`右下角应有且仅有 1 个插件坞圆钮，实际 ${legacy.dockLaunch}`)

  /* ---------- 2. 空桌面 ---------- */
  const empty = await snap()
  log('初始 ' + JSON.stringify(empty))
  if (empty.cards !== 0) problems.push(`准备阶段桌面应为空，实际 ${empty.cards} 张卡片`)

  /* ---------- 3. 点圆钮 → 面板展开，标题为「新建窗口」 ---------- */
  await js(`document.querySelector('.dock-launch').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(900)
  const head = await js(`(() => {
    var d = document.querySelector('.dock');
    if (!d) return { err: '面板没展开' };
    return {
      title: (d.querySelector('.dock-title') || {}).textContent || null,
      items: d.querySelectorAll('.dock-item').length,
      hasDesc: !!d.querySelector('.dock-desc'),
      hasBadge: !!d.querySelector('.dock-badge'),
    };
  })()`)
  log('面板 ' + JSON.stringify(head))
  if (head.err) problems.push(head.err)
  if (head.title !== '新建窗口') problems.push(`面板标题应为「新建窗口」，实际 ${head.title}`)
  if (head.items === 0) problems.push('面板里没有插件项')
  if (!head.hasDesc) problems.push('插件项缺少描述（应从原「＋」面板吸收）')

  /* ---------- 4. 点一个不在桌面的插件 → 建出窗口 ---------- */
  const target = await js(`(() => {
    var it = [...document.querySelectorAll('.dock-item')].find(x => !x.classList.contains('on'));
    if (!it) return null;
    var name = (it.querySelector('.dock-name') || {}).textContent || '';
    it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { name: name.replace(/已在桌面|悬浮|已停用/g, '').trim() };
  })()`)
  log('点击的插件 ' + JSON.stringify(target))
  if (!target) problems.push('找不到「不在桌面」的插件项可点')
  await wait(2500)

  const afterClick = await snap()
  log('点击后 ' + JSON.stringify(afterClick))
  if (afterClick.cards !== 1) {
    problems.push(`点击后应新建 1 个窗口（1 张卡片），实际 ${afterClick.cards}`)
  }
  if (afterClick.visibleCount !== 1) {
    problems.push(`点击后应有 1 个插件上桌面，实际 ${afterClick.visibleCount}`)
  }
  // 建完面板应收起
  if (afterClick.dockOpen) problems.push('新建窗口后面板没有自动收起')

  /* ---------- 5. 再点同一个 → 多开一个窗口（多窗口的核心） ---------- */
  //
  // ⚠ 这里的行为在多窗口改造后**反过来了**：以前「已在桌面」再点只置顶，
  //   现在每次点击都实实在在多开一个窗口 —— 那才是「同一个插件创建
  //   多个窗口」的预期。旧断言「不该重复建」现在是错的。
  await js(`document.querySelector('.dock-launch').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(800)
  const same = await js(`(() => {
    var it = [...document.querySelectorAll('.dock-item')].find(x => x.classList.contains('on'));
    if (!it) return null;
    var name = (it.querySelector('.dock-name') || {}).textContent || '';
    it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return name.replace(/已开\s*\d+\s*个|悬浮|已停用/g, '').trim();
  })()`)
  log('再点同一个 ' + JSON.stringify(same))
  await wait(2500)
  const afterSame = await snap()
  log('再点后 ' + JSON.stringify(afterSame))
  if (afterSame.cards !== 2) {
    problems.push(`再点同一个插件应多开一个窗口（共 2 张卡片），实际 ${afterSame.cards}`)
  }
  if (afterSame.visibleCount !== 2) {
    problems.push(`再点同一个插件应增加可见窗口数到 2，实际 ${afterSame.visibleCount}`)
  }

  /* ---------- 5.5 新建的窗口必须落在画布可见范围内 ---------- */
  //
  // 回归的是 findFreePosition 的列数计算：它原来量 window.innerWidth，
  // 而画布右侧还留着侧边栏（详细形态 216px），于是多算一列，新窗口
  // 被摆到画布外 —— 卡片右半边被裁掉，或者整张看不见，用户以为
  // 「点了新建窗口但没反应」。这里按画布自身的 clientWidth 复核。
  const inView = await js(`(() => {
    var vp = document.querySelector('.desktop-viewport');
    if (!vp) return { err: '找不到 .desktop-viewport' };
    var vr = vp.getBoundingClientRect();
    var cards = [...document.querySelectorAll('.plugin-card')].map(function (c) {
      var r = c.getBoundingClientRect();
      return {
        title: (c.querySelector('.card-head .title') || {}).textContent || '',
        left: Math.round(r.left - vr.left),
        right: Math.round(r.right - vr.left),
        top: Math.round(r.top - vr.top),
      };
    });
    return { vw: Math.round(vr.width), vh: Math.round(vr.height), cards: cards };
  })()`)
  log('新窗口落位 ' + JSON.stringify(inView))
  if (inView.err) {
    problems.push(inView.err)
  } else {
    inView.cards.forEach((c) => {
      if (c.left < 0) problems.push(`「${c.title}」左边缘超出画布 ${c.left}px`)
      if (c.right > inView.vw) problems.push(`「${c.title}」右边缘超出画布 ${c.right - inView.vw}px（画布宽 ${inView.vw}）`)
      if (c.top < 0) problems.push(`「${c.title}」上边缘超出画布 ${c.top}px`)
    })
  }

  /* ---------- 6. 停用的插件 → 点击后自动启用并建窗口 ---------- */
  // 把挑中的插件 id 存在 localStorage 而不是 window 上 ——
  // 下面要 reload，window 上的变量会被清掉（踩过这个坑，
  // 导致断言读到 enabled:null，看起来像功能坏了）。
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = s.workspaces[0];
    var cand = (s.installed || []).find(function (x) {
      return String(x.manifest.id).indexOf('lab.') === 0 &&
        !ws.windows.some(function (w) { return w.pluginId === x.manifest.id && w.visible; });
    });
    if (cand) {
      cand.enabled = false;
      localStorage.setItem('workbench:__test_disabled', cand.manifest.id);
    }
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return cand ? cand.manifest.id : null;
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(2500)

  await js(`document.querySelector('.dock-launch').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(800)
  const disabledClick = await js(`(() => {
    var it = document.querySelector('.dock-item.off');
    if (!it) return { err: '没有停用的插件项' };
    it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true };
  })()`)
  log('点停用的插件 ' + JSON.stringify(disabledClick))
  await wait(2500)
  const afterDisabled = await js(`(() => {
    var id = localStorage.getItem('workbench:__test_disabled');
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var p = (s.installed || []).find(function (x) { return x.manifest.id === id; });
    var ws = s.workspaces[0];
    return {
      id: id,
      enabled: p ? p.enabled : null,
      visible: p ? ws.windows.some(function (w) { return w.pluginId === p.manifest.id && w.visible; }) : null,
      cards: document.querySelectorAll('.plugin-card').length,
    };
  })()`)
  log('停用插件点击后 ' + JSON.stringify(afterDisabled))
  if (disabledClick.err) {
    log('⚠ ' + disabledClick.err)
  } else {
    if (afterDisabled.enabled !== true) problems.push(`点停用的插件后应自动启用（实际 ${afterDisabled.enabled}）`)
    if (afterDisabled.visible !== true) problems.push(`点停用的插件后应上桌面（实际 ${afterDisabled.visible}）`)
  }

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-dock.txt'), out.join('\n') + '\n', 'utf8')

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))
