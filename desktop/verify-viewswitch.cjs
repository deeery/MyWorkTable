/**
 * 验收：桌面卡片能在「完整内容 / 桌面精简」之间切换。
 *
 * 检查链路：
 *   设置菜单里出现「显示形态」分段控件
 *   → 点「桌面精简」写入 config.view=compact
 *   → iframe 的 src 变成 ...?view=host 且内部 html.pl-host
 *   → 点「完整内容」切回，src 变成 ...?view=embed 且内部 html.pl-embed
 *
 * 为什么精简用的是 host 而不是 compact：
 *   卡片本身已是窗口。compact 下 .cw 还带圆角/边框/阴影，看起来像
 *   卡片里又嵌了块小窗；host 在精简形态基础上抹掉这层外壳，让卡片
 *   成为唯一那层窗口。详见 assets/compact.css 的 html.pl-host 段。
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

require('./main.cjs')

/** 兜底：无论成功失败都要退出，避免验收脚本挂住不返回 */
const HARD_TIMEOUT = setTimeout(() => {
  console.log('❌ 超时（60s）——验收脚本未能在预期时间内完成')
  app.exit(1)
}, 60000)

app.whenReady().then(() => setTimeout(async () => {
  const problems = []
  let win = null
  for (let i = 0; i < 50 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] ?? null
    if (!win) await wait(100)
  }
  if (!win) { console.log('FATAL no window'); app.quit(); return }

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'))
  await wait(900)

  /**
   * 包装 executeJavaScript：任何注入脚本抛错都不该让整个验收挂住。
   * 直接把异常对象返回给调用方判断。
   */
  const js = async (s) => {
    try { return await win.webContents.executeJavaScript(s) }
    catch (e) { return { __err: String((e && e.message) || e) } }
  }
  const fail = (m) => { problems.push(m); console.log('  ! ' + m) }

  // 只放一个 lab 插件在桌面上，便于定位
  await js(`(() => {
    localStorage.setItem('workbench:state:v1', JSON.stringify({
      installed: [{ manifest: {
        id: 'lab.07', name: '倒数日', icon: '📅', category: 'tool', renderMode: 'iframe',
        entry: '/lab/plugins/07-countdown-days.html', refresh: { intervalMs: -1 },
        defaultSize: 'M', compact: { size: 'S' }
      }, visible: true, enabled: true, config: {} }],
      settings: { theme: 'light', uiScale: 100, palette: 'default' }
    }));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(3500)

  const before = await js(`(() => {
    const fr = document.querySelector('iframe');
    return { src: fr ? fr.getAttribute('src') : null,
             innerCompact: fr ? fr.contentDocument.body.classList.contains('pl-compact') : null,
             hasCw: fr ? !!fr.contentDocument.querySelector('.cw') : null };
  })()`)
  console.log('BEFORE ' + JSON.stringify(before))

  // 打开齿轮设置菜单
  await js(`document.querySelector('.gear').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await wait(700)

  const menu = await js(`(() => {
    const panel = document.querySelector('.settings-panel');
    if (!panel) return { err: 'no settings panel' };
    const sw = panel.querySelector('.view-switch');
    return { hasSwitch: !!sw, buttons: sw ? [...sw.querySelectorAll('button')].map(b => b.textContent.trim()) : [] };
  })()`)
  console.log('MENU ' + JSON.stringify(menu))
  if (!menu.hasSwitch) problems.push('设置菜单里没有「显示形态」切换')

  // 点「桌面精简」
  await js(`(() => {
    const sw = document.querySelector('.settings-panel .view-switch');
    const b = [...sw.querySelectorAll('button')].find(x => x.textContent.includes('精简'));
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(2500)

  const after = await js(`(() => {
    const fr = document.querySelector('iframe');
    return { src: fr ? fr.getAttribute('src') : null,
             innerCompact: fr ? fr.contentDocument.body.classList.contains('pl-compact') : null,
             htmlClass: fr ? fr.contentDocument.documentElement.className : null,
             hasCw: fr ? !!fr.contentDocument.querySelector('.cw') : null,
             winHidden: fr ? fr.contentWindow.getComputedStyle(fr.contentDocument.querySelector('.win')).display === 'none' : null,
             // host 模式：.cw 应无边框/圆角/阴影
             cw: (() => { if (!fr) return null; const c = fr.contentDocument.querySelector('.cw');
               if (!c) return null; const s = fr.contentWindow.getComputedStyle(c);
               return { radius: s.borderTopLeftRadius, border: s.borderTopWidth,
                        shadow: s.boxShadow === 'none' ? 'none' : 'has' }; })(),
             cwFlat: (() => { if (!fr) return null; const c = fr.contentDocument.querySelector('.cw');
               if (!c) return null; const s = fr.contentWindow.getComputedStyle(c);
               return s.borderTopWidth === '0px' && s.borderTopLeftRadius === '0px'
                      && s.boxShadow === 'none'; })(),
             cwText: fr && fr.contentDocument.querySelector('.cw') ? fr.contentDocument.querySelector('.cw').innerText.replace(/\\s+/g,' ').trim().slice(0,30) : null };
  })()`)
  console.log('AFTER  ' + JSON.stringify(after))
  if (!/\?view=host/.test(after.src || '')) problems.push('切到精简后 src 未带 ?view=host：' + after.src)
  if (!after.innerCompact) problems.push('iframe 内部未进入精简模式')
  if (!after.hasCw) problems.push('精简组件 .cw 未挂载')
  if (after.winHidden !== true) problems.push('精简模式下完整窗口未隐藏')
  // host 模式的关键收益：.cw 自身不再带窗口外壳，卡片是唯一那层窗口
  if (after.cwFlat !== true) problems.push('host 模式下 .cw 仍带边框/圆角/阴影（应已扁平化）：' + JSON.stringify(after.cw))

  // 切回完整窗口
  /* 切回完整窗口。
     齿轮是 toggle：点一次开、再点一次关。切换形态后面板仍然开着，
     所以这里先看面板在不在，不在才点齿轮（避免「点一下又关掉」）。 */
  const ensureOpen = await js(`(() => {
    if (document.querySelector('.settings-panel .view-switch')) return 'already-open';
    document.querySelector('.gear').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 'clicked-gear';
  })()`)
  console.log('ENSURE ' + ensureOpen)
  await wait(800)

  const reopened = await js(`(() => {
    const sw = document.querySelector('.settings-panel .view-switch');
    if (!sw) return { err: 'panel not open' };
    const b = [...sw.querySelectorAll('button')].find(x => x.textContent.includes('完整'));
    if (!b) return { err: 'no full button', labels: [...sw.querySelectorAll('button')].map(x => x.textContent.trim()) };
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { clicked: true };
  })()`)
  console.log('BACKCLICK ' + JSON.stringify(reopened))
  if (reopened.__err || reopened.err) fail('切回完整失败：' + JSON.stringify(reopened))
  await wait(2500)

  const back = await js(`(() => {
    const fr = document.querySelector('iframe');
    return { src: fr ? fr.getAttribute('src') : null,
             innerCompact: fr ? fr.contentDocument.body.classList.contains('pl-compact') : null,
             htmlClass: fr ? fr.contentDocument.documentElement.className : null,
             hasWin: fr ? !!fr.contentDocument.querySelector('.win') : null,
             winFlat: (() => { if (!fr) return null; const w = fr.contentDocument.querySelector('.win');
               if (!w) return null; const s = fr.contentWindow.getComputedStyle(w);
               return w.classList.contains('win-flat') && s.borderTopWidth === '0px'; })() };
  })()`)
  console.log('BACK   ' + JSON.stringify(back))
  if (/\?view=host/.test(back.src || '')) problems.push('切回完整后 src 仍带 ?view=host')
  if (!/\?view=embed/.test(back.src || '')) problems.push('切回完整后 src 应为 ?view=embed：' + back.src)
  if (back.innerCompact) problems.push('切回完整后内部仍是精简模式')
  if (!back.hasWin) problems.push('切回完整后 .win 未渲染')
  // 完整内容同样不能套两层窗口：.win 必须已扁平化
  if (back.winFlat !== true) problems.push('完整内容下 .win 未扁平化（窗口套壳回归）')

  console.log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')
  clearTimeout(HARD_TIMEOUT)
  app.exit(problems.length ? 1 : 0)
}, 400))
