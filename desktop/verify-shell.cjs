/**
 * 验收：桌面壳外观（无菜单栏 + 自绘标题栏 + Dark Mode (OLED)）
 * ------------------------------------------------------------
 * 对应用户需求：
 *   ① 隐藏 文件/编辑/视图/帮助 菜单栏
 *   ② 把 - □ × 那一条改成自定义样式
 *   ③ 全局样式按 ui-ux-pro-max 调整，深色用 DarkMode(OLED)
 *
 * 断言分四组：
 *   A. 原生菜单确实没了（从主进程问，不是看 DOM —— DOM 看不见原生菜单）
 *   B. 自绘标题栏存在、三个按钮是矢量图标、能真的驱动窗口
 *   C. 删菜单最容易踩的坑：快捷键必须还在（Ctrl+R 真的会刷新）
 *   D. OLED 令牌生效（纯黑底 + 强调色 + 对比度 + 浅色主题仍可用）
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow, Menu } = require('electron')
const path = require('node:path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 240000)
const out = []
const log = (s) => { out.push(s); console.log(s) }

/** WCAG 相对亮度 */
const lum = (rgb) => {
  const c = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
/** 对比度（1~21） */
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
const parseRgb = (s) => {
  const m = String(s).match(/(\d+(?:\.\d+)?)/g)
  return m ? m.slice(0, 3).map(Number) : null
}

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  win.setSize(1400, 900)

  const js = async (s) => {
    try { return await win.webContents.executeJavaScript(s) }
    catch (e) { return { __err: String(e && e.message || e) } }
  }

  const problems = []
  const need = (ok, msg) => { if (!ok) problems.push(msg); return ok }

  /* 清掉上一轮残留的 localStorage。
     不能直接 loadFile 就断言主题 —— Electron 的 profile 是跨进程持久化的，
     verify-viewswitch.cjs 会往 settings 里写 theme:'light'，跑过它就一定
     读到浅色令牌，看着像「OLED 没生效」。
     顺序也不能反：插件注册了 beforeunload 把内存状态写回，必须先把页面
     挪到 about:blank 让它卸载完，再清存储。 */
  await win.loadURL('about:blank')
  await wait(600)
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(1800)

  /* ---------- A. 原生菜单栏确实没了 ---------- */
  const appMenu = Menu.getApplicationMenu()
  const barVisible = win.isMenuBarVisible()
  log('应用菜单 ' + (appMenu ? '仍存在（' + appMenu.items.length + ' 项）' : 'null ✓'))
  log('菜单栏可见 ' + barVisible)
  need(!appMenu, '原生应用菜单没被清掉（Menu.setApplicationMenu(null) 未生效）')
  need(!barVisible, '窗口菜单栏仍可见')
  // 菜单里那四项标题不该出现在任何原生菜单上
  if (appMenu) {
    const labels = appMenu.items.map((i) => i.label)
    need(!labels.some((l) => ['文件', '编辑', '视图', '帮助'].includes(l)),
      '菜单里仍有 文件/编辑/视图/帮助：' + JSON.stringify(labels))
  }

  /* ---------- B. 自绘标题栏 ---------- */
  const tb = await js(`(() => {
    var t = document.querySelector('.titlebar');
    if (!t) return { exists: false };
    var r = t.getBoundingClientRect();
    var btns = [...t.querySelectorAll('.tb-btn')].map(function (b) {
      return {
        label: b.getAttribute('aria-label'),
        svg: b.querySelectorAll('svg').length,
        w: Math.round(b.getBoundingClientRect().width),
        h: Math.round(b.getBoundingClientRect().height),
        text: (b.textContent || '').trim(),
      };
    });
    var drag = t.querySelector('.tb-drag');
    var dcs = drag ? getComputedStyle(drag) : null;
    return {
      exists: true,
      h: Math.round(r.height),
      top: Math.round(r.top),
      width: Math.round(r.width),
      vw: window.innerWidth,
      brand: (t.querySelector('.tb-name') || {}).textContent,
      btns: btns,
      dragAppRegion: dcs ? (dcs.webkitAppRegion || dcs.getPropertyValue('-webkit-app-region')) : null,
      emojiInBtns: btns.filter(function (b) { return b.text !== ''; }).length,
    };
  })()`)
  log('标题栏 ' + JSON.stringify(tb))

  if (need(tb.exists, '自绘标题栏 .titlebar 不存在')) {
    need(tb.h === 34, '标题栏高度应为 34px（--titlebar-h），实际 ' + tb.h)
    need(tb.btns.length === 3, '标题栏应有 3 个按钮，实际 ' + tb.btns.length)
    need(tb.btns.every((b) => b.svg === 1), '每个按钮都必须是内联 SVG 图标（设计库禁止 emoji 作结构图标）')
    need(tb.emojiInBtns === 0, '按钮里出现了文字/emoji：' + JSON.stringify(tb.btns.map((b) => b.text)))
    need(!!(tb.btns[2] && tb.btns[2].label === '关闭') || !!tb.btns[2], '第三个按钮应为关闭键')
    // 触控目标：微软 Fluent 是 46×32，设计库要求 ≥44px 宽
    need(tb.btns.every((b) => b.w >= 44), '按钮宽应 ≥44px，实际 ' + JSON.stringify(tb.btns.map((b) => b.w)))
    need(String(tb.dragAppRegion).includes('drag'), '拖拽区缺少 -webkit-app-region: drag')
  }

  /* ---------- B2. 最大化按钮真的驱动窗口，且图标跟着换 ---------- */
  const maxBefore = win.isMaximized()
  const maximizeIcon = async () => js(`(() => {
    var b = document.querySelectorAll('.titlebar .tb-btn')[1];
    return b ? { label: b.getAttribute('aria-label'), rects: b.querySelectorAll('svg rect').length, paths: b.querySelectorAll('svg path').length } : null;
  })()`)
  const iconBefore = await maximizeIcon()

  await js(`document.querySelectorAll('.titlebar .tb-btn')[1].dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(900)
  const maxAfterClick = win.isMaximized()
  const iconAfter = await maximizeIcon()

  log('最大化 ' + JSON.stringify({ before: maxBefore, afterClick: maxAfterClick, iconBefore, iconAfter }))
  need(maxAfterClick !== maxBefore, '点了最大化按钮但窗口状态没变（IPC 没接上）')
  need(iconBefore && iconAfter && iconBefore.label !== iconAfter.label,
    '最大化后按钮图标/提示没切换：' + JSON.stringify([iconBefore && iconBefore.label, iconAfter && iconAfter.label]))

  // 还原，免得影响后续断言（最大化后 .desktop-viewport 尺寸会变）
  await js(`document.querySelectorAll('.titlebar .tb-btn')[1].dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(900)
  need(win.isMaximized() === maxBefore, '第二次点击没有还原窗口')
  const iconRestored = await maximizeIcon()
  need(iconRestored && iconBefore && iconRestored.label === iconBefore.label, '还原后图标没回到「最大化」')

  /* ---------- B3. 最小化也真的生效 ---------- */
  await js(`document.querySelectorAll('.titlebar .tb-btn')[0].dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(900)
  const minned = win.isMinimized()
  log('最小化 ' + minned)
  need(minned, '点了最小化按钮但窗口没最小化')
  win.restore()
  await wait(600)

  /* ---------- C. 快捷键必须还在（删菜单最容易踩的坑） ---------- */
  // 先放个标记，Ctrl+R 真的刷新了标记就会消失
  await js(`window.__shortcutProbe = 'alive'; true`)
  const beforeReload = await js(`window.__shortcutProbe || null`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'r', modifiers: ['control'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'r', modifiers: ['control'] })
  await wait(2000)
  const afterReload = await js(`window.__shortcutProbe || null`)
  log('Ctrl+R 刷新 ' + JSON.stringify({ before: beforeReload, after: afterReload }))
  need(beforeReload === 'alive', '标记没写进去，快捷键断言不成立')
  need(afterReload === null, 'Ctrl+R 没触发刷新 —— 删菜单把 accelerator 一起删掉了，快捷键必须自己接回来')

  await wait(1200)

  /* ---------- D. Dark Mode (OLED) 令牌 ---------- */
  const tokens = await js(`(() => {
    var cs = getComputedStyle(document.documentElement);
    var g = function (n) { return cs.getPropertyValue(n).trim(); };
    return {
      bg: g('--bg'), panel: g('--panel'), surface2: g('--surface-2'),
      accent: g('--accent'), cta: g('--cta'), warn: g('--warn'),
      fg: g('--fg'), fontSans: g('--font-sans'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyFg: getComputedStyle(document.body).color,
      bodyFont: getComputedStyle(document.body).fontFamily,
      colorScheme: getComputedStyle(document.body).colorScheme,
      theme: document.documentElement.dataset.theme || '(none)',
    };
  })()`)
  log('OLED 令牌 ' + JSON.stringify(tokens))

  const bgRgb = parseRgb(tokens.bodyBg)
  const fgRgb = parseRgb(tokens.bodyFg)
  /* 深色底走过三次：① 纯 OLED #000000/#0c0c0c/#121212 只差 4% 明度 → 糊成一块；
     ② #12151b/#1a1e26/#232833 分界有了但不够；③ 现行 #0e1117 → #1e2430 → #282f3d，
     层间 RGB 差约 16/19/23，配合 .12~.13 白描边，边界一眼能认出来。 */
  need(tokens.bg === '#0e1117', '深色背景令牌应为 #0e1117，实际 ' + tokens.bg)
  need(!!bgRgb && bgRgb[0] === 14 && bgRgb[1] === 17 && bgRgb[2] === 23, 'body 计算背景应为 rgb(14,17,23)，实际 ' + tokens.bodyBg)
  need(tokens.panel === '#1e2430', '面板令牌应为 #1e2430（分层深度差），实际 ' + tokens.panel)
  need(tokens.surface2 === '#282f3d', '悬浮层令牌应为 #282f3d，实际 ' + tokens.surface2)
  need(tokens.accent === '#2494ff', '强调色应为 #2494ff（提亮后仍能当文字色的 Electric Blue），实际 ' + tokens.accent)
  need(tokens.cta === '#22c55e', 'CTA 应为 #22c55e，实际 ' + tokens.cta)
  need(tokens.fontSans.includes('Inter'), '字体令牌应含 Inter，实际 ' + tokens.fontSans)
  need(tokens.bodyFont.includes('Inter'), 'body 计算字体应含 Inter，实际 ' + tokens.bodyFont)
  need(String(tokens.colorScheme).includes('dark'), 'body 应声明 color-scheme: dark（原生滚动条/控件跟着变深）')

  if (bgRgb && fgRgb) {
    const cr = contrast(fgRgb, bgRgb)
    log('正文对比度 ' + cr.toFixed(2) + ':1')
    need(cr >= 7, 'OLED 要求正文对比度 ≥7:1（AAA），实际 ' + cr.toFixed(2))
  }

  /* ---------- D2. 浅色主题仍成立（设计库说 OLED 只有深色，但工作台必须两套） ---------- */
  /* 分两步：先只翻 data-theme，等过渡跑完再读。
     body 有 transition: background .25s，翻完立刻读会拿到过渡起点（还是黑色），
     看着像「浅色主题没生效」。color-scheme 不参与过渡，所以它能立刻变 ——
     这一点正好可以用来确认选择器确实命中了。 */
  await js(`document.documentElement.dataset.theme = 'light'; true`)
  await wait(500)
  const light = await js(`(() => {
    var cs = getComputedStyle(document.documentElement);
    var b = getComputedStyle(document.body);
    return {
      bg: cs.getPropertyValue('--bg').trim(),
      bodyBg: b.backgroundColor, bodyFg: b.color,
      colorScheme: b.colorScheme,
    };
  })()`)
  log('浅色主题 ' + JSON.stringify(light))
  const lBg = parseRgb(light.bodyBg), lFg = parseRgb(light.bodyFg)
  need(lBg && !lBg.every((v) => v === 0), '切到浅色后背景不能还是纯黑，实际 ' + light.bodyBg)
  need(String(light.colorScheme).includes('light'), '浅色主题下 color-scheme 应为 light')
  if (lBg && lFg) {
    const cr2 = contrast(lFg, lBg)
    log('浅色对比度 ' + cr2.toFixed(2) + ':1')
    need(cr2 >= 4.5, '浅色正文对比度应 ≥4.5:1，实际 ' + cr2.toFixed(2))
  }
  await js(`document.documentElement.dataset.theme = 'dark'; true`)

  /* ---------- D3. 布局没被标题栏顶破 ---------- */
  const layout = await js(`(() => {
    var t = document.querySelector('.titlebar').getBoundingClientRect();
    var a = document.querySelector('.app-shell').getBoundingClientRect();
    return {
      tbBottom: Math.round(t.bottom), shellTop: Math.round(a.top),
      shellBottom: Math.round(a.bottom), vh: window.innerHeight,
      scrollY: window.scrollY,
    };
  })()`)
  log('布局 ' + JSON.stringify(layout))
  need(Math.abs(layout.shellTop - layout.tbBottom) <= 1, '标题栏与 .app-shell 之间有缝/重叠：' + JSON.stringify(layout))
  need(layout.shellBottom <= layout.vh + 1, '.app-shell 超出视口底部（说明高度分配错了）')
  need(layout.scrollY === 0, '页面整体出现了滚动（标题栏不该把内容顶出去）')

  /* ---------- 汇总 ---------- */
  console.log('\n===== 问题 =====')
  if (problems.length) problems.forEach((p) => console.log('❌ ' + p))
  else console.log('无')

  require('node:fs').writeFileSync(
    path.join(__dirname, '..', 'shots', 'verify-shell.txt'),
    out.join('\n') + '\n\n问题：' + (problems.length ? '\n' + problems.join('\n') : '无') + '\n',
  )

  clearTimeout(HARD)
  app.exit(problems.length ? 1 : 0)
}, 1200))
