/**
 * Workbench 桌面壳 —— preload
 * ------------------------------------------------------------
 * 在 contextIsolation 开启的前提下，只向渲染进程暴露一组白名单 API：
 *   - showContextMenu(payload)  弹出原生右键菜单
 *   - onCommand(handler)        接收主进程发来的菜单命令
 *   - isDesktop / platform      让前端识别自己跑在桌面壳里
 *   - scanApps()                扫描系统安装的应用（快捷启动器用）
 *   - launchApp(target)         启动一个应用
 *   - winControl(action)        自绘标题栏的最小化/最大化/关闭
 *   - winState()                问一次当前最大化状态（图标要画对）
 *
 * 不暴露任何 Node 能力（fs / child_process / require 均不可达），
 * 也不把 BrowserWindow 实例递给渲染进程 —— 只能按 action 名调用。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('workbenchDesktop', {
  isDesktop: true,
  platform: process.platform,

  /** 弹出原生右键菜单。payload: { kind: 'card'|'blank'|'text', data?: object } */
  showContextMenu: (payload) => ipcRenderer.invoke('workbench:context-menu', payload),

  /**
   * 订阅主进程菜单命令。
   * 返回取消订阅函数；只转发 payload，不泄露 event 对象。
   */
  onCommand: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('workbench:command', listener)
    return () => ipcRenderer.removeListener('workbench:command', listener)
  },

  /**
   * 扫描系统安装的应用（开始菜单里的快捷方式与可执行文件）。
   * 返回 { ok, apps } —— apps 每项含 id / n / ic / c / col / py / target。
   */
  scanApps: () => ipcRenderer.invoke('workbench:scan-apps'),

  /** 启动一个应用。target 可以是命令名、URL、文件路径或 .lnk 快捷方式。 */
  launchApp: (target) => ipcRenderer.invoke('workbench:launch-app', { target }),

  /**
   * 窗口控制。action 只接受三个白名单值：
   * 'minimize' | 'toggle-maximize' | 'close'
   * 返回 { ok, maximized, fullScreen }，方便调用方立刻同步图标。
   */
  winControl: (action) => ipcRenderer.invoke('workbench:win', { action }),

  /** 读一次窗口状态（TitleBar 首次挂载时用） */
  winState: () => ipcRenderer.invoke('workbench:win-state'),
})
