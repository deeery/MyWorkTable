/**
 * 验收：新建工作台是一张空桌面。
 *
 * 需求：新建的工作台不继承当前工作台的插件，保持桌面清空。
 *
 * 检查链路：
 *   1. 先在当前工作台放几个插件上桌面
 *   2. 点「＋」新建工作台
 *   3. 断言新工作台上 0 张卡片，且当前工作台已切换
 *   4. 断言原工作台的插件还在（切回去验证）—— 新建不该动到别人
 *   5. 断言插件坞里仍能看到全部插件（空桌面不等于插件被卸载）
 *   6. 从插件坞点一个插件 → 它出现在这个空工作台上
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

  /* 清干净上一次跑残留的数据。
     ⚠ 本脚本原先是「不装插件、直接改 localStorage」，赌上一轮（或全量回归里
     前一个脚本）已经装好了 lab 插件。单独跑时这个前提不成立 —— s.installed
     里只有目录默认可见的那几个（时钟等，都不是 lab.*），于是 `isLab` 全为
     false，一张卡片都上不了桌面，报「应有 3 个插件上桌面，实际 1」。
     现在改成自己装：不依赖任何前置脚本。
     ⚠ 清库三步顺序不能反：先离开页面（触发插件 beforeunload 把内存数据写回
     localStorage），再清，最后才加载应用。 */
  await win.loadURL('about:blank')
  await wait(600)
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(1800)

  // 从插件市场装 3 个 lab 插件（走正规入口）
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('插件')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('插件市场')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`(() => {
    const NAMES = ['倒数日','桌面宠物','待办清单'];
    document.querySelectorAll('.market-card').forEach(c => {
      if (!NAMES.some(w => c.textContent.includes(w))) return;
      const b = [...c.querySelectorAll('button')].find(x => x.textContent.includes('安装'));
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return true;
  })()`)
  await wait(1500)

  const problems = []

  /** 读工作台与卡片状态 */
  const snap = () => js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = s.workspaces || [];
    var active = ws.find(function (w) { return w.id === s.activeWorkspace; }) || ws[0];
    // 多窗口模型：布局在 windows 数组里，不在 slots 对象里
    var wins = active && Array.isArray(active.windows) ? active.windows : [];
    var visible = wins.filter(function (x) { return x.visible; });
    return {
      wsCount: ws.length,
      names: ws.map(function (w) { return w.name; }),
      activeName: active ? active.name : null,
      activeVisible: visible.length,
      cards: document.querySelectorAll('.plugin-card').length,
      tabs: document.querySelectorAll('.ws-tab').length,
      dockItems: document.querySelectorAll('.dock-item').length,
    };
  })()`)

  /* ---------- 准备：清空并只留一个工作台，放 3 个插件上桌面 ---------- */
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    // 只保留一个工作台，避免上一轮残留影响
    var ws0 = { id: 'ws-a', name: '默认工作台', windows: [] };
    s.workspaces = [ws0];
    s.activeWorkspace = 'ws-a';
    // 前 3 个 lab 插件上桌面，其余不上
    var n = 0;
    (s.installed || []).forEach(function (p) {
      var id = p.manifest.id;
      var isLab = String(id).indexOf('lab.') === 0;
      var on = isLab && n < 3;
      ws0.windows.push({
        id: 'w-' + id, pluginId: id, visible: on,
        size: 'S',
      });
      if (on) { ws0.windows[ws0.windows.length - 1].x = 60 + n * 300; ws0.windows[ws0.windows.length - 1].y = 80; n++; }
    });
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2200)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(3000)

  const before = await snap()
  log('新建前 ' + JSON.stringify(before))
  if (before.activeVisible !== 3) problems.push(`准备阶段应有 3 个插件上桌面，实际 ${before.activeVisible}`)
  if (before.cards !== 3) problems.push(`准备阶段桌面应有 3 张卡片，实际 ${before.cards}`)

  /* ---------- 点「＋」新建工作台 ---------- */
  const clicked = await js(`(() => {
    var b = document.querySelector('.ws-add');
    if (!b) return { err: '没有 .ws-add 按钮' };
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  if (clicked.err) problems.push(clicked.err)
  await wait(2500)

  const after = await snap()
  log('新建后 ' + JSON.stringify(after))

  if (after.wsCount !== before.wsCount + 1) {
    problems.push(`新建后工作台数应 +1，实际 ${before.wsCount} → ${after.wsCount}`)
  }
  if (after.activeName === before.activeName) {
    problems.push('新建后应自动切到新工作台，但 activeName 没变')
  }
  // 核心断言：新工作台是空的
  if (after.activeVisible !== 0) {
    problems.push(`新工作台应清空，实际有 ${after.activeVisible} 个插件上桌面`)
  }
  if (after.cards !== 0) {
    problems.push(`新工作台桌面应有 0 张卡片，实际 ${after.cards}`)
  }
  // 空桌面要给出提示，不能是一片空白让人以为坏了
  const emptyTip = await js(`(() => {
    var t = document.querySelector('.empty-tip');
    return t ? t.textContent.trim() : null;
  })()`)
  log('空桌面提示 ' + JSON.stringify(emptyTip))
  if (!emptyTip) problems.push('空工作台没有给出提示文案')

  /* ---------- 原工作台的插件不能被影响 ---------- */
  const wsStates = await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    return (s.workspaces || []).map(function (w) {
      var wins = Array.isArray(w.windows) ? w.windows : [];
      return {
        name: w.name,
        visible: wins.filter(function (x) { return x.visible; }).length,
      };
    });
  })()`)
  log('各工作台的可见插件数 ' + JSON.stringify(wsStates))
  const first = wsStates.find((w) => w.name === '默认工作台')
  if (!first) problems.push('找不到原工作台「默认工作台」')
  else if (first.visible !== 3) {
    problems.push(`原工作台的 3 个插件被动了，现在剩 ${first.visible} 个`)
  }

  /* ---------- 切回原工作台，插件应还在 ---------- */
  await js(`(() => {
    var t = [...document.querySelectorAll('.ws-tab')].find(x => x.textContent.includes('默认工作台'));
    if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(2500)
  const back = await snap()
  log('切回原工作台 ' + JSON.stringify(back))
  if (back.cards !== 3) problems.push(`切回原工作台后应有 3 张卡片，实际 ${back.cards}`)

  /* ---------- 空工作台里，插件坞仍能列出全部插件 ---------- */
  // 切回新工作台
  await js(`(() => {
    var tabs = [...document.querySelectorAll('.ws-tab')];
    // 新工作台是最后一个
    var t = tabs[tabs.length - 1];
    if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(2000)
  // 打开插件坞
  await js(`(() => {
    var b = document.querySelector('.dock-launch');
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(1200)
  const dock = await js(`(() => ({
    items: document.querySelectorAll('.dock-item').length,
    onDesktop: document.querySelectorAll('.dock-item.on').length,
  }))()`)
  log('空工作台里的插件坞 ' + JSON.stringify(dock))
  if (dock.items === 0) problems.push('空工作台的插件坞里没有插件（应仍能列出全部已安装插件）')
  if (dock.onDesktop !== 0) problems.push(`空工作台里不该有插件标记为「已在桌面」，实际 ${dock.onDesktop} 个`)

  /* ---------- 从插件坞点一个 → 出现在这个空工作台上 ---------- */
  await js(`(() => {
    var it = document.querySelector('.dock-item');
    if (it) it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(2500)
  const added = await snap()
  log('从坞添加后 ' + JSON.stringify(added))
  if (added.cards !== 1) problems.push(`从插件坞点一个后应有 1 张卡片，实际 ${added.cards}`)

  /* ---------- 新工作台的名字应自动编号，不与现有重名 ---------- */
  const names = added.names
  const dup = names.filter((n, i) => names.indexOf(n) !== i)
  log('工作台名字 ' + JSON.stringify(names))
  if (dup.length) problems.push('工作台出现重名：' + JSON.stringify(dup))

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-newws.txt'), out.join('\n') + '\n', 'utf8')

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))
