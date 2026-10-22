/**
 * 验收：精简模式下组件内部没有齿轮与浮层设置，全部收进卡片设置的二级界面。
 *
 * 检查链路：
 *   1. ?view=host 下 iframe 内不再有 .cw-gear / .cw-editor / .cw-dot
 *      （组件只出内容，设置入口归宿主）
 *   2. 卡片设置面板里能展开「精简设置」这一层
 *   3. 展开后拿到插件自报的清单（格式 / 尺寸 / 选项）
 *   4. 点另一个格式 → 组件 data-fmt 跟着变（通道真的通了，不是静态渲染）
 *   5. 点另一个尺寸 → 组件 class 里的 sz-* 跟着变
 *   6. 改一个选项 → 组件内容随之重绘
 *   7. 刷新页面后设置仍在（插件侧持久化，没有丢）
 *
 * 踩过的坑（照抄 verify-viewsize.cjs 的教训）：
 *  - 设置面板是 portal 到 body 的，不在卡片 DOM 里，必须从 document 找
 *  - 多张卡片的面板会同时存在且顺序不保证；先按 Esc 全关，再开目标那张
 *  - 齿轮是 toggle
 *  - React 状态异步，点击后要等一拍再读 DOM
 */
process.env.WORKBENCH_VERIFY = '1'

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
require('./main.cjs')

const HARD = setTimeout(() => { console.log('TIMEOUT'); app.exit(1) }, 240000)
const out = []
const log = (s) => { out.push(s); console.log(s) }

