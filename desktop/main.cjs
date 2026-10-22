/**
 * Workbench 桌面壳（Electron 主进程）
 * ------------------------------------------------------------
 * 把工作台作为独立桌面软件运行，并提供浏览器无法实现的能力：
 *   - 原生右键菜单（可右键桌面/卡片，含刷新、缩放、排列等）
 *   - 无边框窗口 + 前端自绘的标题栏（— □ ×）
 *   - 通过 preload 暴露受控的 IPC，而非开启 nodeIntegration
 *
 * ## 为什么去掉原生菜单栏与标题栏
 *
 * 原来窗口顶部有 Electron 默认的「文件 / 编辑 / 视图 / 帮助」菜单栏和系统
 * 标题栏，两样都是浏览器/系统味，跟工作台自己的视觉语言对不上：菜单栏那几项
 * （撤销、全选、缩放）日常几乎没人点，却常驻占掉一整行；系统标题栏在深色主题下
 * 还是浅色的，与 OLED 纯黑的界面接不上。
 *
 * 现在改为 `frame: false` + `Menu.setApplicationMenu(null)`，由前端
 * （`src/components/TitleBar.tsx`）画一条标题栏，用 IPC 控制窗口。
 *
 * ⚠ **菜单没了，快捷键不能跟着没**。`setApplicationMenu(null)` 会连带
 * 干掉菜单项上注册的 accelerator（Ctrl+R / Ctrl+Shift+I …），所以这里用
 * `before-input-event` 自己接回来，见 `bindShortcuts()`。
 *
 * 开发模式（--dev 或 WORKBENCH_DEV=1）：加载 Vite dev server，
 * 以便天气插件的 /wapi 代理可用。
 * 生产模式：加载 dist/ 下的静态构建产物。
 */
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { exec } = require('node:child_process')

const DEV = process.argv.includes('--dev') || process.env.WORKBENCH_DEV === '1'
// 验收脚本自己会加载 dist/，此处不要抢先加载 dev server
const VERIFY = process.env.WORKBENCH_VERIFY === '1'
const DEV_URL = process.env.WORKBENCH_URL || 'http://localhost:5173'
const ROOT = path.join(__dirname, '..')
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html')

/** @type {BrowserWindow | null} */
let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    // 与 global.css 的 --bg 保持一致，避免加载前闪一帧别的颜色。
    // （深色主题提亮过一档：原来是纯黑 #000000，见 global.css 顶部注释）
    backgroundColor: '#0e1117',
    title: 'Workbench · 插件式工作台',
    // 验收脚本下不显示窗口（离屏渲染即可截图/取 DOM），避免测试时弹窗
    show: !VERIFY,
    // 无边框：标题栏与菜单栏都交给前端画（src/components/TitleBar.tsx）。
    // 保留 resizable / 系统缩放手势，只是不画系统那一行。
    // 保留最小化/最大化/关闭的系统能力，由 IPC 驱动。
    frame: false,
    // Windows 上 frame:false 会连带去掉窗口阴影与圆角，用 roundedCorners
    // 保持系统圆角（Win11），阴影由系统按 DWM 规则补。
    roundedCorners: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // 安全基线：不开启 nodeIntegration，contextIsolation 保持开启，
      // 渲染进程只能通过 preload 暴露的白名单 API 与主进程通信。
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      // 离屏时也允许后台节流关闭，保证 requestAnimationFrame 正常跑
      backgroundThrottling: false,
    },
  })

  // 有些平台（尤其 Windows）在 frame:false 下仍会尝试显示菜单，显式清掉
  win.setMenuBarVisibility(false)

  // 最大化状态变化要让前端知道（□ 与 ❐ 两种图标），
  // 否则用户双击标题栏最大化后按钮图标还是「最大化」。
  const pushMaxState = () => {
    win?.webContents.send('workbench:command', { type: 'win-max-changed', maximized: !!win?.isMaximized() })
  }
  win.on('maximize', pushMaxState)
  win.on('unmaximize', pushMaxState)

  if (DEV && !VERIFY) {
    win.loadURL(DEV_URL)
  } else {
    if (!fs.existsSync(DIST_INDEX)) {
      dialog.showErrorBox(
        '未找到构建产物',
        `请先运行 pnpm build 生成 dist/，再启动桌面版。\n\n期望路径：\n${DIST_INDEX}`,
      )
      app.quit()
      return
    }
    win.loadFile(DIST_INDEX)
  }

  // 外部链接一律交给系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => { win = null })
}

/* ---------------- 菜单与快捷键 ---------------- */

