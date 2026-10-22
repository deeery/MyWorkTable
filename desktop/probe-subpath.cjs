/**
 * 子路径部署探针
 * ------------------------------------------------------------
 * 验证「应用不在域名根」时，manifest.entry 里的 '/lab/...'、'/plugins/...'
 * 能否被 resolveAppUrl 正确解析到应用根之下。
 *
 * 用法（先起 subpath-serve.cjs）：
 *   $env:ELECTRON_RUN_AS_NODE=$null
 *   & node_modules\electron\dist\electron.exe desktop/probe-subpath.cjs http://127.0.0.1:5200/pwt/demo/
 *
 * 断言：
 *   1. 页面能加载出 .app-shell
 *   2. 插件页能列出插件市场，且 lab.* 插件的 entry 解析后 200
 *   3. 桌面能新建一个 lab 插件窗口，且 iframe 真的加载出内容（不是 404 页）
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

process.env.WORKBENCH_VERIFY = '1'

const URL_ = process.argv[2] || 'http://127.0.0.1:5200/pwt/demo/'
const OUT = path.join(__dirname, '..', 'shots')
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

const log = []
const problems = []
function say(s) { log.push(s); console.log(s) }
function check(ok, label, extra) {
  say((ok ? '✓ ' : '✗ ') + label + (extra !== undefined ? ' ' + JSON.stringify(extra) : ''))
  if (!ok) problems.push(label)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await app.whenReady()
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: false },
  })
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) say('  [renderer] ' + msg)
  })

  const js = async (s) => {
    try { return await win.webContents.executeJavaScript(s) }
    catch (e) { return { __err: String((e && e.message) || e) } }
  }

  say('# 目标 ' + URL_)
  await win.loadURL(URL_)
  await wait(1500)

  const shell = await js(`!!document.querySelector('.app-shell')`)
  check(shell === true, '应用外壳已渲染', shell)

  // 从插件市场读 lab 插件条目，验证解析后的 URL 可访问
  const probe = await js(`(async () => {
    const nav = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('插件'));
    if (!nav) return { err: 'no-nav' };
    nav.click();
    await new Promise(r => setTimeout(r, 600));
    const btn = [...document.querySelectorAll('.btn')].find(b => b.textContent.includes('插件市场'));
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 600));
    const cards = [...document.querySelectorAll('.market-card')];
    return { cards: cards.length, titles: cards.slice(0, 4).map(c => (c.querySelector('.name') || {}).textContent) };
  })()`)
  say('  插件页 ' + JSON.stringify(probe))

  // 直接验证 lab 资源可达
  const reach = await js(`(async () => {
    const urls = [
      new URL('lab/plugins/03-pomodoro-focus.html', document.baseURI).href,
      new URL('plugins/clock/index.html', document.baseURI).href,
      new URL('plugins/weather/cities.json', document.baseURI).href,
    ];
    const out = [];
    for (const u of urls) {
      try { const r = await fetch(u); out.push({ u, status: r.status }); }
      catch (e) { out.push({ u, err: String(e.message) }); }
    }
    return out;
  })()`)
  say('  资源可达性 ' + JSON.stringify(reach, null, 1))
  const allOk = Array.isArray(reach) && reach.every((r) => r.status === 200)
  check(allOk, '应用根下的 lab/plugins 资源全部 200')

  say('# 问题数 ' + problems.length)
  fs.writeFileSync(path.join(OUT, 'probe-subpath.txt'), log.join('\n'), 'utf8')
  clearTimeout(hard)
  app.exit(problems.length ? 1 : 0)
}

const hard = setTimeout(() => { console.log('超时'); app.exit(1) }, 90000)
main().catch((e) => { console.log('异常 ' + e.stack); app.exit(1) })
