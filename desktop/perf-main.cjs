/**
 * 主线程表现探针：绕开「离屏窗口不产生合成帧」这个环境限制。
 *
 * 帧间隔（rAF）在 show:false 的窗口里会被节流到 ~1fps，量出来的数字没有意义。
 * 所以这里改量两个不依赖合成帧的指标：
 *   1. longtask（>50ms 的主线程任务）—— 任务调度不受合成器节流影响
 *   2. 交互提交耗时 —— 从点击到 DOM 真的更新（用 MutationObserver 掐表）
 *
 * 用法：
 *   $env:WORKBENCH_DEV='1'; electron.exe desktop\perf-main.cjs
 */
process.env.WORKBENCH_DEV = '1'
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 180000)

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 80 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] ?? null
    if (!win) await wait(100)
  }
  if (!win) { console.log('NO WINDOW'); app.exit(1); return }
  win.setSize(1400, 900)
  await wait(2000)

  const js = async (s) => {
    try { return await win.webContents.executeJavaScript(s) }
    catch (e) { return { __err: String((e && e.message) || e) } }
  }

  await win.loadURL('about:blank')
  await wait(400)
  await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
  await win.loadURL(process.env.AUDIT_URL || 'http://localhost:5173/')
  await wait(2400)

  /* 装 longtask 观察器 */
  await js(`(() => {
    window.__lt = []
    try {
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) { window.__lt.push({ d: Math.round(e.duration), name: e.name }) })
      }).observe({ entryTypes: ['longtask'] })
      window.__ltOk = true
    } catch (e) { window.__ltOk = String(e.message) }
    return window.__ltOk
  })()`)

  /* 造出 9 个窗口：默认 3 个 + 再开 6 个 */
  for (let k = 0; k < 6; k++) {
    await js(`(() => { var b=document.querySelector('.dock-launch'); if(b)b.click(); return !!b })()`)
    await wait(500)
    await js(`(() => { var it=[...document.querySelectorAll('.dock-item')][0]; if(it)it.click(); return !!it })()`)
    await wait(650)
  }
  await wait(1200)
  await js(`window.__lt = []`)

  console.log('════ 1. 空闲 5 秒（9 窗口 + 每秒 tick）的 longtask ════')
  await wait(5000)
  console.log('  ', JSON.stringify(await js(`({ ok: window.__ltOk, count: window.__lt.length, items: window.__lt.slice(0, 10) })`)))

  /* 交互提交耗时：点导航项 → 等到 .nav-item.active 换人 */
  console.log('\n════ 2. 页面切换的提交耗时（点 → DOM 更新）════')
  const navTimings = []
  for (const label of ['插件', '设置', '我的', '桌面']) {
    const t = await js(`(async () => {
      var target = ${JSON.stringify(label)}
      var el = [...document.querySelectorAll('.nav-item')].find(function (x) { return x.textContent.includes(target) })
      if (!el) return 'no-el'
      var t0 = performance.now()
      el.click()
      await new Promise(function (res) {
        var mo = new MutationObserver(function () {
          var cur = document.querySelector('.nav-item.active')
          if (cur && cur.textContent.includes(target)) { mo.disconnect(); res() }
        })
        mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] })
        setTimeout(function () { mo.disconnect(); res() }, 2000)
      })
      return +(performance.now() - t0).toFixed(1)
    })()`)
    navTimings.push(`${label}=${t}ms`)
    await wait(400)
  }
  console.log('  ' + navTimings.join('  '))

  /* 主题切换提交耗时（改 data-theme + 全站重算样式） */
  console.log('\n════ 3. 主题切换的提交耗时（点 → data-theme 变更）════')
  const themeT = await js(`(async () => {
    var nav = [...document.querySelectorAll('.nav-item')].find(function (x) { return x.textContent.includes('设置') })
    if (nav) nav.click()
    await new Promise(function (r) { setTimeout(r, 700) })
    var btn = [...document.querySelectorAll('.btn')].find(function (x) { return x.textContent.trim() === '浅色' })
    if (!btn) return 'no-btn'
    var t0 = performance.now()
    btn.click()
    await new Promise(function (res) {
      var mo = new MutationObserver(function () {
        if (document.documentElement.getAttribute('data-theme') === 'light') { mo.disconnect(); res() }
      })
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      setTimeout(function () { mo.disconnect(); res() }, 2000)
    })
    var commit = performance.now() - t0
    // 再强制一次全站样式重算 + 布局，量「最坏情况」的同步代价
    var t1 = performance.now()
    void document.body.offsetHeight
    var reflow = performance.now() - t1
    return { commitMs: +commit.toFixed(1), forcedReflowMs: +reflow.toFixed(2) }
  })()`)
  console.log('  ', JSON.stringify(themeT))

  console.log('\n════ 4. 6 秒 idle 期间累计 longtask ════')
  await js(`window.__lt = []`)
  await wait(6000)
  const lt = await js(`({ count: window.__lt.length, total: window.__lt.reduce(function (a, b) { return a + b.d }, 0), items: window.__lt.slice(0, 10) })`)
  console.log('  ', JSON.stringify(lt))

  app.exit(0)
}, 1200))
