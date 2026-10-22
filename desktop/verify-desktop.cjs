/**
 * 验收：把 plugin-lab 镜像插件装到桌面上，确认它真的能渲染。
 *
 * 这是「迁移为 MyWorkTable 真插件」的端到端证据：不只是出现在插件市场，
 * 而是要真的装上去、出现在桌面上、iframe 内的 .win 渲染出来、主题跟上。
 *
 * 复用 desktop/main.cjs 的真实主进程逻辑（WORKBENCH_VERIFY=1 时不显示窗口）。
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

require('./main.cjs')

app.whenReady().then(() => setTimeout(async () => {
  const problems = []
  let win = null
  for (let i = 0; i < 50 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] ?? null
    if (!win) await wait(100)
  }
  if (!win) { console.log('FATAL 主进程未创建窗口'); app.quit(); return }

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'))
  await wait(1000)
  await win.webContents.executeJavaScript('localStorage.clear(); true')
  await win.webContents.reload()
  await wait(1800)

  const js = (s) => win.webContents.executeJavaScript(s)

  /* 1) 插件市场里应有 19 个 lab 插件 */
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('插件')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)
  await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('插件市场')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(500)

  const market = await js(`(() => {
    const names = [...document.querySelectorAll('.market-card')].map(c => c.textContent);
    const LAB = ['快递追踪','截图贴图','呼吸放松','药品管家','喝水提醒','番茄专注','久坐管家','待办清单','倒数日','快捷启动器','音乐播放器','世界时钟','快速便签','天气小部件','窗口布局','计时秒表','习惯打卡','会议提醒','勿扰模式','桌面宠物','音量混合器','亮度色温'];
    return { total: document.querySelectorAll('.market-card').length, labFound: LAB.filter(n => names.some(t => t.includes(n))).length };
  })()`)
  console.log('MARKET ' + JSON.stringify(market))
  if (market.labFound !== 22) problems.push('插件市场里 lab 插件数不是 22：' + market.labFound)

  /* 2) 安装全部 lab 插件（按 id 前缀判断，比按名称更稳） */
  const installed = await js(`(() => {
    let n = 0;
    document.querySelectorAll('.market-card').forEach(c => {
      // 名称清单容易漏，改为「有安装按钮且属于 lab 前缀」判断：
      // 市场卡片上会显示 id 或名称，这里退回按名称清单 + 兜底全部可安装项
      const b = [...c.querySelectorAll('button')].find(x => x.textContent.includes('安装'));
      if (!b) return;
      const NAMES = ['快递追踪','截图贴图','呼吸放松','药品管家','喝水提醒','番茄专注','久坐管家','待办清单','倒数日','快捷启动器','音乐播放器','世界时钟','快速便签','天气小部件','窗口布局','计时秒表','习惯打卡','会议提醒','勿扰模式','桌面宠物','音量混合器','亮度色温'];
      if (!NAMES.some(nm => c.textContent.includes(nm))) return;
      b.dispatchEvent(new MouseEvent('click', { bubbles: true })); n++;
    });
    return n;
  })()`)
  await wait(1200)
  console.log('INSTALL clicked=' + installed)

  const state = await js(`(() => {
    const s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    const lab = (s.installed || []).filter(p => String(p.manifest.id).startsWith('lab.'));
    return { labCount: lab.length, entries: lab.slice(0, 3).map(p => p.manifest.entry) };
  })()`)
  console.log('STATE ' + JSON.stringify(state))
  if (state.labCount < 22) problems.push('已安装 lab 插件数不足：' + state.labCount)

  /* 3) 让 lab 插件上桌面。
     lab 插件的 manifest 里 defaultVisible=false（与内置的番茄钟一致：装好但先不占桌面），
     所以这里显式把它们设为可见，再验证渲染。 */
  const shown = await js(`(() => {
    const s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    let n = 0;
    (s.installed || []).forEach(p => {
      if (String(p.manifest.id).startsWith('lab.') && !p.visible) { p.visible = true; n++; }
    });
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return n;
  })()`)
  console.log('SHOW ' + shown + ' plugins set visible')

  await win.webContents.reload()
  await wait(4000)

  /* 4) 桌面上的 lab 卡片与 iframe 内的 .win。
     注意：iframe 的 onLoad 之后宿主才发 plugin:ready/init，主题要再等一会儿才落；
     所以这里轮询等待，而不是取一次快照。 */
  let desk = null
  for (let i = 0; i < 20; i++) {
    desk = await js(`(() => {
      const iframes = [...document.querySelectorAll('iframe')];
      const labIframes = iframes.filter(f => (f.getAttribute('src') || '').includes('/lab/plugins/'));
      const loaded = labIframes.filter(f => {
        try { return !!(f.contentDocument && f.contentDocument.querySelector('.win')); } catch (e) { return false; }
      });
      const themed = loaded.filter(f => {
        try { return !!f.contentDocument.documentElement.getAttribute('data-theme'); } catch (e) { return false; }
      });
      return { cards: document.querySelectorAll('.card').length, iframes: iframes.length,
               labIframes: labIframes.length, winRendered: loaded.length, themed: themed.length,
               themeVal: themed[0] ? themed[0].contentDocument.documentElement.getAttribute('data-theme') : null,
               sample: loaded[0] ? (loaded[0].contentDocument.querySelector('.win').innerText || '').replace(/\\s+/g,' ').trim().slice(0,40) : null };
    })()`)
    if (desk.themed > 0) break
    await wait(500)
  }
  console.log('DESKTOP ' + JSON.stringify(desk))
  if (desk.labIframes === 0) problems.push('桌面上没有 lab 插件的 iframe')
  if (desk.winRendered === 0) problems.push('lab 插件的 .win 没有渲染出来')
  if (desk.themed === 0) problems.push('lab 插件没有收到宿主主题（data-theme 为空）')

  console.log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')
  app.quit()
}, 400))
