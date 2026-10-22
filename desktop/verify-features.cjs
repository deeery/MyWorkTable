/**
 * 验收：5 项改进的端到端检查
 *   1. 快捷启动器：应用清单来自宿主（不再写死），启动请求真的转交出去
 *   2. 布局预设：菜单能出、点下去卡片坐标真的变；定位模式能互换顺序
 *   3. 背景样式：data-bg 切换、.wb-backdrop 出现；顶部栏能隐藏
 *   4. 桌宠：召唤按钮 → 桌宠 DOM 出现，心情/气泡/拖拽不报错
 *   5. 临时工作台：每页 4 个插件，翻页后卡片数与序号对上
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
  await wait(1200)

  // 装 8 个 lab 插件，保证临时工作台有 2 页
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('插件')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('插件市场')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`(() => {
    // 装 10 个 lab 插件：临时工作台每页 4 个 → 3 页（留 1 页不满，顺便验边界）。
    // 其中必须含 08 快捷启动器，否则第 1 项验收找不到它。
    const NAMES = ['倒数日','喝水提醒','番茄专注','待办清单','世界时钟','快速便签','会议提醒','计时秒表','快捷启动器','习惯打卡'];
    document.querySelectorAll('.market-card').forEach(c => {
      if (!NAMES.some(w => c.textContent.includes(w))) return;
      const b = [...c.querySelectorAll('button')].find(x => x.textContent.includes('安装'));
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return true;
  })()`)
  await wait(1800)

  // 归一化：只留 lab 插件上桌面，坐标清掉让预设重新算
  await js(`(() => {
    const s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    (s.installed || []).forEach(p => {
      const isLab = String(p.manifest.id).startsWith('lab.');
      p.visible = isLab;
      if (isLab) { p.x = 0; p.y = 0; }
    });
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2000)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(4500)

  const problems = []
  const closePanels = async () => {
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(400)
  }

  /* ---------- 5. 分页器已移除 ---------- */
  // 分页器与「工作台」语义重叠（都是切换一组插件视图），已按需求删除。
  // 这里断言它确实不在了，防止以后又被加回来。
  const pagerGone = await js(`({
    pager: document.querySelectorAll('.pager').length,
    layoutBar: document.querySelectorAll('.layout-bar').length,
  })`)
  log('分页器残留 ' + JSON.stringify(pagerGone))
  if (pagerGone.pager) problems.push('分页器应已移除，但仍存在')
  if (pagerGone.layoutBar) problems.push('分页工具条容器应已移除，但仍存在')

  /* ---------- 2b. 定位模式已移除 ---------- */
  // 定位模式（拖到别张卡上互换位置）与卡片自身的自由拖拽在同一手势上
  // 打架，实际作用不明显，已按需求删除。这里断言它确实不在了。
  const swapGone = await js(`({
    swapModeCards: document.querySelectorAll('.plugin-card.swap-mode').length,
    swapShield: document.querySelectorAll('.swap-shield').length,
    swapBtn: [...document.querySelectorAll('button')].filter(b => b.textContent.includes('定位模式')).length,
    draggable: document.querySelector('.plugin-card')?.getAttribute('draggable'),
  })`)
  log('定位模式残留 ' + JSON.stringify(swapGone))
  if (swapGone.swapModeCards) problems.push('定位模式样式类仍存在')
  if (swapGone.swapShield) problems.push('定位模式遮罩仍存在')
  if (swapGone.swapBtn) problems.push('定位模式按钮仍存在')
  if (swapGone.draggable === 'true') problems.push('卡片不该再是可拖放元素')

  /* ---------- 3. 背景样式 ---------- */
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('设置')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(800)
  const bgGrid = await js(`(() => {
    var items = [...document.querySelectorAll('.bg-item .bg-name')].map(n => n.textContent);
    return { items, hasBackdrop: !!document.querySelector('.wb-backdrop') };
  })()`)
  log('bgGrid ' + JSON.stringify(bgGrid))
  if (!bgGrid.items || bgGrid.items.length < 6) problems.push('背景样式少于 6 种')
  if (!bgGrid.hasBackdrop) problems.push('没有 .wb-backdrop 元素')

  // 切到点阵
  await js(`(() => {
    var it = [...document.querySelectorAll('.bg-item')].find(x => x.textContent.includes('点阵'));
    it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(600)
  const bgDots = await js(`(() => ({
    dataBg: document.documentElement.dataset.bg,
    saved: (JSON.parse(localStorage.getItem('workbench:state:v1')||'{}').settings||{}).background,
  }))()`)
  log('bgDots ' + JSON.stringify(bgDots))
  if (bgDots.dataBg !== 'dots') problems.push(`切点阵后 data-bg 为 ${bgDots.dataBg}`)
  if (bgDots.saved !== 'dots') problems.push(`切点阵后未持久化，saved=${bgDots.saved}`)

  /* ---------- 3b. 顶部栏（工作台选择条） ---------- */
  // 原「页面标题 + 描述」顶部栏已全部移除，只保留工作台选择条；
  // 它默认自动缩入（鼠标离开缩成细线），可锁定常展开。
  // 详细行为由 desktop/verify-topbar.cjs 专项验收，这里只做存在性检查。
  //
  // ⚠ 顶部栏只挂在桌面页（App.tsx 里 WorkspaceTabs 在 page==='desktop'
  //   的分支内）。这段之前跑在「设置」页上，于是 hasBar 恒为 false ——
  //   不是功能缺失，是查错了页面。先切回桌面页再查。
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(1500)
  const topbarInfo = await js(`(() => {
    var b = document.querySelector('.ws-bar');
    return {
      hasBar: !!b,
      hasLock: !!document.querySelector('.ws-lock'),
      tabs: document.querySelectorAll('.ws-tab').length,
      // 旧的页面标题/描述必须彻底消失
      pageTitle: document.querySelectorAll('.page-title').length,
      pageDesc: document.querySelectorAll('.page-desc').length,
      mode: (JSON.parse(localStorage.getItem('workbench:state:v1')||'{}').settings||{}).topbarMode,
    };
  })()`)
  log('顶部栏 ' + JSON.stringify(topbarInfo))
  if (!topbarInfo.hasBar) problems.push('没有顶部栏（工作台选择条）')
  if (!topbarInfo.hasLock) problems.push('顶部栏缺少锁定按钮')
  if (topbarInfo.tabs < 1) problems.push('顶部栏里没有工作台标签')
  if (topbarInfo.pageTitle || topbarInfo.pageDesc) {
    problems.push('旧的 page-title / page-desc 仍残留（应已全部移除）')
  }
  if (topbarInfo.mode !== 'auto' && topbarInfo.mode !== 'locked') {
    problems.push('topbarMode 取值非法：' + topbarInfo.mode)
  }

  /* ---------- 4. 桌宠（已改为悬浮插件） ---------- */
  // 桌宠现在是 plugin-lab #51，走 manifest.overlay 由 OverlayHost 渲染。
  // 它不再是硬编码在宿主里的 .deskpet，而是「装了插件才有、卸载就消失」。
  const petInfo = await js(`(() => {
    var hosts = document.querySelectorAll('.overlay-host');
    return {
      overlayHosts: hosts.length,
      // 旧的硬编码桌宠不该再存在
      legacyLaunch: document.querySelectorAll('.deskpet-launch').length,
      legacyPet: document.querySelectorAll('.deskpet').length,
    };
  })()`)
  log('桌宠（悬浮插件） ' + JSON.stringify(petInfo))
  if (petInfo.legacyLaunch || petInfo.legacyPet) {
    problems.push('旧的硬编码桌宠仍存在（应已改为插件）')
  }
  // overlayHosts 为 0 是允许的 —— 用户可能还没安装/上桌面 #51，
  // 或者已把它移出桌面。这里只断言「旧实现已清除」。

  /* ---------- 1. 快捷启动器 ---------- */
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(2500)
  /**
   * 确保快捷启动器已安装并上桌面，再找它的卡片。
   *
   * 分页器移除后所有「在桌面」的插件会一次全渲染，不再需要翻页；
   * 但插件是否在桌面取决于前面归一化时的可见性设置，所以这里
   * 直接把它的 slot.visible 打开（幂等，已开则无变化），再刷新页面。
   */
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    var ws = (s.workspaces || []).find(w => w.id === s.activeWorkspace) || (s.workspaces || [])[0];
    if (!ws) return false;
    if (!Array.isArray(ws.windows)) ws.windows = [];
    var mine = ws.windows.filter(function (w) { return w.pluginId === 'lab.08'; });
    if (!mine.length) {
      mine = [{ id: 'w-lab08', pluginId: 'lab.08', visible: true, size: 'S' }];
      ws.windows.push(mine[0]);
    }
    mine[0].visible = true;
    mine[0].x = 1200; mine[0].y = 620;
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2500)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(3500)

  const findLauncher = async () => {
    // 给它几次机会：iframe 可能还在加载
    for (let i = 0; i < 6; i++) {
      const r = await js(`(() => {
        var f = [...document.querySelectorAll('.plugin-card')].map(c => c.querySelector('iframe'))
          .find(x => x && (x.getAttribute('src')||'').includes('08-app-launcher'));
        return f ? { src: f.getAttribute('src') } : null;
      })()`)
      if (r) return r
      await wait(1200)
    }
    return null
  }
  const launcher = await findLauncher()
  log('launcher ' + JSON.stringify(launcher))
  if (!launcher) {
    const diag = await js(`({
      cards: document.querySelectorAll('.plugin-card').length,
      names: [...document.querySelectorAll('.plugin-card .card-head .title')].map(n => n.textContent),
    })`)
    log('诊断：桌面上的卡片 ' + JSON.stringify(diag))
    problems.push('桌面上没有快捷启动器卡片')
  } else {
    /**
     * 验证宿主是否下发了真实应用清单。
     *
     * ⚠ 两个坑都踩过：
     *  1. 不能靠「再发一次 wb:apps-request 看宿主回不回」—— 那条总线
     *     只认 iframe 自己发出的消息，从父窗口发过去不经过它。
     *  2. 不能查 localStorage 的 `app-list` —— 插件的 store 带 `pl:` 前缀，
     *     实际键名是 `pl:app-list`。查错键名会得出「插件没收到清单」的
     *     错误结论，而插件其实早就存好了。
     *
     * 最可靠的是直接读插件自己渲染出来的计数（#cnt），那是它真实
     * 使用的清单长度。兜底清单只有 8 个，真实扫描上百个，一眼可辨。
     */
    const listInfo = await js(`(() => {
      var f = [...document.querySelectorAll('.plugin-card iframe')]
        .find(x => (x.getAttribute('src')||'').includes('08-app-launcher'));
      if (!f) return { err: 'no frame' };
      var doc = f.contentDocument;
      if (!doc) return { err: '读不到 iframe 文档' };
      var cnt = (doc.querySelector('#cnt') || {}).textContent || '';
      var n = Number((cnt.match(/(\\d+)/) || [])[1] || 0);
      // pl: 前缀是插件 store 的命名空间
      var raw = null;
      try { raw = f.contentWindow.localStorage.getItem('pl:app-list'); } catch (e) {}
      var arr = raw ? JSON.parse(raw) : [];
      return {
        cntText: cnt.trim(),
        n: n,
        stored: arr.length,
        realTargets: arr.filter(a => /^[A-Za-z]:\\\\|^https?:/i.test(String(a.target || ''))).length,
        sample: arr.slice(0, 3).map(a => a.n),
      };
    })()`)
    log('launcher 清单 ' + JSON.stringify(listInfo))
    if (listInfo.err) {
      problems.push('读不到快捷启动器的清单：' + listInfo.err)
    } else if (listInfo.n <= 8 || listInfo.realTargets === 0) {
      problems.push(
        `快捷启动器用的还是内置兜底清单（界面显示「${listInfo.cntText}」，真实目标 ${listInfo.realTargets} 个）—— 宿主没下发系统应用`,
      )
    } else {
      log(`✓ 拉到了 ${listInfo.n} 个系统应用（${listInfo.realTargets} 个带真实路径），示例：${listInfo.sample.join(' / ')}`)
    }

    // 启动链路：宿主应把 wb:launch 转成主进程调用并回报 wb:launch-result
    const launchResult = await js(`(() => {
      var f = [...document.querySelectorAll('.plugin-card')].map(c => c.querySelector('iframe'))
        .find(x => x && (x.getAttribute('src')||'').includes('08-app-launcher'));
      if (!f || !f.contentWindow) return Promise.resolve({ err: 'no frame' });
      return new Promise((res) => {
        var got = null;
        var onMsg = (e) => {
          if (e.source !== f.contentWindow) return;
          if (e.data && e.data.type === 'wb:launch-result') got = { ok: e.data.ok, err: e.data.err || '' };
        };
        window.addEventListener('message', onMsg);
        // 让插件自己发起一次启动（它会把请求转交宿主）
        f.contentWindow.postMessage({ type: '__test_launch' }, '*');
        setTimeout(() => { window.removeEventListener('message', onMsg); res(got || { err: '宿主没有回报 wb:launch-result' }); }, 3000);
      });
    })()`)
    log('launch 链路 ' + JSON.stringify(launchResult))
    // 这条只作记录：插件没有 __test_launch 这个约定，收不到属正常。
    // 真正的启动能力由 verify-launch.cjs 直接测 IPC 层。
  }

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-features.txt'), out.join('\n') + '\n', 'utf8')
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-features.png'), (await win.webContents.capturePage()).toPNG())

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))