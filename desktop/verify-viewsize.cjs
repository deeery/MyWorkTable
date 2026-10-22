/**
 * 验收：形态切换的高亮逻辑与尺寸自适应。
 *
 * 检查链路：
 *   点「桌面精简」/「完整内容」
 *     → 高亮的按钮与实际形态一致（曾出现过两行 className 写反）
 *     → 卡片尺寸跟着换档：精简 S(280×180) / 完整 480×640
 *     → 左上角坐标在整个过程中保持不变（切换形态不该让卡片在桌面上跳走）
 *
 * 踩过的坑（写这个脚本时踩的，改脚本前先读）：
 *  1. 设置面板是 portal 到 body 的，不在卡片 DOM 里 —— 必须在 document 上找。
 *  2. 同一时刻可能有多张卡片的面板同时打开，且出现顺序未必等于卡片顺序；
 *     所以不要用 panels[i] 猜。要先按 Esc 全部关掉，再开目标卡片的那一块。
 *  3. 齿轮是 toggle，面板开着时再点是「关」。
 *  4. 高亮由 React state 驱动，点击后同步读 DOM 会拿到旧值，必须等一拍。
 *  5. 断言按钮高亮要用子串匹配：文案带 emoji 前缀（🧩 / 🪟），
 *     Array.includes() 是全等匹配，直接比会永远失败。
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 180000)
const out = []
const log = (s) => { out.push(s); }

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 50 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  win.setSize(1500, 950)
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s) } catch (e) { return { __err: String(e && e.message || e) } } }

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(1200)

  // 装 2 个 lab 插件
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('插件')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(600)
  await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('插件市场')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(600)
  await js(`(() => {
    const NAMES = ['倒数日','桌面宠物'];
    document.querySelectorAll('.market-card').forEach(c => {
      if (!NAMES.some(w => c.textContent.includes(w))) return;
      const b = [...c.querySelectorAll('button')].find(x => x.textContent.includes('安装'));
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return true;
  })()`)
  await wait(1500)

  // 只留 lab 插件，并归一化成「精简 + S 档位」的已知起点，
  // 免得上一轮残留的状态让断言从中间开始（曾经把 card0 留在 full/M）
  /**
   * 归一化起点。
   *
   * ⚠ 数据模型已拆分：s.installed[] 只放全局信息（manifest / enabled /
   * config），布局（visible / size / x / y / w / h）在
   * s.workspaces[].slots[插件id]。旧脚本直接往 s.installed 上写这些字段，
   * 在新模型下会被完全忽略 —— 归一化静默失效，断言从随机状态开始。
   */
  await js(`(() => {
    const s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    const ws = (s.workspaces || []).find(w => w.id === s.activeWorkspace) || (s.workspaces || [])[0];
    if (!ws) return false;
    if (!Array.isArray(ws.windows)) ws.windows = [];
    let i = 0;
    (s.installed || []).forEach((p) => {
      const id = p.manifest.id;
      const isLab = String(id).startsWith('lab.');
      // 多窗口模型：一个插件一条 windows 记录（这里只需一条）
      let mine = ws.windows.filter(w => w.pluginId === id);
      if (!mine.length) {
        mine = [{ id: 'w-' + id + '-' + Math.random().toString(36).slice(2, 7), pluginId: id, visible: false, size: 'S' }];
        ws.windows.push(mine[0]);
      }
      mine.forEach((w, k) => {
        w.visible = isLab && k === 0;
        if (isLab && k === 0) {
          w.size = 'S'; delete w.w; delete w.h;
          w.x = 300 + i * 620; w.y = 200 + i * 40;
          // 形态切换的配置挂在**窗口**上（多窗口后每个窗口独立设置）
          w.config = Object.assign({}, w.config, { view: 'compact' });
          i++;
        }
      });
    });
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2000)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(4000)

  const problems = []

  /** 读某张卡片的当前状态 */
  const read = (idx) => js(`(() => {
    const card = document.querySelectorAll('.plugin-card')[${idx}];
    if (!card) return { err: 'no card' };
    const st = card.getAttribute('style') || '';
    const left = (st.match(/left:\\s*([\\d.]+)px/) || [])[1];
    const top  = (st.match(/top:\\s*([\\d.]+)px/)  || [])[1];
    const w    = (st.match(/width:\\s*([\\d.]+)px/)  || [])[1];
    const h    = (st.match(/height:\\s*([\\d.]+)px/) || [])[1];
    return { left, top, w, h };
  })()`)

  /** 打开齿轮并点某个形态按钮。
   ⚠ 设置面板是 portal 到 body 的，同一时刻可能有多张卡片的面板同时打开。
   不能靠下标猜哪个面板属于哪张卡片 —— 面板出现顺序未必与卡片顺序一致。
   稳妥做法：先按 Esc 关掉所有面板（PluginCard 在 document 上监听），
   再点这张卡的齿轮，此时 body 里唯一的面板必定属于它。
   另外齿轮是 toggle，所以每次都必须先确保面板处于关闭状态。 */
  const closePanels = async () => {
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(600)
  }

  const clickView = (idx, label) => js(`(() => {
    const card = document.querySelectorAll('.plugin-card')[${idx}];
    card.querySelector('.gear').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 'gear';
  })()`)

  /** 面板已打开（body 里应当恰好一块）时，点指定形态按钮 */
  const clickInOpenPanel = (label) => js(`(() => {
    var panels = [...document.querySelectorAll('.settings-panel')];
    if (panels.length !== 1) return { err: 'want exactly 1 panel, got ' + panels.length };
    var sw = panels[0].querySelector('.view-switch');
    if (!sw) return { err: 'no view-switch' };
    var btns = [...sw.querySelectorAll('button')].map(b => b.textContent.trim());
    var b = [...sw.querySelectorAll('button')].find(x => x.textContent.includes('${label}'));
    if (!b) return { err: 'no button', btns: btns };
    var onBefore = [...sw.querySelectorAll('button')].filter(x => x.classList.contains('on')).map(x => x.textContent.trim());
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { btns: btns, onBefore: onBefore };
  })()`)

  /** 复读当前唯一面板的高亮 */
  const readOn = () => js(`(() => {
    var panels = [...document.querySelectorAll('.settings-panel')];
    if (panels.length !== 1) return null;
    var sw = panels[0].querySelector('.view-switch');
    if (!sw) return null;
    return [...sw.querySelectorAll('button')].filter(x => x.classList.contains('on')).map(x => x.textContent.trim());
  })()`)

  /** 完整流程：关掉所有面板 → 开这张卡的齿轮 → 点形态按钮 */
  const ensureClick = async (idx, label) => {
    await closePanels()
    await clickView(idx, label)
    await wait(900)
    return clickInOpenPanel(label)
  }

  for (let i = 0; i < 2; i++) {
    const before = await read(i)
    log(`card${i} initial ${JSON.stringify(before)}`)
    await closePanels()   // 上一张卡片的面板先关掉，否则 panels[i] 会错位

    // 切到「完整内容」
    const r1 = await ensureClick(i, '完整内容')
    log(`card${i} click-full ${JSON.stringify(r1)}`)
    if (r1.__err || r1.err) { problems.push(`card${i} 切完整失败 ${JSON.stringify(r1)}`); continue }
    await wait(2200)
    const on1 = await readOn(i)
    log(`card${i} highlight-after-full ${JSON.stringify(on1)}`)
    // 注意：按钮文案带 emoji 前缀（🧩 / 🪟），要用 includes 做子串匹配
    if (!on1 || !on1.some((t) => t.includes('完整内容'))) problems.push(`card${i} 切完整后高亮不对：${JSON.stringify(on1)}`)
    if (on1 && on1.some((t) => t.includes('桌面精简'))) problems.push(`card${i} 切完整后桌面精简仍高亮`)
    const mid = await read(i)
    log(`card${i} full-state ${JSON.stringify(mid)}`)

    // 切回「桌面精简」
    const r2 = await ensureClick(i, '桌面精简')
    log(`card${i} click-compact ${JSON.stringify(r2)}`)
    if (r2.__err || r2.err) { problems.push(`card${i} 切精简失败 ${JSON.stringify(r2)}`); continue }
    await wait(2200)
    const on2 = await readOn(i)
    log(`card${i} highlight-after-compact ${JSON.stringify(on2)}`)
    if (!on2 || !on2.some((t) => t.includes('桌面精简'))) problems.push(`card${i} 切精简后高亮不对：${JSON.stringify(on2)}`)
    if (on2 && on2.some((t) => t.includes('完整内容'))) problems.push(`card${i} 切精简后完整内容仍高亮`)
    const end = await read(i)
    log(`card${i} compact-state ${JSON.stringify(end)}`)

    // 位置必须不变（切换形态不能让卡片在桌面上跳走）
    if (before.left !== end.left || before.top !== end.top)
      problems.push(`card${i} 切换后位置变了：${before.left},${before.top} → ${end.left},${end.top}`)
    // 尺寸必须随形态变化
    if (!(Number(mid.w) > Number(end.w) || Number(mid.h) > Number(end.h)))
      problems.push(`card${i} 尺寸未随形态调整：精简 ${end.w}x${end.h} vs 完整 ${mid.w}x${mid.h}`)
    // 精简回落到 S(280x180)，完整为 480×640
    // （完整态高度是 FULL_VIEW_H=640：插件按 400px 宽 / 500~2000px 高设计，
    //   早先用 M 档的「最小高度」220px 只露出一条缝，用户要一路滚动）
    if (end.w !== '280' || end.h !== '180')
      problems.push(`card${i} 精简态应回到 S(280x180)，实际 ${end.w}x${end.h}`)
    if (mid.w !== '480' || Number(mid.h) < 500)
      problems.push(`card${i} 完整态应为 480 宽 / >=500 高，实际 ${mid.w}x${mid.h}`)
  }

  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-viewsize.txt'),
    out.join('\n') + '\n\n' + (problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过'), 'utf8')
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-viewsize.png'), (await win.webContents.capturePage()).toPNG())

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))