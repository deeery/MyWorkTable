/**
 * 验收：插件坞「最多同时显示 10 项 + 可滚动看全部」
 *
 * 需求（用户原话）：「让插件坞能滑动显示所有插件，但是最多同时显示10个，
 * 即窗口高度为10个项目」
 *
 * 检查点：
 *   a. 列表**全部渲染**（不再截断到 10）—— 项目数 == 已安装插件数
 *   b. 可见高度 = 正好 10 行（10×行高 + 9×间距）
 *   c. 内容高于容器 → 可以滚动（scrollHeight > clientHeight）
 *   d. 每行高度固定且一致（「10 项」才算得准）
 *   e. 真的能滚到底（scrollTop 设到最大，最后一个可见）
 *   f. 不足 10 项时列表自然变矮（不留空白）
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

  // 装足够多的插件（要 > 10 个才能验证滚动）
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('插件')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('插件市场')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(600)
  const installed = await js(`(() => {
    var n = 0;
    document.querySelectorAll('.market-card').forEach(function (c) {
      var b = [...c.querySelectorAll('button')].find(function (x) { return x.textContent.includes('安装'); });
      if (b) { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); n++; }
    });
    return n;
  })()`)
  log(`安装插件数 ${installed}`)
  await wait(3000)

  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(3000)

  const problems = []

  /** 打开插件坞 */
  await js(`document.querySelector('.dock-launch').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(900)

  const probe = await js(`(() => {
    var dock = document.querySelector('.dock');
    if (!dock) return { err: 'no-dock' };
    var list = dock.querySelector('.dock-list');
    if (!list) return { err: 'no-list' };
    var items = [...list.querySelectorAll('.dock-item')];
    var cs = getComputedStyle(list);
    var rowsVar = getComputedStyle(dock).getPropertyValue('--dock-rows').trim();
    var rowVar = getComputedStyle(dock).getPropertyValue('--dock-row').trim();
    // 每行实际高度
    var heights = items.slice(0, 6).map(function (x) { return Math.round(x.getBoundingClientRect().height); });
    var allSame = heights.every(function (h) { return h === heights[0]; });
    return {
      rowsVar: rowsVar,
      rowVar: rowVar,
      itemCount: items.length,
      listClientH: Math.round(list.clientHeight),
      listScrollH: Math.round(list.scrollHeight),
      canScroll: list.scrollHeight > list.clientHeight + 2,
      maxHeightCss: cs.maxHeight,
      heights: heights,
      allSame,
      // 第 1 项与第 10 项的位置：能直接看出「10 项」是否真的装得下
      firstTop: items[0] ? Math.round(items[0].getBoundingClientRect().top) : null,
      tenthTop: items[9] ? Math.round(items[9].getBoundingClientRect().top) : null,
      tenthBottom: items[9] ? Math.round(items[9].getBoundingClientRect().bottom) : null,
      listTop: Math.round(list.getBoundingClientRect().top),
      listBottom: Math.round(list.getBoundingClientRect().bottom),
    };
  })()`)
  log('坞列表 ' + JSON.stringify(probe, null, 1))

  if (probe.err) problems.push(probe.err)
  else {
    /* a. 全部渲染，不再截断 */
    if (probe.itemCount <= 10) {
      problems.push(`只渲染了 ${probe.itemCount} 项 —— 装了很多插件时应全部渲染（靠滚动查看）`)
    }
    /* b. 可见高度 = 正好 10 行 */
    const rows = Number(probe.rowsVar)
    if (rows !== 10) problems.push(`--dock-rows 应为 10，实际 ${rows}`)
    // 第 10 项必须完整落在列表可视区内
    if (probe.tenthBottom != null && probe.listBottom != null) {
      if (probe.tenthBottom > probe.listBottom + 2) {
        problems.push(`第 10 项底部（${probe.tenthBottom}）超出列表底（${probe.listBottom}）—— 装不下 10 项`)
      }
    }
    // 第 11 项应**在可视区外**（否则说明一屏不止 10 项）
    const eleventh = await js(`(() => {
      var list = document.querySelector('.dock-list');
      var items = [...list.querySelectorAll('.dock-item')];
      if (items.length < 11) return null;
      var lb = list.getBoundingClientRect().bottom;
      return { top: Math.round(items[10].getBoundingClientRect().top), listBottom: Math.round(lb) };
    })()`)
    if (eleventh) {
      log(`第 11 项 top=${eleventh.top} vs 列表底=${eleventh.listBottom}`)
      if (eleventh.top < eleventh.listBottom - 4) {
        problems.push(`第 11 项（top=${eleventh.top}）也在可视区内 —— 一屏显示了超过 10 项`)
      }
    }
    /* c. 可滚动 */
    if (!probe.canScroll) {
      problems.push(`列表内容（${probe.listScrollH}px）没有超出容器（${probe.listClientH}px）—— 无法滚动看全部`)
    }
    /* d. 行高固定一致 */
    if (!probe.allSame) {
      problems.push(`各行高度不一致：${JSON.stringify(probe.heights)} —— 「10 项」会算不准`)
    }
  }

  /* e. 真的能滚到底 */
  const scrolled = await js(`(() => {
    var list = document.querySelector('.dock-list');
    if (!list) return { err: 'no-list' };
    var before = list.scrollTop;
    list.scrollTop = list.scrollHeight;
    var after = list.scrollTop;
    var items = [...list.querySelectorAll('.dock-item')];
    var last = items[items.length - 1];
    var lb = list.getBoundingClientRect().bottom;
    return {
      before: Math.round(before),
      after: Math.round(after),
      maxScroll: Math.round(list.scrollHeight - list.clientHeight),
      lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null,
      listBottom: Math.round(lb),
      lastVisible: last ? last.getBoundingClientRect().bottom <= lb + 2 : null,
    };
  })()`)
  log('滚动到底 ' + JSON.stringify(scrolled))
  if (scrolled.err) problems.push(scrolled.err)
  else {
    if (scrolled.after <= scrolled.before) {
      problems.push(`滚动无效（scrollTop ${scrolled.before} → ${scrolled.after}）`)
    }
    if (!scrolled.lastVisible) {
      problems.push(`滚到底后最后一个插件仍不可见（底部 ${scrolled.lastBottom} > 列表底 ${scrolled.listBottom}）`)
    }
  }

  /* f. 搜索过滤后不足 10 项时列表应变矮（不留空白） */
  const shortList = await js(`(async () => {
    var inp = document.querySelector('.dock-search input');
    if (!inp) return { err: 'no-input' };
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '番茄');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(function (r) { setTimeout(r, 700); });
    var list = document.querySelector('.dock-list');
    var items = [...list.querySelectorAll('.dock-item')];
    var dock = document.querySelector('.dock');
    return {
      itemCount: items.length,
      listH: Math.round(list.getBoundingClientRect().height),
      dockH: Math.round(dock.getBoundingClientRect().height),
      maxH: Math.round(parseFloat(getComputedStyle(list).maxHeight)),
    };
  })()`)
  log('搜索后 ' + JSON.stringify(shortList))
  if (!shortList.err) {
    if (shortList.itemCount < 10 && shortList.listH >= shortList.maxH - 2) {
      problems.push(`只匹配 ${shortList.itemCount} 项时列表仍有 ${shortList.listH}px 高（上限 ${shortList.maxH}）—— 应自然变矮，不留空白`)
    }
  }

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-dockscroll.txt'), out.join('\n') + '\n', 'utf8')

  // 截图：坞展开的样子（把搜索清掉，滚回顶部）
  await js(`(() => {
    var inp = document.querySelector('.dock-search input');
    if (inp) {
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var list = document.querySelector('.dock-list');
    if (list) list.scrollTop = 0;
    return true;
  })()`)
  await wait(900)
  await js(`(() => { void document.body.offsetHeight; document.body.style.opacity='0.999'; void document.body.offsetHeight; document.body.style.opacity=''; return true; })()`)
  win.webContents.invalidate()
  await wait(900)
  const rect = await js(`(() => {
    var dock = document.querySelector('.dock');
    if (!dock) return null;
    var b = dock.getBoundingClientRect();
    return { x: Math.max(0, Math.round(b.left) - 10), y: Math.max(0, Math.round(b.top) - 10), width: Math.round(b.width) + 20, height: Math.round(b.height) + 20 };
  })()`)
  if (rect) {
    fs.writeFileSync(path.join(__dirname, '..', 'shots', 'dock-scroll.png'), (await win.webContents.capturePage(rect)).toPNG())
  }

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))
