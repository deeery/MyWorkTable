/* ============================================================
   喵酱插件实验室 · 公共运行时 pl.js
   window.PL = { toast, notify, beep, store, theme, $, $$, ... }
   ============================================================ */
(function () {
  const KEY = 'pl-theme';
  const root = document.documentElement;

  // ---- 主题：跟随系统，可被 localStorage 覆盖 ----
  function theme() { return localStorage.getItem(KEY) || 'auto'; }
  function applyTheme(t) {
    if (!t || t === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
  }
  applyTheme(theme());

  // ---- 提示条 ----
  function toastBox() {
    let box = document.getElementById('pl-toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'pl-toasts';
      document.body.appendChild(box);
    }
    return box;
  }
  function toast(msg, kind, ms) {
    kind = kind || 'info';
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    const icon = { ok: '✅', warn: '⚠️', danger: '⛔', info: '🔔' }[kind] || '🔔';
    el.innerHTML = '<span>' + icon + '</span><span>' + String(msg) + '</span>';
    toastBox().appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms || 2600);
    return el;
  }

  // ---- 系统通知（有权限就用真通知，否则降级为提示条）----
  function notify(title, body, opts) {
    opts = opts || {};
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body: body, icon: opts.icon, silent: !!opts.silent }); return 'native'; } catch (e) { /* fallthrough */ }
    }
    toast('<b>' + title + '</b>' + (body ? ' · ' + body : ''), opts.kind || 'info');
    return 'toast';
  }
  function askNotify() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        toast(p === 'granted' ? '已开启系统通知权限' : '通知权限被拒绝，改用应用内提示', p === 'granted' ? 'ok' : 'warn');
      });
    }
  }

  // ---- 音效（WebAudio 合成，无需素材）----
  let ac = null;
  function beep(freq, dur, type) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq || 880;
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + (dur || 0.18));
      o.connect(g).connect(ac.destination);
      o.start(); o.stop(ac.currentTime + (dur || 0.18) + 0.02);
    } catch (e) { /* 静默失败 */ }
  }
  function chime() { beep(880, .16); setTimeout(() => beep(1320, .22), 130); }

  // ---- 本地存储 ----
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pl:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pl:' + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem('pl:' + k); } catch (e) {} }
  };

  // ---- 小工具 ----
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const pad = n => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return h ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }
  const fmtClock = d => pad((d || new Date()).getHours()) + ':' + pad((d || new Date()).getMinutes()) + ':' + pad((d || new Date()).getSeconds());
  const today = () => new Date().toISOString().slice(0, 10);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  window.PL = {
    theme, setTheme: t => { localStorage.setItem(KEY, t); applyTheme(t); }, toggleTheme: () => { const t = theme() === 'dark' ? 'light' : 'dark'; window.PL.setTheme(t); return t; },
    toast, notify, askNotify, beep, chime, store, $, $$, pad, clamp, fmtTime, fmtClock, today, rand, pick
  };
})();


/* ============================================================
   Workbench 宿主桥接（仅存在于镜像副本中）
   ------------------------------------------------------------
   宿主通过 postMessage 下发主题与配置；plugin-lab 插件原本不监听。
   这里补上最小桥接：
     - workbench:init / workbench:theme → 写 data-theme 与 pl-theme
       （两边同名同取值，故插件自身的主题逻辑也保持一致）
     - workbench:config → 暂存，供需要时读取（window.__wbConfig）
     - workbench:init → 记下 window.__wbWindowId（本窗口的窗口实例 id）
     - 配置每次变化再派发一个 DOM 事件 pl:wb-config，
       让插件能「按窗口配置改变自己的渲染」而不必轮询。
       便签的多窗口归属（config.notes）就靠它 —— 见 12-sticky-notes.html
   并回 plugin:ready 让宿主完成握手。

   为什么要重发 plugin:ready：
     本脚本在 pl.js 加载时立刻发 ready，而宿主是在 React 的 useEffect 里
     才注册 message 监听。若 iframe 比宿主先就绪（产物加载很快时常见），
     这条 ready 就丢了，宿主永远不回 workbench:init → 主题与配置全都收不到。
     所以按固定间隔重发，直到收到 init 为止（收到后立即停止）。
   ============================================================ */
(function () {
  if (window.parent === window) return;   // 不在 iframe 里就不做桥接
  var gotInit = false;
  var tries = 0;

  function applyTheme(t) {
    if (!t) return;
    try {
      document.documentElement.setAttribute('data-theme', t);
      // 同步给插件自身的主题逻辑（PL.theme 读的就是这个 key）
      localStorage.setItem('pl-theme', t);
    } catch (e) { /* 跨源时忽略 */ }
  }

  function sendReady() {
    if (gotInit || tries >= 20) return;
    tries++;
    try { parent.postMessage({ type: 'plugin:ready', payload: { id: 'lab' } }, '*'); } catch (e) {}
    setTimeout(sendReady, 250);
  }

  /**
   * 记下窗口配置，并广播成 DOM 事件。
   *
   * 为什么要额外派发事件：插件（如便签）需要「按窗口配置改变自己的渲染」，
   * 而 message 事件在 window 上，插件要自己再挂一个监听并解析 payload。
   * 派发一个语义化事件，插件侧一行 addEventListener 就能接住，
   * 且 init 与后续 config 走同一条路径，不会漏掉初始值。
   */
  function applyConfig(cfg) {
    window.__wbConfig = cfg || {};
    try {
      window.dispatchEvent(new CustomEvent('pl:wb-config', { detail: window.__wbConfig }));
    } catch (e) { /* 拿不到 CustomEvent 时至少还有 __wbConfig */ }
  }

  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.type === 'workbench:init') {
      gotInit = true;
      applyTheme(m.payload && m.payload.theme);
      window.__wbWindowId = (m.payload && m.payload.windowId) || '';
      applyConfig(m.payload && m.payload.config);
    } else if (m.type === 'workbench:theme') {
      applyTheme(m.payload && m.payload.theme);
    } else if (m.type === 'workbench:config') {
      applyConfig(m.payload);
    }
  });

  sendReady();
})();