/**
 * 清掉原生应用菜单。
 *
 * 用户明确要求「隐藏网页 文件/编辑/视图/帮助 列」—— 这一行是 Electron 默认
 * 套上来的，与工作台自己的界面毫无关系，还常驻占掉一整行高度。
 *
 * 注意：传 `null` 是**真的把菜单摘掉**（Windows/Linux 上整条菜单栏消失），
 * 而 `autoHideMenuBar` 只是「按 Alt 才冒出来」，仍然会在按 Alt 时闪出。
 * 两者都做，确保任何输入下都不出现。
 */
function hideAppMenu() {
  Menu.setApplicationMenu(null)
}

/**
 * 把菜单项的快捷键接回来。
 *
 * ⚠ **这是删菜单最容易踩的坑**：accelerator 原本注册在菜单项上，
 * `setApplicationMenu(null)` 会连同它一起销毁 —— Ctrl+R 不再刷新、
 * Ctrl+Shift+I 打不开开发者工具、Ctrl+0/+/- 的缩放全失效，
 * 而且没有任何报错，用户只会觉得「软件坏了」。
 *
 * 所以在窗口上自己接一份。用 `before-input-event` 而不是 `globalShortcut`：
 * 后者是全局的（别的应用也抢），且窗口失焦后仍会触发。
 */
function bindShortcuts(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const ctrl = input.control || input.meta
    const key = (input.key || '').toLowerCase()

    if (ctrl && input.shift && key === 'i') {
      event.preventDefault(); win.webContents.toggleDevTools(); return
    }
    if (ctrl && key === 'r') {
      event.preventDefault(); win.webContents.reload(); return
    }
    // F12 也开开发者工具（Windows 习惯）
    if (key === 'f12') { event.preventDefault(); win.webContents.toggleDevTools(); return }
    if (key === 'f11') { event.preventDefault(); win.setFullScreen(!win.isFullScreen()); return }
    if (ctrl && (key === '0' || key === '=' || key === '+' || key === '-')) {
      event.preventDefault()
      const wc = win.webContents
      if (key === '0') wc.setZoomLevel(0)
      else if (key === '-') wc.setZoomLevel(wc.getZoomLevel() - 0.5)
      else wc.setZoomLevel(wc.getZoomLevel() + 0.5)
    }
  })
}

/**
 * 「关于 Workbench」原来挂在帮助菜单下。菜单没了之后改挂到桌面空白处的
 * 右键菜单里（见 workbench:context-menu 的 blank 分支）—— 功能不该因为
 * 藏掉菜单栏就一起消失。
 */
function showAbout() {
  dialog.showMessageBox(win ?? undefined, {
    type: 'info',
    title: '关于 Workbench',
    message: 'Workbench · 插件式工作台',
    detail: [
      `版本：${app.getVersion()}`,
      `Electron：${process.versions.electron}`,
      `Chromium：${process.versions.chrome}`,
      `模式：${DEV ? '开发（加载 dev server）' : '生产（加载 dist/）'}`,
    ].join('\n'),
  })
}

/* ---------------- 窗口控制（自绘标题栏用） ---------------- */
// 前端 TitleBar 的三个按钮与拖拽区域通过这几个通道驱动真实窗口。
// 全部走 ipcMain.handle，不暴露任何 BrowserWindow 实例给渲染进程。
ipcMain.handle('workbench:win', async (_e, payload) => {
  if (!win) return { ok: false }
  const action = payload?.action
  if (action === 'minimize') win.minimize()
  else if (action === 'toggle-maximize') {
    if (win.isMaximized()) win.unmaximize(); else win.maximize()
  }
  else if (action === 'close') win.close()
  return { ok: true, maximized: win.isMaximized(), fullScreen: win.isFullScreen() }
})

/** 标题栏挂载时问一次当前状态（最大化图标要画对） */
ipcMain.handle('workbench:win-state', async () => {
  if (!win) return { maximized: false, fullScreen: false }
  return { maximized: win.isMaximized(), fullScreen: win.isFullScreen() }
})