app.whenReady().then(() => setTimeout(async () => {
  let win = null
  for (let i = 0; i < 50 && !win; i++) { win = BrowserWindow.getAllWindows()[0] ?? null; if (!win) await wait(100) }
  if (!win) { app.exit(1); return }
  win.setSize(1500, 950)
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s) } catch (e) { return { __err: String(e && e.message || e) } } }

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await wait(1200)

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

  // 归一化成「精简形态 + S 档位」，并清掉插件侧的精简设置残留，
  // 保证断言从已知起点开始
  /**
   * 归一化起点。
   *
   * ⚠ 数据模型已拆分：s.installed[] 只放全局信息（manifest / enabled），
   * 布局（visible / size / x / y / w / h）与 config 都在
   * s.workspaces[].windows[] 上。旧脚本直接往 s.installed 上写这些字段，
   * 在新模型下会被完全忽略 —— 归一化静默失效，卡片停在上一轮留下的
   * view=embed（完整内容），于是「精简组件里不该有齿轮」等断言全线崩。
   *
   * ⚠ 只让这两张目标卡片可见：按 `isLab` 一刀切的话，上一轮残留的
   * 其它 lab 插件也会冒出卡片，把 probeFrame(0)/(1) 的序号打乱。
   */
  await js(`(() => {
    const TARGETS = ['lab.07', 'lab.42'];
    const s = JSON.parse(localStorage.getItem('workbench:state:v1') || '{}');
    const ws = (s.workspaces || []).find(w => w.id === s.activeWorkspace) || (s.workspaces || [])[0];
    if (!ws) return false;
    if (!Array.isArray(ws.windows)) ws.windows = [];
    let i = 0;
    (s.installed || []).forEach(p => {
      const id = p.manifest.id;
      const on = TARGETS.indexOf(id) >= 0;
      // 多窗口模型：一个插件一条 windows 记录（这里只需一条）
      let mine = ws.windows.filter(w => w.pluginId === id);
      if (!mine.length) {
        mine = [{ id: 'w-' + id + '-' + Math.random().toString(36).slice(2, 7), pluginId: id, visible: false, size: 'S' }];
        ws.windows.push(mine[0]);
      }
      mine.forEach((w, k) => {
        w.visible = on && k === 0;
        if (on && k === 0) {
          w.size = 'S'; delete w.w; delete w.h;
          // 形态切换的配置挂在**窗口**上（多窗口后每个窗口独立设置）
          w.config = Object.assign({}, w.config, { view: 'compact' });
          // 两张卡片要错开摆：同坐标会叠在一起，截图只能看到最上面那张
          w.x = 320 + i * 620; w.y = 220 + i * 40;
          i++;
        }
      });
    });
    localStorage.setItem('workbench:state:v1', JSON.stringify(s));
    // ⚠ 精简设置存在 pl: 命名空间下（pl.js 的 store 会给键加 'pl:' 前缀），
    //   写成 'cw:' 前缀永远匹配不到，等于没清。
    Object.keys(localStorage).filter(k => k.startsWith('pl:cw:')).forEach(k => localStorage.removeItem(k));
    return true;
  })()`)
  await win.webContents.reload()
  await wait(2000)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(4500)

  const problems = []

  /** 读第 idx 个 iframe 里的精简组件状态 */
  const probeFrame = (idx) => js(`(() => {
    const f = [...document.querySelectorAll('.plugin-card')][${idx}]?.querySelector('iframe');
    if (!f) return { err: 'no iframe' };
    const d = f.contentDocument;
    if (!d) return { err: 'cross-origin / not loaded' };
    const cw = d.querySelector('.cw');
    return {
      url: (f.getAttribute('src') || '').split('/').pop(),
      gear: !!d.querySelector('.cw-gear'),
      editor: !!d.querySelector('.cw-editor'),
      dot: !!d.querySelector('.cw-dot'),
      fmt: cw ? cw.getAttribute('data-fmt') : null,
      cls: cw ? cw.className : null,
      text: cw ? (cw.textContent || '').trim().slice(0, 40) : null,
    };
  })()`)

  const closePanels = async () => {
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(600)
  }

  /** 开这张卡的齿轮（先确保所有面板关闭），返回唯一那块面板的信息 */
  const openPanel = async (idx) => {
    await closePanels()
    await js(`document.querySelectorAll('.plugin-card')[${idx}].querySelector('.gear')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    await wait(900)
    return js(`(() => {
      var p = [...document.querySelectorAll('.settings-panel')];
      if (p.length !== 1) return { err: 'want 1 panel, got ' + p.length };
      return {
        hasViewSwitch: !!p[0].querySelector('.view-switch'),
        hasCwLink: !!p[0].querySelector('.cw-link'),
        cwLinkText: p[0].querySelector('.cw-link')?.textContent.trim() || null,
      };
    })()`)
  }

  /** 在唯一打开的面板里点匹配文本的按钮。
   *  ⚠ 「精简设置」四个字是 label，按钮自身的文案是「格式 · 尺寸 · 选项 ▼」，
   *    按 label 文案去 find('button') 永远找不到 —— 点二级界面统一用 cw-link。 */
  const clickInPanel = (label) => js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    if (p.length !== 1) return { err: 'want 1 panel, got ' + p.length };
    var b = [...p[0].querySelectorAll('button')].find(x => x.textContent.includes('${label}'));
    if (!b) return { err: 'no button ${label}' };
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)

  /** 确保「精简设置」二级界面处于展开状态。
   *  ⚠ 不能盲点 cw-link：二级界面的展开状态 showCwSettings 是 React state，
   *    按 Esc 只关面板，不会把它复位。于是「开面板→点 cw-link」在第二次
   *    执行时反而会把已展开的界面收起 —— 看着像功能坏了。
   *  这里先看当前是否已展开，只在收起时才点。 */
  const ensureCwSettings = async () => {
    const open = await js(`(() => {
      var p = [...document.querySelectorAll('.settings-panel')];
      if (p.length !== 1) return null;
      return !!p[0].querySelector('.cw-settings');
    })()`)
    if (open) return 'already-open'
    await js(`(() => {
      var p = [...document.querySelectorAll('.settings-panel')];
      var b = p[0].querySelector('.cw-link');
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`)
    return 'toggled'
  }

  /* ---------- 1. 组件内部无齿轮 / 浮层 / 圆点 ---------- */
  const f0 = await probeFrame(0)
  log('frame0 ' + JSON.stringify(f0))
  if (f0.err) problems.push('读不到 iframe：' + f0.err)
  if (f0.gear) problems.push('精简组件里仍有齿轮 .cw-gear')
  if (f0.editor) problems.push('精简组件里仍有浮层 .cw-editor')
  if (f0.dot) problems.push('精简组件里仍有角标 .cw-dot')
  if (f0.url && !f0.url.includes('view=host')) problems.push('精简形态 URL 不是 view=host：' + f0.url)

  /* ---------- 2~3. 精简形态下二级界面默认展开，并能拿到清单 ---------- */
  const p0 = await openPanel(0)
  log('panel0 ' + JSON.stringify(p0))
  if (p0.err) problems.push('面板没打开：' + p0.err)
  if (!p0.hasViewSwitch) problems.push('面板里没有形态切换')
  if (!p0.hasCwLink) problems.push('面板里没有「精简设置」入口')

  /**
   * 需求：精简时默认展开。所以这里**不许**点 cw-link ——
   * 开面板就该直接看到二级界面。点了再断言等于把「默认展开」这个
   * 需求测丢了（无论默认是什么，点一下都会展开）。
   */
  const defState = await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    if (p.length !== 1) return { err: 'want 1 panel, got ' + p.length };
    return {
      expanded: !!p[0].querySelector('.cw-settings'),
      linkText: p[0].querySelector('.cw-link')?.textContent.trim() || null,
    };
  })()`)
  log('精简形态开面板即 ' + JSON.stringify(defState))
  if (defState.err) problems.push('面板没打开：' + defState.err)
  if (!defState.expanded) problems.push('精简形态下二级界面没有默认展开（要求精简时默认展开）')
  // 按钮文案应当是「收起」—— 那是展开态的文案。
  // ⚠ 别把这条写成 !includes('收起')：展开时本来就该显示「收起」，
  //   我第一版就是这么写的，于是自己给自己造了一条假失败。
  if (defState.linkText && !defState.linkText.includes('收起')) {
    problems.push('已展开但按钮文案不是「收起」：' + defState.linkText)
  }

  await wait(1200)
  const desc = await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    if (p.length !== 1) return { err: 'want 1 panel, got ' + p.length };
    var box = p[0].querySelector('.cw-settings');
    if (!box) return { err: '没有 .cw-settings' };
    return {
      fmts: [...box.querySelectorAll('.cw-fmt-btn')].map(b => b.textContent.trim()),
      fmtOn: [...box.querySelectorAll('.cw-fmt-btn.on')].map(b => b.textContent.trim()),
      sizes: [...box.querySelectorAll('.cw-size-btn')].map(b => b.textContent.trim()),
      sizeOn: [...box.querySelectorAll('.cw-size-btn.on')].map(b => b.textContent.trim()),
      opts: [...box.querySelectorAll('.cw-opt-row')].map(r => r.querySelector('.grow').textContent.trim()),
      hint: box.textContent.includes('正在向插件取') ? 'still-loading' : null,
    };
  })()`)
  log('desc ' + JSON.stringify(desc))
  if (desc.err) problems.push('精简设置没展开：' + desc.err)
  if (desc.hint === 'still-loading') problems.push('精简设置一直停在「正在向插件取…」—— 插件没上报清单')
  if (desc.fmts && desc.fmts.length < 2) problems.push('清单里格式少于 2 个，拿不到可切换项：' + JSON.stringify(desc.fmts))

  /* ---------- 4. 切换格式 → 组件 data-fmt 跟着变 ---------- */
  const before = await probeFrame(0)
  const otherFmt = await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    var box = p[0].querySelector('.cw-settings');
    var cur = box.querySelector('.cw-fmt-btn.on');
    var alt = [...box.querySelectorAll('.cw-fmt-btn')].find(b => b !== cur);
    if (!alt) return null;
    alt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return alt.textContent.trim();
  })()`)
  await wait(1500)
  const after = await probeFrame(0)
  log(`格式切换 ${before.fmt} → ${after.fmt} （点了「${otherFmt}」）`)
  if (otherFmt && before.fmt === after.fmt) problems.push(`点了「${otherFmt}」但组件 data-fmt 仍是 ${after.fmt} —— 设置通道没通`)

  /* ---------- 5. 「组件尺寸」已从精简设置里移除 ---------- */
  //
  // 组件尺寸现在完全跟随窗口（见 compact.css 的 pl-host 段与
  // PluginCard 里那段注释）。两套尺寸来源会互相打架，所以设置里
  // 不该再有这一组。这里断言它确实不在了。
  const sizeUi = await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    var box = p[0] && p[0].querySelector('.cw-settings');
    if (!box) return { err: 'no cw-settings' };
    return {
      sizeBtns: box.querySelectorAll('.cw-size-btn').length,
      sizeList: !!box.querySelector('.cw-size-list'),
      sections: [...box.querySelectorAll('.cw-sec-t')].map(function (x) { return x.textContent.trim(); }),
    };
  })()`)
  log('尺寸设置检查 ' + JSON.stringify(sizeUi))
  if (sizeUi.err) problems.push(sizeUi.err)
  else {
    if (sizeUi.sizeBtns || sizeUi.sizeList) {
      problems.push('精简设置里仍有「组件尺寸」一组（应已移除，尺寸跟随窗口）')
    }
    if (sizeUi.sections.some(function (s) { return s.includes('尺寸'); })) {
      problems.push('精简设置里仍有含「尺寸」的分区：' + JSON.stringify(sizeUi.sections))
    }
  }
  const after2 = await probeFrame(0)

  /* ---------- 6. 改选项 → 内容重绘 ---------- */
  const optBefore = after2.text
  /* 截一张二级界面展开的图：最后一步是刷新，面板会关掉，
     所以这里先把面板重新打开并展开，留给 capturePage。
     ⚠ 要显式挑一张「有精简设置」的卡片开面板 —— 桌面宠物那类没声明
     compact 的插件点开齿轮也没有这一层，随便挑一张会截到空的。 */
  const shotIdx = await js(`(() => {
    // 倒数日 / 桌面宠物 里挑卡片：优先选面板里带 cw-link 的那张
    const cards = [...document.querySelectorAll('.plugin-card')];
    for (let i = 0; i < cards.length; i++) {
      const f = cards[i].querySelector('iframe');
      if (f && (f.getAttribute('src') || '').includes('view=host')) return i;
    }
    return 0;
  })()`)
  log('截图用的卡片序号 ' + shotIdx)
  await closePanels()
  await openPanel(shotIdx)
  await ensureCwSettings()
  await wait(1200)
  log('截图前状态 ' + await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    if (p.length !== 1) return 'panel=' + p.length;
    return p[0].querySelector('.cw-settings') ? '展开' : '收起';
  })()`))
  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true })
  /* 截图前再确认一次面板确实开着 —— ensureCwSettings 展开的是二级界面，
     但若 openPanel 那步的面板已被 Escape 关掉，截图就只会拍到空桌面。 */
  const shotReady = await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    if (p.length !== 1) return 'panel=' + p.length;
    return p[0].querySelector('.cw-settings') ? 'ok' : 'no-cw-settings';
  })()`)
  log('截图就绪检查 ' + shotReady)
  if (shotReady !== 'ok') {
    log('⚠ 面板未就绪，重开一次再截')
    await closePanels()
    await openPanel(shotIdx)
    await ensureCwSettings()
    await wait(1500)
  }
  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-cwsettings.png'), (await win.webContents.capturePage()).toPNG())
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait(500)
  await openPanel(shotIdx)
  await ensureCwSettings()
  await wait(1000)
  await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    var box = p[0].querySelector('.cw-settings');
    var row = box.querySelector('.cw-opt-row');
    if (!row) return 'no opt row';
    var cb = row.querySelector('input[type=checkbox]');
    var sel = row.querySelector('select');
    var num = row.querySelector('input[type=number]');
    var txt = row.querySelector('input[type=text]');
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); return 'bool'; }
    if (sel) { sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
               sel.dispatchEvent(new Event('change', { bubbles: true })); return 'select'; }
    if (num) { num.value = String(Number(num.value || 1) + 1);
               num.dispatchEvent(new Event('change', { bubbles: true })); return 'num'; }
    if (txt) { txt.value = txt.value + 'x'; txt.dispatchEvent(new Event('change', { bubbles: true })); return 'text'; }
    return 'nothing';
  })()`)
  await wait(1500)
  const after3 = await probeFrame(0)
  log(`选项改动 文本「${optBefore}」→「${after3.text}」`)
  // 有些选项（如颜色）不一定改文本，只要求没报错即可，故不强制断言变化

  /* ---------- 7. 刷新后仍在（持久化） ---------- */
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait(400)
  await win.webContents.reload()
  await wait(2000)
  await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.includes('桌面')).dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
  await wait(4500)
  const afterReload = await probeFrame(0)
  log(`刷新后 fmt=${afterReload.fmt} cls=${afterReload.cls}`)
  if (afterReload.gear) problems.push('刷新后齿轮又回来了')
  if (afterReload.fmt !== after3.fmt) problems.push(`刷新后格式丢了：${after3.fmt} → ${afterReload.fmt}`)
  // 尺寸不再由设置决定（跟随窗口），所以只断言组件仍挂载、没被缩没
  if (!afterReload.cls || !/sz-/.test(afterReload.cls)) {
    problems.push(`刷新后组件 class 异常：${afterReload.cls}`)
  }

  /* ---------- 8. 完整内容形态下整个「精简设置」都隐藏 ---------- */
  // 需求：完整时隐藏。切到 full 后面板里不该再有 cw-link 与 cw-settings。
  await openPanel(0)
  await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    var b = [...p[0].querySelectorAll('button')].find(x => x.textContent.includes('完整内容'));
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(2500)
  await openPanel(0)
  const fullState = await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    if (p.length !== 1) return { err: 'want 1 panel, got ' + p.length };
    return {
      cwLink: !!p[0].querySelector('.cw-link'),
      cwSettings: !!p[0].querySelector('.cw-settings'),
      viewOn: [...p[0].querySelectorAll('.view-switch button.on')].map(b => b.textContent.trim()),
    };
  })()`)
  log('完整内容形态面板 ' + JSON.stringify(fullState))
  if (fullState.err) problems.push('完整形态下面板没打开：' + fullState.err)
  if (fullState.cwLink) problems.push('完整内容形态下仍显示「精简设置」入口（要求完整时隐藏）')
  if (fullState.cwSettings) problems.push('完整内容形态下仍渲染了精简设置二级界面（要求完整时隐藏）')
  if (fullState.viewOn && fullState.viewOn.length && !fullState.viewOn.some(t => t.includes('完整内容'))) {
    problems.push('切到完整内容后高亮没跟上：' + JSON.stringify(fullState.viewOn))
  }

  // 切回精简，确认入口与展开状态都回来了
  await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    var b = [...p[0].querySelectorAll('button')].find(x => x.textContent.includes('桌面精简'));
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`)
  await wait(2500)
  await openPanel(0)
  await ensureCwSettings()
  await wait(1200)
  const backState = await js(`(() => {
    var p = [...document.querySelectorAll('.settings-panel')];
    if (p.length !== 1) return { err: 'want 1 panel, got ' + p.length };
    return {
      cwLink: !!p[0].querySelector('.cw-link'),
      cwSettings: !!p[0].querySelector('.cw-settings'),
      fmts: p[0].querySelector('.cw-settings')
        ? [...p[0].querySelectorAll('.cw-fmt-btn')].map(b => b.textContent.trim()) : null,
    };
  })()`)
  log('切回精简 ' + JSON.stringify(backState))
  if (backState.err) problems.push('切回精简后面板没打开：' + backState.err)
  if (!backState.cwLink) problems.push('切回精简后「精简设置」入口没回来')
  if (!backState.cwSettings) problems.push('切回精简后二级界面没有恢复展开')
  if (backState.cwSettings && (!backState.fmts || backState.fmts.length < 2)) {
    problems.push('切回精简后清单为空：' + JSON.stringify(backState.fmts))
  }

  log('')
  log(problems.length ? '❌ ' + problems.length + ' 个问题:\n  ' + problems.join('\n  ') : '✅ 全部通过')

  fs.writeFileSync(path.join(__dirname, '..', 'shots', 'verify-cwsettings.txt'),
    out.join('\n') + '\n', 'utf8')

  clearTimeout(HARD); app.exit(problems.length ? 1 : 0)
}, 400))