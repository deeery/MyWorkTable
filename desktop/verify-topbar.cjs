/**
 * 验收：顶部栏（工作台选择条）
 *
 * 需求：移除原「页面标题 + 描述」顶部栏，只保留工作台选择顶部栏；
 *       鼠标不在顶部时自动缩成一条线段；可锁定不自动缩入。
 *
 * 检查链路：
 *   1. 各页都不再有 .page-title / .page-desc
 *   2. 默认（auto）状态下顶部栏收起，高度 ≈ 6px
 *   3. 鼠标移入 → 展开到完整高度，标签可见可点
 *   4. 鼠标移出 → 缩回
 *   5. 点锁定 → 鼠标移出也不缩（且持久化）
 *   6. 锁定态再点 → 回到自动缩入
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

/** 收起态高度上限（CSS 里是 6px，留点容差） */
const COLLAPSED_MAX = 10
/** 展开态高度下限（CSS 里是 40px） */
const EXPANDED_MIN = 30

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  win.setSize(1400, 900)
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s) } catch (e) { return { __err: String(e && e.message || e) } } }

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(1500)

  // 归一到「自动缩入」，避免上一轮残留的 locked 让起点不确定
  await js(`(() => {
    var s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    s.settings = { ...(s.settings || {}), topbarMode: 'auto' };
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2000)

  /**
   * ⚠ 关键：验收窗口是 show:false 的离屏窗口，Chromium 在其中
   * **不推进 CSS 过渡**（没有合成帧）。顶部栏的收起/展开是靠
   * `transition: height` + `transition: opacity` 做的，于是
   * 高度与透明度会永远停在起始值 —— 实测「加了 .expanded 但高度
   * 还是 6px」，看起来像功能坏了，其实只是过渡没跑。
   * （对照实验：关掉过渡后立刻变成 40px / opacity 1；
   *   把窗口 show() 出来也立刻正确。）
   *
   * 这里注入一段禁用过渡的样式，让断言测的是「规则算出来的终值」，
   * 而不是「过渡动画跑到哪一帧了」。不可动画的属性（如 pointer-events）
   * 本来就不受影响，禁用后行为一致。
   *
   * ⚠ 必须在 reload 之后注入 —— 注入的 <style> 活不过页面重载，
   *   放在 reload 之前等于没加（踩过这个坑）。
   */
  await js(`(() => {
    var st = document.createElement('style');
    st.id = '__verify_no_transition';
    st.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(st);
    return true;
  })()`)
  await wait(300)

  const problems = []

  /** 顶部栏高度 + 是否展开 */
  const barState = () => js(`(() => {
    var b = document.querySelector('.ws-bar');
    if (!b) return { err: '没有 .ws-bar' };
    var r = b.getBoundingClientRect();
    return {
      h: Math.round(r.height),
      expanded: b.classList.contains('expanded'),
      locked: b.classList.contains('locked'),
      tabs: document.querySelectorAll('.ws-tab').length,
      // 内容层是否可见（收起时应 opacity 0 且不接事件）
      innerOpacity: getComputedStyle(b.querySelector('.ws-inner')).opacity,
      innerEvents: getComputedStyle(b.querySelector('.ws-inner')).pointerEvents,
    };
  })()`)

  /**
   * 模拟鼠标进入/离开顶部栏。
   *
   * ⚠ 不能用 `dispatchEvent(new MouseEvent('mouseenter'))`：
   *   React 的 onMouseEnter 是靠 mouseout/mouseover 事件委托实现的，
   *   手工派发的 mouseenter 不会被它识别（实测派发后 class 毫无变化，
   *   会误判成「功能坏了」）。必须用真实的输入事件。
   *   这里用 webContents.sendInputEvent 发真正的 mouseMove，
   *   浏览器自己会算出 enter/leave。
   */
  const barPoint = async () => js(`(() => {
    var b = document.querySelector('.ws-bar').getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + 3) };
  })()`)

  const enter = async () => {
    const p = await barPoint()
    win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    await wait(450)
  }
  const leave = async () => {
    // 移到远离顶部栏的地方（桌面中央）
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 500 })
    await wait(450)
  }

  /* ---------- 1. 原顶部栏已移除 ---------- */
  for (const page of ['桌面', '插件', '设置', '我的']) {
    await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('${page}')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
    await wait(700)
    const r = await js(`({
      titles: document.querySelectorAll('.page-title').length,
      descs: document.querySelectorAll('.page-desc').length,
    })`)
    log(`「${page}」页 page-title=${r.titles} page-desc=${r.descs}`)
    if (r.titles || r.descs) problems.push(`「${page}」页仍残留 page-title/page-desc`)
  }

  // 回到桌面页
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(900)

  /* ---------- 2. 默认收起 ---------- */
  await leave()
  await wait(500)
  const collapsed = await barState()
  log('收起态 ' + JSON.stringify(collapsed))
  if (collapsed.err) problems.push(collapsed.err)
  else {
    if (collapsed.h > COLLAPSED_MAX) problems.push(`默认应收起，实际高度 ${collapsed.h}px`)
    if (collapsed.expanded) problems.push('默认不该带 .expanded')
    if (Number(collapsed.innerOpacity) > 0.05) problems.push(`收起时内容层应淡出，实际 opacity=${collapsed.innerOpacity}`)
    if (collapsed.innerEvents !== 'none') problems.push(`收起时内容层不应接收事件，实际 pointer-events=${collapsed.innerEvents}`)
  }

  /* ---------- 3. 鼠标移入 → 展开 ---------- */
  await enter()
  await wait(600)
  const expanded = await barState()
  log('展开态 ' + JSON.stringify(expanded))
  if (expanded.h < EXPANDED_MIN) problems.push(`鼠标移入后应展开，实际高度 ${expanded.h}px`)
  if (!expanded.expanded) problems.push('鼠标移入后应带 .expanded')
  if (Number(expanded.innerOpacity) < 0.9) problems.push(`展开时内容层应可见，实际 opacity=${expanded.innerOpacity}`)
  if (expanded.tabs < 1) problems.push('展开后没有工作台标签')

  /* ---------- 4. 鼠标移出 → 缩回 ---------- */
  await leave()
  await wait(600)
  const recollapsed = await barState()
  log('再收起 ' + JSON.stringify(recollapsed))
  if (recollapsed.h > COLLAPSED_MAX) problems.push(`鼠标移出后应缩回，实际高度 ${recollapsed.h}px`)

  /* ---------- 5. 锁定 → 移出也不缩 ---------- */
  await enter()
  await wait(500)
  await js(`document.querySelector('.ws-lock').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(600)
  await leave()
  await wait(700)
  const locked = await barState()
  log('锁定后移出 ' + JSON.stringify(locked))
  if (!locked.locked) problems.push('点锁定后未带 .locked')
  if (locked.h < EXPANDED_MIN) problems.push(`锁定后鼠标移出仍缩入了（高度 ${locked.h}px）`)
  const savedMode = await js(`(JSON.parse(localStorage.getItem('workbench:state:v1')||'{}').settings||{}).topbarMode`)
  log('持久化的 topbarMode ' + savedMode)
  if (savedMode !== 'locked') problems.push(`锁定状态未持久化，实际 ${savedMode}`)

  /* ---------- 6. 解锁 → 回到自动缩入 ---------- */
  await js(`document.querySelector('.ws-lock').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(700)
  const unlocked = await barState()
  log('解锁后 ' + JSON.stringify(unlocked))
  if (unlocked.locked) problems.push('再点一次应解除锁定')
  if (unlocked.h > COLLAPSED_MAX) problems.push(`解锁且鼠标不在上面时应缩回，实际 ${unlocked.h}px`)

  /* ---------- 7. 分页器与定位模式已移除 ---------- */
  const gone = await js(`({
    pager: document.querySelectorAll('.pager').length,
    layoutBar: document.querySelectorAll('.layout-bar').length,
    swapBtn: [...document.querySelectorAll('button')].filter(b => b.textContent.includes('定位模式')).length,
  })`)
  log('已移除的控件 ' + JSON.stringify(gone))
  if (gone.pager) problems.push('分页器仍存在')
  if (gone.layoutBar) problems.push('分页工具条容器仍存在')
  if (gone.swapBtn) problems.push('定位模式按钮仍存在')

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-topbar.txt'), out.join('\n') + '\n', 'utf8')

  /* 截图：收起态与展开态各一张 */
  await leave(); await wait(500)
  const r1 = await js(`(() => { var b = document.querySelector('.ws-bar').getBoundingClientRect(); return { x: 0, y: 0, width: Math.round(b.width), height: 90 }; })()`)
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-topbar-collapsed.png'), (await win.webContents.capturePage(r1)).toPNG())
  await enter(); await wait(700)
  const r2 = await js(`(() => { var b = document.querySelector('.ws-bar').getBoundingClientRect(); return { x: 0, y: 0, width: Math.round(b.width), height: 90 }; })()`)
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-topbar-expanded.png'), (await win.webContents.capturePage(r2)).toPNG())

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))
