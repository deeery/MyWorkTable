/**
 * 验收：右下角悬浮控件不重叠。
 *
 * 用户报告「插件坞等按键重叠了」—— 根因是「＋新建窗口」与
 * 「插件坞」各自写死 bottom/right，两个圆钮叠在同一位置。
 * 现在按 CSS 变量分格摆放，这里用真实几何断言它们不重叠。
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

/** 两个矩形是否相交（留 1px 容差，避免浮点边界误判） */
function overlaps(a, b) {
  return !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)
}

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  win.setSize(1400, 900)
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s) } catch (e) { return { __err: String(e && e.message || e) } } }

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(1500)

  const problems = []

  /** 读某个选择器的屏幕矩形 */
  const rectOf = (sel) => js(`(() => {
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
  })()`)

  /* ---------- 1. 右下角只剩插件坞一个控件，且没有残留的旧按钮 ---------- */
  const addBtn = await rectOf('.new-window-btn')
  const dockBtn = await rectOf('.dock-launch')
  log('旧「＋新建窗口」按钮 ' + JSON.stringify(addBtn))
  log('插件坞按钮           ' + JSON.stringify(dockBtn))

  // 「＋新建窗口」已与插件坞合并，不该再存在
  if (addBtn) problems.push('旧「＋新建窗口」按钮仍存在（应与插件坞合并后删除）')
  if (!dockBtn) problems.push('找不到插件坞圆钮')

  /* ---------- 2. 展开态：面板完整在视口内 ---------- */
  await js(`document.querySelector('.dock-launch').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(800)
  const dockPanel = await rectOf('.dock')
  log('展开的面板 ' + JSON.stringify(dockPanel))

  if (!dockPanel) {
    problems.push('插件坞没有展开')
  } else {
    // 面板必须完整落在视口内（否则用户看不到底部内容）
    const vp = await js(`({ w: window.innerWidth, h: window.innerHeight })`)
    if (dockPanel.left < 0 || dockPanel.top < 0 || dockPanel.right > vp.w + 1 || dockPanel.bottom > vp.h + 1) {
      problems.push(`插件坞面板超出视口：面板=${JSON.stringify(dockPanel)} 视口=${JSON.stringify(vp)}`)
    } else {
      log('✓ 面板完整在视口内')
    }
    // 面板里应当有项目
    const items = await js(`document.querySelectorAll('.dock-item').length`)
    log('面板内项目数 ' + items)
    if (items === 0) problems.push('插件坞展开后没有任何项目')
  }

  /* ---------- 3. 顶部/侧边其他 fixed 控件也不该压到右下角这一带 ---------- */
  const allFixed = await js(`(() => {
    var out = [];
    document.querySelectorAll('body *').forEach(function (el) {
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed') return;
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      // 只看落在右下角区域的
      if (r.right < window.innerWidth - 240 || r.top < window.innerHeight - 240) return;
      out.push({
        cls: (el.className || '').toString().split(' ').slice(0, 2).join('.'),
        left: Math.round(r.left), top: Math.round(r.top),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
      });
    });
    return out;
  })()`)
  log('右下角区域的 fixed 元素 ' + JSON.stringify(allFixed))
  // 两两检查重叠
  for (let i = 0; i < allFixed.length; i++) {
    for (let j = i + 1; j < allFixed.length; j++) {
      const a = allFixed[i], b = allFixed[j]
      // 容器与自己的子元素天然重叠，跳过包含关系
      const contains = (p, q) => p.left <= q.left && p.top <= q.top && p.right >= q.right && p.bottom >= q.bottom
      if (contains(a, b) || contains(b, a)) continue
      if (overlaps(a, b)) {
        problems.push(`右下角 fixed 元素重叠：${a.cls} 与 ${b.cls}`)
      }
    }
  }

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-corner.txt'), out.join('\n') + '\n', 'utf8')

  /* 截图要拍「展开态」—— 断言跑完后坞是开着的，但第 3 步的
     两两重叠检查可能改变了状态，所以这里显式确保它开着再拍。 */
  const opened = await js(`!!document.querySelector('.dock')`)
  if (!opened) {
    await js(`document.querySelector('.dock-launch').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
    await wait(700)
  }
  log('截图时面板状态 ' + (await js(`!!document.querySelector('.dock')`) ? '展开' : '收起'))
  await wait(1500)
  /**
   * 强制重绘一帧再截图。
   *
   * ⚠ 验收模式下窗口是 show:false（离屏），Chromium 对离屏窗口的合成
   * 会偷懒：新出现的元素（这里是刚打开的插件坞面板）DOM 里明明存在、
   * elementFromPoint 也能命中，但 capturePage 抓到的像素里它是空的。
   * 读一次 offsetHeight 触发同步布局 + invalidate() 请求重绘，
   * 通常就能把这一帧逼出来。
   */
  await js(`(() => {
    var d = document.querySelector('.dock');
    if (d) { void d.offsetHeight; }
    document.body.style.opacity = '0.999';
    void document.body.offsetHeight;
    document.body.style.opacity = '';
    return true;
  })()`)
  win.webContents.invalidate()
  await wait(600)
  /**
   * 截图用 capturePage 的 rect 参数显式指定区域。
   * 不传 rect 时它抓「整个页面」，在 devicePixelRatio ≠ 1 的窗口里
   * （实测 dpr=1.75）会出现内容与坐标系错位。
   */
  const shotRect = await js(`(() => {
    var d = document.querySelector('.dock');
    var w = document.querySelector('.dock-wrap');
    if (!d) return null;
    var a = d.getBoundingClientRect(), b = w.getBoundingClientRect();
    var l = Math.min(a.left, b.left) - 20, t = Math.min(a.top, b.top) - 20;
    var r = Math.max(a.right, b.right) + 20, bo = Math.max(a.bottom, b.bottom) + 20;
    return { x: Math.max(0, Math.round(l)), y: Math.max(0, Math.round(t)), width: Math.round(r - l), height: Math.round(bo - t) };
  })()`)
  log('截图区域 ' + JSON.stringify(shotRect))
  const png = shotRect
    ? await win.webContents.capturePage(shotRect)
    : await win.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-corner.png'), png.toPNG())

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))