/* ---------------- 原生右键菜单 ---------------- */
// 渲染进程通过 preload 的 api.showContextMenu(payload) 触发，
// 由主进程按 payload.kind 弹出对应的原生菜单。
ipcMain.handle('workbench:context-menu', async (_e, payload) => {
  const kind = payload?.kind ?? 'blank'
  const data = payload?.data ?? {}
  /** @type {Electron.MenuItemConstructorOptions[]} */
  let items = []

  if (kind === 'card') {
    items = [
      {
        label: `刷新「${data.name ?? ''}」`,
        enabled: !!data.canRefresh,
        click: () => win?.webContents.send('workbench:command', { type: 'refresh', id: data.id }),
      },
      {
        label: '设置…',
        click: () => win?.webContents.send('workbench:command', { type: 'settings', id: data.id }),
      },
      { type: 'separator' },
      {
        label: '置顶',
        click: () => win?.webContents.send('workbench:command', { type: 'focus', id: data.id }),
      },
      {
        label: '还原尺寸',
        click: () => win?.webContents.send('workbench:command', { type: 'reset-size', id: data.id }),
      },
      { type: 'separator' },
      {
        // 多窗口之后「移出桌面」的语义变成「关闭这个窗口」——
        // 只关这一张卡片，同一插件的其他窗口不受影响。
        label: '关闭这个窗口',
        click: () => win?.webContents.send('workbench:command', { type: 'toggle-visible', id: data.id }),
      },
      {
        label: data.enabled ? '停用插件' : '启用插件',
        click: () => win?.webContents.send('workbench:command', { type: 'toggle-enabled', id: data.id }),
      },
      { type: 'separator' },
      {
        label: '卸载插件（关闭其全部窗口）',
        click: () => win?.webContents.send('workbench:command', { type: 'uninstall', id: data.id }),
      },
    ]
  } else if (kind === 'blank') {
    items = [
      {
        label: '新建窗口…',
        click: () => win?.webContents.send('workbench:command', { type: 'open-add' }),
      },
      { type: 'separator' },
      {
        label: '复位视图',
        click: () => win?.webContents.send('workbench:command', { type: 'reset-view' }),
      },
      {
        label: '放大',
        click: () => win?.webContents.send('workbench:command', { type: 'zoom-in' }),
      },
      {
        label: '缩小',
        click: () => win?.webContents.send('workbench:command', { type: 'zoom-out' }),
      },
      { type: 'separator' },
      { label: '刷新', click: () => win?.webContents.reload() },
      { type: 'separator' },
      // 原生菜单栏没了之后，「关于」改挂在这里 —— 功能不该跟着菜单栏一起消失
      { label: '关于 Workbench', click: () => showAbout() },
    ]
  } else {
    // 文本输入区：给出标准编辑项
    items = [
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { type: 'separator' },
      { role: 'selectAll', label: '全选' },
    ]
  }

  const menu = Menu.buildFromTemplate(items)
  menu.popup({ window: win ?? undefined })
  return true
})

/* ---------------- 应用清单与启动 ---------------- */

/**
 * 扫描开始菜单，拿到系统里真实安装的应用与图标。
 *
 * 为什么不用硬编码清单：用户要的是「菜单里有什么就能启动什么」。
 * 硬编码的假列表既不全（漏掉用户自己装的软件），启动时也什么都没做。
 *
 * 只取 .lnk / .url / .exe 三类，并按名称去重。限制在开始菜单的几个
 * 标准目录内，避免把 node_modules、构建产物之类扫进来。
 */
function scanApps() {
  const roots = []
  const push = (p) => { try { if (fs.existsSync(p)) roots.push(p) } catch (e) { /* 无权限就跳过 */ } }

  const programData = process.env.ProgramData || 'C:\\ProgramData'
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')

  push(path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  // 部分系统把所有用户快捷方式放在这里
  push(path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'))

  const out = []
  const seen = new Set()
  const MAX = 400

  const walk = (dir, depth) => {
    if (depth > 3 || out.length >= MAX) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
    for (const ent of entries) {
      if (out.length >= MAX) return
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) { walk(full, depth + 1); continue }
      const lower = ent.name.toLowerCase()
      if (!/\.(lnk|url|exe)$/.test(lower)) continue
      // 卸载程序与维护工具对用户没价值，且容易扫出一堆
      if (/uninstall|卸载|maintenance|帮助|help|readme|文档|manual|crash|report/i.test(ent.name)) continue

      let name = ent.name.replace(/\.(lnk|url|exe)$/i, '')
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      out.push({
        id: 'app-' + out.length + '-' + key.slice(0, 24).replace(/[^a-z0-9]+/g, '-'),
        n: name,
        // 图标：开始菜单里就是应用自己的图标，这里用文件名回退到 emoji 标识
        ic: lower.endsWith('.exe') ? '🖥️' : lower.endsWith('.url') ? '🌐' : '🔗',
        c: 'app',
        col: '#0ea5e9',
        py: '',
        // target 交给启动函数解析（.lnk 会读它指向的真实目标）
        target: full,
      })
    }
  }

  roots.forEach((r) => walk(r, 0))
  return out
}

/**
 * 读取 .lnk 指向的真实目标。
 *
 * 直接 exec 一个 .lnk 通常也能启动，但报错时拿不到有用的 err；
 * 而且部分系统对 lnk 的默认动作是「属性」。读出来再用 exec 执行目标
 * 更稳，失败时也能把真实原因回报给前端。
 */
function resolveLnkTarget(lnkPath) {
  try {
    const ps = [
      '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($args[0])',
      'Write-Output $s.TargetPath',
      'Write-Output $s.Arguments',
    ].join('; ')
    const out = require('node:child_process').execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps, lnkPath],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    )
    const lines = out.split(/\r?\n/).filter(Boolean)
    return { exe: (lines[0] || '').trim(), args: (lines[1] || '').trim() }
  } catch (e) {
    return { exe: '', args: '' }
  }
}

