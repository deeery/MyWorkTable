/**
 * ============ Workbench module 插件：便签 ============
 * 可编辑便签 + 字体大小调节 + 背景/文本配色 + 内容自动持久化。
 *
 * 外观配置（fontSize / bg / fg）由宿主经 PluginContext.config 下发，
 * 插件通过 onConfigChange 回调实时应用；内容仍走 ctx.storage 持久化。
 */
export default function create(ctx) {
  let root = null, textarea = null, saveTimer = null

  /**
   * 解析字号：优先级为 宿主 config > 本地 storage（兼容旧数据）> 默认值。
   *
   * 两个坑：
   *  1. 不能用 `Number(x) ?? y`——Number(undefined) 得 NaN，而 NaN ?? y 仍是 NaN，
   *     样式会写成 `NaNpx`（被浏览器忽略），按钮高亮判定也会失效。
   *  2. 不能用 `Number.isFinite(Number(x))` 判存在性——Number(null) 是 0 且有限，
   *     会把「未设置」误判成字号 0，再被夹成下限。
   * 因此这里要求值必须是非空字符串（或有限数字）才采纳。
   */
  function parseFontSize(v) {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(24, Math.max(10, n)) : null
  }

  function resolveFontSize(cfg) {
    return parseFontSize(cfg?.fontSize)
      ?? parseFontSize(ctx.storage.get('fontSize'))
      ?? 13
  }

  let fontSize = resolveFontSize(ctx.config)
  // 外观：便签就是一张纸，**维持原来的纸面白**，不随主题变暗。
  //
  // 曾经试过深色下改成 var(--card)（暗块），看起来不像便签了 —— 便签的本体
  // 就是「一张浅色纸」，把它压暗等于丢掉「它是什么东西」这个信息。
  //
  // 但原来有一处真 bug 必须保留修复：默认文字色是
  //   ctx.getTheme() === 'dark' ? '#dfe3f0' : '#23263a'
  // 深色主题下给白纸配了浅色字 —— 白底浅字，几乎看不见。纸面固定为白，
  // 墨水就必须固定为深色，跟主题无关。
  //
  // 存的是「用户的选择」而不是「算好的颜色」：空串 = 用默认值。
  let bgOverride = typeof ctx.config?.bg === 'string' ? ctx.config.bg : ''
  let fgOverride = typeof ctx.config?.fg === 'string' ? ctx.config.fg : ''

  /** 纸面：用户选过的配色 > 原来的白 */
  const bgFor = () => bgOverride || '#ffffff'
  /** 墨水：用户选过的配色 > 纸面白对应的深墨（浅色主题的正文色） */
  const fgFor = () => fgOverride || '#23263a'
  // 字体族：'inherit' 表示跟随界面默认
  let font = ctx.config?.font || 'inherit'

  const css = () => `
    .notes-root{height:100%;display:flex;flex-direction:column;background:${bgFor()};}
    .notes-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:4px 12px;border-bottom:1px solid rgba(0,0,0,.10);font-size:11px;color:#5b6478;font-family:inherit;}
    .notes-ta{flex:1;width:100%;border:none;outline:none;resize:none;padding:8px 12px;font-size:${fontSize}px;line-height:1.7;background:transparent;color:${fgFor()};user-select:text;font-family:${font};}
    .notes-foot{padding:4px 12px 8px;font-size:11px;color:#5b6478;text-align:right;font-family:inherit;}
  `

  const apply = () => {
    if (!root) return
    root.querySelector('style').textContent = css()
    if (textarea) {
      // textarea 有内联 color，会盖过样式表，所以这里必须跟着重算
      textarea.style.color = fgFor()
      textarea.style.fontFamily = font
    }
  }

  return {
    mount(container) {
      container.innerHTML = ''
      root = document.createElement('div')
      root.className = 'notes-root'
      root.innerHTML = `
        <style>${css()}</style>
        <div class="notes-toolbar">
          <span class="word-count"></span>
        </div>
        <textarea class="notes-ta" placeholder="随手记点什么…" spellcheck="false"></textarea>
        <div class="notes-foot"></div>
      `
      container.appendChild(root)
      textarea = root.querySelector('textarea')

      // 字体大小不再在工具栏常驻显示，改由宿主设置菜单（齿轮）统一调节。
      // 这里只从 config 读取并应用，不再渲染调节按钮。
      const saved = ctx.storage.get('content')
      if (typeof saved === 'string') textarea.value = saved
      fontSize = resolveFontSize(ctx.config)
      textarea.style.fontSize = fontSize + 'px'
      apply()

      // 防抖保存 + 字数统计
      textarea.addEventListener('input', () => {
        clearTimeout(saveTimer)
        root.querySelector('.notes-foot').textContent = '输入中…'
        const n = textarea.value.trim().length
        root.querySelector('.word-count').textContent = n + ' 字'
        saveTimer = setTimeout(() => {
          ctx.storage.set('content', textarea.value)
          root.querySelector('.notes-foot').textContent = n ? `已保存 · ${n} 字` : ''
        }, 400)
      })
    },

    unmount() {
      clearTimeout(saveTimer)
      if (textarea) ctx.storage.set('content', textarea.value)
      if (root) root.remove()
      root = textarea = null
    },

    onThemeChange: apply,
    onConfigChange(cfg) {
      let changed = false
      if (cfg && cfg.fontSize !== undefined) {
        const n = parseFontSize(cfg.fontSize)
        if (n !== null) {
          fontSize = n
          // mount 时给 textarea 设了内联 font-size，它会盖过样式表，
          // 因此这里必须同步更新内联样式，否则字号改了也看不出变化。
          if (textarea) textarea.style.fontSize = fontSize + 'px'
          changed = true
        }
      }
      // bg/fg 用「覆盖」语义：空串 = 用纸面白 / 深墨默认（见 bgFor / fgFor）
      if (cfg && cfg.bg !== undefined) { bgOverride = cfg.bg || ''; changed = true }
      if (cfg && cfg.fg !== undefined) { fgOverride = cfg.fg || ''; changed = true }
      if (cfg && cfg.font !== undefined) { font = cfg.font || 'inherit'; changed = true }
      if (changed) apply()
    },
  }
}