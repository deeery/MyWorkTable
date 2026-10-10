/**
 * ============ Workbench module 插件：便签 ============
 * 契约：export default (ctx) => ({ mount, unmount, onTick?, onThemeChange?, onResize? })
 * 数据通过 ctx.storage（宿主注入的命名空间 KV）持久化。
 */
export default function create(ctx) {
  let root = null
  let textarea = null
  let saveTimer = null

  const css = (theme) => `
    .notes-root{height:100%;display:flex;flex-direction:column;font-family:inherit;}
    .notes-ta{flex:1;width:100%;border:none;outline:none;resize:none;padding:12px 14px;font-size:13px;line-height:1.7;
      background:transparent;color:${theme === 'dark' ? '#dfe3f0' : '#23263a'};}
    .notes-foot{padding:4px 12px 8px;font-size:11px;color:${theme === 'dark' ? '#7d84a3' : '#8a90a6'};text-align:right;}
  `

  const applyTheme = (theme) => {
    root.querySelector('style').textContent = css(theme)
  }

  return {
    mount(container) {
      container.innerHTML = ''
      root = document.createElement('div')
      root.className = 'notes-root'
      root.innerHTML = `
        <style>${css(ctx.getTheme())}</style>
        <textarea class="notes-ta" placeholder="随手记点什么…" spellcheck="false"></textarea>
        <div class="notes-foot"></div>
      `
      container.appendChild(root)
      textarea = root.querySelector('textarea')

      // 恢复持久化内容（声明 permissions.storage 后可用）
      const saved = ctx.storage.get('content')
      if (typeof saved === 'string') textarea.value = saved

      // 防抖保存
      textarea.addEventListener('input', () => {
        clearTimeout(saveTimer)
        root.querySelector('.notes-foot').textContent = '输入中…'
        saveTimer = setTimeout(() => {
          ctx.storage.set('content', textarea.value)
          const n = textarea.value.trim().length
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
    onThemeChange: applyTheme,
  }
}