/**
 * 启动一个应用。
 *
 * 分三类处理：
 *   http(s)://  → shell.openExternal（交给系统默认浏览器）
 *   .url        → 同上，读里面的 URL
 *   其余         → exec；若是 .lnk 先解析出真正的可执行文件
 *
 * 回调带 ok / err，前端据此在脚部给出真实反馈（以前是假 toast）。
 */
function launchApp(target, cb) {
  const t = String(target || '').trim()
  if (!t) { cb(false, '没有指定目标'); return }

  if (/^https?:\/\//i.test(t)) {
    shell.openExternal(t).then(() => cb(true, '')).catch((e) => cb(false, String(e && e.message || e)))
    return
  }

  if (/\.url$/i.test(t)) {
    let url = ''
    try {
      const raw = fs.readFileSync(t, 'utf8')
      const m = raw.match(/^\s*URL\s*=\s*(.+)$/mi)
      if (m) url = m[1].trim()
    } catch (e) { cb(false, '读取快捷方式失败'); return }
    if (!url) { cb(false, '快捷方式里没有 URL'); return }
    shell.openExternal(url).then(() => cb(true, '')).catch((e) => cb(false, String(e && e.message || e)))
    return
  }

  /**
   * 路径型目标先确认文件真的在。
   *
   * 为什么必须自己查：Windows 上 exec 是经 cmd.exe /c 执行的，
   * 目标不存在时 cmd.exe 自己启动成功、只是返回退出码 1，
   * err.code 是个数字而不是 'ENOENT' —— 只看 err.code 会把
   * 「找不到程序」当成启动成功（实测确实如此）。
   * 先判存在性，错误信息也更有用（能直接告诉用户是哪个路径不对）。
   */
  const looksLikePath = /^[A-Za-z]:[\\/]/.test(t) || t.startsWith('\\\\') || t.includes('\\') || t.includes('/')
  if (looksLikePath && !fs.existsSync(t)) {
    cb(false, '找不到文件：' + t)
    return
  }

  let exe = t
  let args = ''
  if (/\.lnk$/i.test(t)) {
    const r = resolveLnkTarget(t)
    if (!r.exe) { cb(false, '无法解析快捷方式的目标'); return }
    exe = r.exe
    args = r.args
    if (!fs.existsSync(exe)) { cb(false, '快捷方式指向的程序不存在：' + exe); return }
  }

  // 带空格/中文的路径必须整体加引号，否则 exec 会按空格拆开导致「找不到文件」
  const quoted = (s) => (/[\s"'&|<>^]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s)
  const cmd = quoted(exe) + (args ? ' ' + args : '')

  exec(cmd, { windowsHide: true, timeout: 8000 }, (err) => {
    // 注意：很多程序（尤其 GUI 程序）exec 回调里的 err 不表示启动失败 ——
    // 只要进程起来就算成功，非零退出码是程序自己的事。
    // 真正的启动失败是「系统级错误码」（字符串），不是退出码（数字）。
    if (err && typeof err.code === 'string') {
      cb(false, err.code === 'ENOENT' ? '找不到程序：' + exe
        : err.code === 'EACCES' ? '没有权限启动：' + exe
        : '启动失败：' + (err.message || err.code))
      return
    }
    cb(true, '')
  })
}

ipcMain.handle('workbench:scan-apps', async () => {
  try { return { ok: true, apps: scanApps() } } catch (e) { return { ok: false, err: String(e && e.message || e) } }
})

ipcMain.handle('workbench:launch-app', async (_e, payload) => {
  const target = payload?.target
  return new Promise((resolve) => {
    launchApp(target, (ok, err) => resolve({ ok, err: err || '' }))
  })
})

/* ---------------- 生命周期 ---------------- */

// 单实例：避免重复启动
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    hideAppMenu()
    createWindow()
    if (win) bindShortcuts(win)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
