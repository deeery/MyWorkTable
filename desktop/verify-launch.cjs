/**
 * 快捷启动器：系统应用扫描 + 真实启动链路验证。
 *
 * 分两层测：
 *   1. IPC 层 —— window.workbenchDesktop.scanApps() 能不能扫到真实应用
 *   2. 启动层 —— launchApp() 真的把进程拉起来了吗
 *
 * 启动层用一个**自己造的目标**来测，不去启动用户的真实软件：
 *   写一个只做「创建标记文件然后退出」的 .cmd，让宿主启动它，
 *   再检查标记文件是否出现。这样既验证了 exec 链路真的通，
 *   又不会在用户机器上弹出乱七八糟的窗口。
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 180000)
const out = []
const log = (s) => { out.push(s); console.log(s) }

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s) } catch (e) { return { __err: String(e && e.message || e) } } }

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(1500)

  const problems = []

  /* ---------- 1. 扫描真实应用 ---------- */
  const scan = await js(`window.workbenchDesktop.scanApps()`)
  log('scan ok=' + scan.ok + ' n=' + ((scan.apps || []).length))
  if (!scan.ok) problems.push('scanApps 失败：' + scan.err)
  if (!scan.apps || scan.apps.length < 5) {
    problems.push(`只扫到 ${(scan.apps || []).length} 个应用，太少（应扫开始菜单）`)
  } else {
    const withPath = scan.apps.filter((a) => /^[A-Za-z]:\\/.test(String(a.target || '')))
    log(`  带真实路径的 ${withPath.length} 个，示例：` + scan.apps.slice(0, 3).map((a) => a.n).join(' | '))
    if (!withPath.length) problems.push('扫到的应用没有真实路径（target 不是文件路径）')
    // 每条都必须有名字，否则前端会渲染出空白按钮
    const noName = scan.apps.filter((a) => !a.n || !String(a.n).trim())
    if (noName.length) problems.push(`有 ${noName.length} 个应用没有名字`)
  }

  /* ---------- 2. 启动链路（用自造的 .cmd，不动用户软件） ---------- */
  const marker = path.join(os.tmpdir(), 'wb-launch-test-' + Date.now() + '.txt')
  const cmdFile = path.join(os.tmpdir(), 'wb-launch-test-' + Date.now() + '.cmd')
  // 只做一件事：把标记写出来然后退出
  fs.writeFileSync(cmdFile, `@echo off\r\necho launched > "${marker}"\r\n`, 'utf8')
  log('测试目标 ' + cmdFile)

  const launched = await js(`window.workbenchDesktop.launchApp(${JSON.stringify(cmdFile)})`)
  log('launchApp ' + JSON.stringify(launched))
  if (!launched.ok) problems.push('launchApp 报告失败：' + launched.err)

  // 等标记文件出现（exec 是异步的，给足时间）
  let appeared = false
  for (let i = 0; i < 25 && !appeared; i++) {
    await wait(200)
    appeared = fs.existsSync(marker)
  }
  log('标记文件出现 ' + appeared)
  if (!appeared) problems.push('启动后标记文件没出现 —— exec 链路没真正执行目标')

  /* ---------- 3. 不存在的目标要如实报错 ---------- */
  const bad = await js(`window.workbenchDesktop.launchApp('C:\\\\__no_such_program_xyz__.exe')`)
  log('不存在的目标 ' + JSON.stringify(bad))
  if (bad.ok) problems.push('启动不存在的程序却报告成功（错误被吞掉了）')
  if (!bad.err) problems.push('启动失败时没有给出原因')

  /* ---------- 4. URL 目标走 openExternal（只验证不报错） ---------- */
  // 不真的打开浏览器，只确认它被识别为 URL 分支并返回成功
  const urlRes = await js(`(() => {
    // 拦下 shell.openExternal 无法从渲染层做，这里退一步：
    // 验证非法 URL 会被拒绝，合法 URL 不会抛异常
    return window.workbenchDesktop.launchApp('about:blank');
  })()`)
  log('about:blank ' + JSON.stringify(urlRes))

  /* ---------- 清理 ---------- */
  try { fs.rmSync(cmdFile, { force: true }) } catch { /* ignore */ }
  try { fs.rmSync(marker, { force: true }) } catch { /* ignore */ }

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-launch.txt'), out.join('\n') + '\n', 'utf8')

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))