/* ============================================================
   喵酱插件实验室 · 精简形态运行时 compact.js
   ------------------------------------------------------------
   让插件以「桌面小组件」形态呈现：单图标 / 单日期 / 时钟 /
   进度环 / 进度条 / 数值 / 滑块 / 开关 / 迷你列表 / 文本。

   用法（在插件脚本里，注册一次即可）：

     PL.compact({
       id: 'countdown-days',
       formats: [
         { id:'date', name:'单日期', icon:'📅',
           render: (o, d) => ({ cls:'cw-date soon',
                                html:'<div class="num">'+d.days+'</div>'+
                                     '<div class="unit">天</div>' }),
           options: [ { key:'showName', type:'bool', label:'显示事件名', def:true } ] },
         { id:'list', name:'最近 3 条', icon:'📋', render: (o,d) => ({...}) },
       ],
       defFormat: 'date',
       defSize: 'square',
       data: () => ({ days: 12, name: '项目上线' }),   // 每次刷新时调用
     });

   运行时负责：外壳、齿轮、编辑菜单（格式/尺寸/该格式的选项）、
   持久化、尺寸档位、点击打开完整窗口。

   URL 参数 `?view=compact` 时页面进入精简模式（隐藏完整窗口）。
   ============================================================ */
(function () {
  const NS = 'cw:';
  const SIZES = [
    { id: 'mini', name: '迷你' },
    { id: 'square', name: '方形' },
    { id: 'wide', name: '宽版' },
    { id: 'tall', name: '竖版' },
    { id: 'banner', name: '横幅' },
  ];

  /* ---------------- 状态读写 ---------------- */
  function loadState(def) {
    const raw = PL.store.get(NS + def.id, null) || {};
    const fmtIds = def.formats.map(f => f.id);
    return {
      format: fmtIds.includes(raw.format) ? raw.format : (def.defFormat || fmtIds[0]),
      size: SIZES.some(s => s.id === raw.size) ? raw.size : (def.defSize || 'square'),
      opts: raw.opts || {},
    };
  }
  function saveState(def, st) { PL.store.set(NS + def.id, st); }

  function optDefaults(fmt) {
    const o = {};
    (fmt.options || []).forEach(x => { o[x.key] = x.def; });
    return o;
  }
  function fmtOpts(st, fmt) {
    return Object.assign(optDefaults(fmt), st.opts[fmt.id] || {});
  }

  /**
   * 取一个选项的候选项（目前只有 select 用得上）。
   *
   * spec.options 允许写成函数 (data) => [{value,label}]，用于「候选项本身
   * 随数据变化」的场景 —— 典型是便签：「显示哪张」要按当前便签的**标题**
   * 列出来，而便签会新增 / 重命名 / 删除，静态数组写完就过期了。
   *
   * 写成普通数组时行为完全不变（兼容已有插件）。
   */
  function optChoices(spec, data) {
    const raw = spec.options;
    if (typeof raw === 'function') {
      try { return raw(data || {}) || []; } catch (e) { return []; }
    }
    return raw || [];
  }

  /* ---------------- 视图模式 ---------------- */
  /**
   * 三种视图：
   *   - 'full'    完整窗口（插件自己的 .win 外壳，用于独立打开 / 画廊预览）
   *   - 'compact' 桌面精简形态（只显示小部件）
   *   - 'embed'   嵌入模式（宿主容器已经是窗口，插件不再套一层 .win；
   *                内部仍按完整窗口渲染内容，只是去掉外壳）
   *
   * embed 解决的是「窗口里再套一个窗口」：宿主卡片自带标题栏、圆角与阴影，
   * 插件若再渲染自己的 .win，就会出现两层标题栏、双份圆角阴影，
   * 且插件按 400px 宽设计的内容会被挤进小卡片里溢出。
   */
  function viewMode() {
    const q = new URLSearchParams(location.search);
    const v = q.get('view');
    if (v === 'compact') return 'compact';
    if (v === 'embed') return 'embed';
    // host = 精简形态，但抹掉 .cw 的窗口外壳。
    // 宿主（Workbench 卡片）本身已是窗口，.cw 若还带圆角边框阴影，
    // 就成了「卡片里又嵌了块小窗」。详见 compact.css 的 html.pl-host 段。
    if (v === 'host') return 'host';
    if (location.hash === '#compact') return 'compact';
    if (location.hash === '#embed') return 'embed';
    if (location.hash === '#host') return 'host';
    return 'full';
  }

  /** 需要显示小组件（而不是完整窗口）的模式 */
  function wantCompact() {
    const v = viewMode();
    return v === 'compact' || v === 'host';
  }

  /* ---------------- 内置格式构造器 ---------------- */
  /* 每个构造器返回 { cls, html }，供插件直接用作 render 的返回值 */
  const wf = {
    /** 单图标：一个大 emoji 图标砖 */
    icon: (o) => ({
      cls: 'cw-icon',
      html: '<span class="ic" style="background:' + (o.color || 'var(--accent)') + '22;color:' +
            (o.color || 'var(--accent)') + '">' + (o.emoji || '📦') + '</span>' +
            (o.label === false ? '' : '<span class="nm">' + esc(o.name || '') + '</span>'),
    }),

    /** 单日期：大数字 + 单位 + 名称 */
    date: (o) => ({
      cls: 'cw-date ' + (o.tone || ''),
      html: '<div class="num">' + esc(o.value) + '</div>' +
            '<div class="unit">' + esc(o.unit || '') + '</div>' +
            (o.name === false ? '' : '<div class="nm">' + esc(o.name || '') + '</div>') +
            (o.sub === false || !o.sub ? '' : '<div class="sub">' + esc(o.sub) + '</div>'),
    }),

    /** 时钟：时间 + 可选秒 + 城市名 */
    clock: (o) => ({
      cls: 'cw-clock',
      html: '<div class="t">' + esc(o.time || '--:--') + '</div>' +
            (o.sec === false ? '' : '<div class="sec">' + esc(o.sec || '') + '</div>') +
            (o.name === false ? '' : '<div class="nm">' + esc(o.name || '') + '</div>'),
    }),

    /** 进度环：环形进度 + 中心百分比 */
    ring: (o) => ({
      cls: 'cw-ring',
      html: '<div class="rg" style="--p:' + num(o.pct) + '"><b>' + Math.round(num(o.pct)) + '%</b></div>' +
            (o.label === false ? '' : '<div class="lb">' + esc(o.label || '') + '</div>'),
    }),

    /** 进度条：横向进度 + 数值 */
    bar: (o) => ({
      cls: 'cw-bar',
      html: '<div class="hd"><span class="nm">' + esc(o.name || '') + '</span>' +
            '<span><span class="v">' + esc(o.value) + '</span> <span class="u">' + esc(o.unit || '') + '</span></span></div>' +
            '<div class="tr"><i style="width:' + num(o.pct) + '%"></i></div>' +
            (o.sub ? '<div class="sub">' + esc(o.sub) + '</div>' : ''),
    }),

    /** 数值：大数字 + 单位 + 标签 */
    stat: (o) => ({
      cls: 'cw-stat',
      html: '<div class="v">' + esc(o.value) + '</div>' +
            '<div class="u">' + esc(o.unit || '') + '</div>' +
            (o.name === false ? '' : '<div class="nm">' + esc(o.name || '') + '</div>'),
    }),

    /** 迷你列表：2~4 行紧凑条目 */
    list: (o) => {
      const rows = (o.rows || []).slice(0, o.max || 3);
      const more = (o.rows || []).length - rows.length;
      /**
       * 空列表要给出提示，不能返回空字符串。
       *
       * 空 html 会让组件变成一块纯空白：用户看不出是「今天没安排」
       * 还是「插件挂了」。更麻烦的是随时间变化的数据会踩中这个坑 ——
       * 例如会议提醒的「只看未结束」，一到晚上所有会议都结束，
       * rows 被过滤成空，组件整块白着，看起来像坏了。
       * 这里用调用方给的 empty 文案兜底，默认「暂无内容」。
       */
      if (!rows.length) {
        return {
          cls: 'cw-list cw-empty',
          html: '<div class="hint">' + esc(o.empty || '暂无内容') + '</div>',
        };
      }
      return {
        cls: 'cw-list',
        html: rows.map(r =>
          '<div class="r"><span class="av">' + (r.icon || '•') + '</span>' +
          '<span class="tx">' + esc(r.text) + '</span>' +
          (r.right ? '<span class="rt">' + esc(r.right) + '</span>' : '') + '</div>'
        ).join('') + (more > 0 ? '<div class="more">还有 ' + more + ' 项</div>' : ''),
      };
    },

    /** 文本：一段文字 + 出处 */
    text: (o) => ({
      cls: 'cw-text',
      html: '<div class="q">' + esc(o.text || '') + '</div>' +
            (o.by ? '<div class="by">' + esc(o.by) + '</div>' : ''),
    }),
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

  /* ---------------- 注册 ---------------- */
  function compact(def) {
    if (!def || !def.id || !def.formats || !def.formats.length) {
      console.warn('[PL.compact] 定义不完整，已忽略');
      return null;
    }
    const st = loadState(def);
    let cwEl = null, editorEl = null, editing = false;
    /** 最近一次 render 抛出的错误（供自检脚本与调试读取） */
    let lastRenderError = null;

    /* --- 渲染组件正面 --- */
    function paint() {
      if (!cwEl) return;

      /**
       * 用户正在组件里就地编辑时，整体跳过这次重绘。
       *
       * 组件每秒都会被 PL.compactRefreshAll() 刷一次（时钟、倒计时都要走秒）。
       * 重绘的做法是 face.innerHTML = 新 HTML —— 正在输入的元素会被整个换成
       * 一个新的，于是焦点丢失、光标跳回开头，表现就是「打一个字就断」。
       *
       * 约定：需要就地编辑的格式给控件加 data-cw-hold。只要它还握着焦点，
       * 这里就不动 DOM；失焦后（用户点别处）下一次刷新自然恢复正常。
       * 这样既不用插件自己去防抖，也不用运行时猜测哪个元素该保留。
       */
      const face = cwEl.querySelector('.cw-face');
      const act = document.activeElement;
      if (face && act && face.contains(act) &&
          typeof act.hasAttribute === 'function' && act.hasAttribute('data-cw-hold')) {
        return;
      }

      const fmt = def.formats.find(f => f.id === st.format) || def.formats[0];
      const o = fmtOpts(st, fmt);
      let out;
      try {
        out = fmt.render(o, (def.data ? def.data() : {}) || {});
        lastRenderError = null;
      } catch (e) {
        // 渲染失败不让组件变空白，但必须把错误记下来：
        // 否则渲染缺陷会被静默吞掉，自检与调试都看不到。
        lastRenderError = (fmt.id || '?') + ': ' + (e && e.message ? e.message : String(e));
        out = { cls: '', html: '<div class="nm">渲染出错</div>' };
      }
      out = out || {};

      face.className = 'cw-face ' + (out.cls || '');
      face.innerHTML = out.html || '';
      cwEl.className = 'cw sz-' + st.size + (editing ? ' editing' : '') + (out.wrapCls ? ' ' + out.wrapCls : '');
      cwEl.setAttribute('data-fmt', fmt.id);
      if (typeof out.onPaint === 'function') out.onPaint(face, o);
      bindFaceExtras(face, out, o);
      /* 重绘后顺手把清单报给宿主。
         候选项可以是函数（便签按标题选），数据一变清单就变；
         只在内容真的不同时才发（见 reportState 的指纹判断），
         所以每秒刷新一次的组件也不会把宿主刷爆。 */
      reportState(false);
    }

    /* 格式若需要交互（如滑块、按钮），通过 onMount 挂载。
       第三个参数是「重绘自己」的回调，插件改完内部状态后调用它刷新界面。

       ⚠ 这里原来传的是 `refresh` —— 但 compact.js 里**根本没有**这个标识符
       （重绘函数叫 `paint`，`refresh` 只是 handle 对象上的一个键名）。
       于是每次挂载交互都会抛 ReferenceError，而下面的 catch 把它
       静默吞掉：插件作者写的 onMount 永远不执行，表现为
       「按钮/滑块点了完全没反应」，排查时毫无线索。
       现在改成传 paint，并让 catch 把错误记到 lastRenderError ——
       静默吞异常是这类问题的根源，宁可留下痕迹。 */
    function bindFaceExtras(face, out, o) {
      if (typeof out.onMount === 'function') {
        try {
          out.onMount(face, o, paint);
        } catch (e) {
          lastRenderError = 'onMount: ' + (e && e.message ? e.message : String(e));
          console.warn('[PL.compact] onMount 抛错：', e);
        }
      }
    }

    /* --- 编辑菜单 --- */
    function paintEditor() {
      if (!editorEl) return;
      const fmt = def.formats.find(f => f.id === st.format) || def.formats[0];
      const o = fmtOpts(st, fmt);

      let h = '<div class="hd"><span>' + (def.icon || '🧩') + '</span>' +
              '<span class="grow">' + esc(def.name || '精简形态') + '</span>' +
              '<button class="x" data-act="close" title="关闭">✕</button></div>';

      /* 格式选择 */
      h += '<div class="grp"><div class="lb">显示格式</div><div class="cw-fmts">' +
        def.formats.map(f =>
          '<div class="cw-fmt' + (f.id === st.format ? ' on' : '') + '" data-fmt="' + f.id + '">' +
          '<span class="fi">' + (f.icon || '▫') + '</span><span>' + esc(f.name || f.id) + '</span></div>'
        ).join('') + '</div></div>';

      /* 尺寸 */
      h += '<div class="grp"><div class="lb">组件尺寸</div><div class="cw-sizes">' +
        SIZES.map(s =>
          '<div class="cw-size' + (s.id === st.size ? ' on' : '') + '" data-size="' + s.id + '">' + s.name + '</div>'
        ).join('') + '</div></div>';

      /* 当前格式的选项 */
      if (fmt.options && fmt.options.length) {
        // 选项候选项可能依赖数据（如便签按标题选），这里取一次当前数据
        const data = (def.data ? def.data() : {}) || {};
        h += '<div class="grp"><div class="lb">' + esc(fmt.name || '选项') + '选项</div>' +
          fmt.options.map(x => optRow(x, o[x.key], data)).join('') + '</div>';
      }

      h += '<div class="foot">设置自动保存 · 点组件正面打开完整窗口</div>';
      editorEl.innerHTML = h;

      editorEl.querySelector('[data-act="close"]').onclick = () => toggleEditor(false);
      editorEl.querySelectorAll('[data-fmt]').forEach(el => {
        el.onclick = () => { st.format = el.dataset.fmt; commit(); };
      });
      editorEl.querySelectorAll('[data-size]').forEach(el => {
        el.onclick = () => { st.size = el.dataset.size; commit(); };
      });
      editorEl.querySelectorAll('[data-opt]').forEach(el => {
        const key = el.dataset.opt;
        const spec = (fmt.options || []).find(x => x.key === key);
        if (!spec) return;
        const write = (v) => {
          st.opts[fmt.id] = Object.assign({}, st.opts[fmt.id], { [key]: v });
          commit();
        };
        // data-opt 落在不同标签上：bool 是 <input type=checkbox>，
        // select/num/text 是控件本身。按实际标签绑定，不能一律 querySelector('input')
        // —— 那对 checkbox 会返回 null 并抛错。
        if (spec.type === 'bool') {
          el.onchange = e => write(e.target.checked);
        } else if (spec.type === 'num') {
          el.onchange = e => write(Number(e.target.value));
        } else {
          el.onchange = e => write(e.target.value);
        }
      });
    }

    function optRow(spec, val, data) {
      const v = val === undefined ? spec.def : val;
      if (spec.type === 'bool') {
        return '<label class="cw-opt"><span class="grow">' + esc(spec.label) + '</span>' +
               '<span class="sw"><input type="checkbox" data-opt="' + spec.key + '"' + (v ? ' checked' : '') + '><i></i></span></label>';
      }
      if (spec.type === 'select') {
        const choices = optChoices(spec, data);
        // 存着的值可能已经不在候选项里了（例如选中的那张便签被删掉）。
        // 补一条占位项，否则浏览器会默默选中第一条，面板显示的和实际
        // 生效的对不上 —— 用户以为改成了「便签 1」，其实状态还是旧 id。
        const known = choices.some(op => String(op.value) === String(v));
        const extra = known || v === undefined || v === '' ? '' :
          '<option value="' + esc(v) + '" selected disabled>（已不存在）</option>';
        return '<div class="cw-opt"><span class="grow">' + esc(spec.label) + '</span>' +
               '<select data-opt="' + spec.key + '">' + extra +
               choices.map(op =>
                 '<option value="' + esc(op.value) + '"' + (String(v) === String(op.value) ? ' selected' : '') + '>' +
                 esc(op.label) + '</option>').join('') + '</select></div>';
      }
      if (spec.type === 'num') {
        return '<div class="cw-opt"><span class="grow">' + esc(spec.label) + '</span>' +
               '<input type="number" data-opt="' + spec.key + '" value="' + esc(v) + '" min="' + (spec.min || 1) +
               '" max="' + (spec.max || 10) + '" style="width:56px"></div>';
      }
      return '<div class="cw-opt"><span class="grow">' + esc(spec.label) + '</span>' +
             '<input type="text" data-opt="' + spec.key + '" value="' + esc(v == null ? '' : v) + '" style="width:96px"></div>';
    }

    function commit() {
      saveState(def, st);
      paint();
      if (editing) paintEditor();
    }

    function toggleEditor(on) {
      editing = on === undefined ? !editing : !!on;
      if (editing) {
        if (!editorEl) {
          editorEl = document.createElement('div');
          editorEl.className = 'cw-editor';
          cwEl.appendChild(editorEl);
        }
        paintEditor();
      } else if (editorEl) {
        editorEl.remove();
        editorEl = null;
      }
      paint();
    }

    /* --- 打开完整窗口 --- */
    function openFull() {
      document.body.classList.remove('pl-compact');
      if (cwEl) cwEl.style.display = 'none';
      // 通知宿主（画廊）可选地切换视图
      try { parent.postMessage({ type: 'pl:open-full', id: def.id }, '*'); } catch (e) {}
    }

    /* --- 挂载 --- */
    function mount() {
      /**
       * 宿主模式（?view=host）下不渲染齿轮、浮层编辑菜单与角标点。
       *
       * 原因：组件是被塞进宿主卡片里的，卡片自己已有齿轮与设置面板。
       * 若组件内部再放一套，就成了「设置里套设置」—— 两处都能改同一份
       * 设置、样式还不一样，用户会不知道该动哪个。宿主承担设置入口，
       * 组件只负责出内容。
       *
       * 画廊预览（?view=compact）没有宿主外壳，组件就是页面主角，
       * 所以那里保留齿轮。
       */
      const hostMode = viewMode() === 'host';

      cwEl = document.createElement('div');
      cwEl.className = 'cw sz-' + st.size;
      cwEl.setAttribute('data-cw', def.id);
      cwEl.innerHTML =
        '<div class="cw-face"></div>' +
        (hostMode ? '' :
          '<button class="cw-gear" title="精简形态设置">⚙</button>' +
          '<span class="cw-dot"></span>');

      cwEl.querySelector('.cw-face').addEventListener('click', (e) => {
        /* 格式自带交互（滑块、按钮、就地编辑的输入框）时不触发打开。
           原来只排除了 input/select/button，漏了 textarea ——
           于是点一下便签正文就被判成「点了组件正面」，
           直接把用户踹进完整窗口，根本没法在里面打字。 */
        if (e.target.closest('input,select,button,textarea,[contenteditable]')) return;
        // 宿主模式下单击只反馈给宿主去切形态，不直接改自己的 DOM
        if (hostMode) {
          try { parent.postMessage({ type: 'pl:open-full', id: def.id }, '*'); } catch (err) {}
          return;
        }
        openFull();
      });
      if (!hostMode) {
        cwEl.querySelector('.cw-gear').addEventListener('click', (e) => {
          e.stopPropagation();
          toggleEditor();
        });
      }
      // 组件内不再冒泡到 body 的拖拽/选中逻辑
      cwEl.addEventListener('mousedown', e => e.stopPropagation());

      const stage = document.createElement('div');
      stage.className = 'cw-stage';
      stage.appendChild(cwEl);
      document.body.appendChild(stage);

      document.body.classList.add('pl-compact');
      paint();
    }

    /* --- 对外句柄 --- */
    const handle = {
      id: def.id,
      /** 定义对象（供自检脚本枚举全部格式与选项） */
      __def: def,
      /** 数据变化后调用，重绘组件 */
      refresh: paint,
      /** 取当前状态（格式/尺寸/选项） */
      state: () => JSON.parse(JSON.stringify(st)),
      /** 设置状态并持久化 */
      set: (patch) => { Object.assign(st, patch); commit(); },
      /** 打开/关闭编辑菜单（宿主模式下组件内没有菜单，调用会忽略） */
      edit: toggleEditor,
      /** 是否精简模式 */
      isCompact: wantCompact,
      /**
       * 精简设置清单：供宿主在自己的设置面板里渲染二级界面。
       * 返回 { formats:[{id,name,icon}], size, sizes:[{id,name}], options:[当前格式的选项] }
       * 宿主拿到后不必理解插件内部结构，只需按下标回传即可。
       */
      describe: () => {
        const fmt = def.formats.find(f => f.id === st.format) || def.formats[0];
        const o = fmtOpts(st, fmt);
        // 候选项可能依赖数据（便签按标题选），每次取清单都重新算
        const data = (def.data ? def.data() : {}) || {};
        return {
          formats: def.formats.map(f => ({ id: f.id, name: f.name || f.id, icon: f.icon || '▫' })),
          /** 当前格式 id —— 宿主靠它标记哪个格式按钮是高亮的 */
          format: fmt.id,
          size: st.size,
          sizes: SIZES.map(s => ({ id: s.id, name: s.name })),
          options: (fmt.options || []).map(x => ({
            key: x.key, label: x.label || x.key, type: x.type,
            def: x.def, min: x.min, max: x.max,
            choices: optChoices(x, data).map(op => ({ value: op.value, label: op.label })),
            value: o[x.key],
          })),
        };
      },
      /** 宿主改设置：按 key 写入并重绘。返回是否真的改了（值相同则跳过） */
      applyPatch: (patch) => {
        if (patch.format && patch.format !== st.format) {
          st.format = patch.format;
        }
        if (patch.size && patch.size !== st.size) st.size = patch.size;
        if (patch.opts && typeof patch.opts === 'object') {
          const fmt = def.formats.find(f => f.id === st.format) || def.formats[0];
          const cur = Object.assign({}, st.opts[fmt.id]);
          let changed = false;
          Object.keys(patch.opts).forEach(k => {
            if (cur[k] !== patch.opts[k]) { cur[k] = patch.opts[k]; changed = true; }
          });
          st.opts[fmt.id] = cur;
        }
        commit();
        return true;
      },
      /** 最近一次 render 的错误信息（无错误为 null） */
      lastError: () => lastRenderError,
      el: () => cwEl,
    };

    /* --- 初始化：仅当 URL 要求精简模式时才挂载 --- */
    function init() {
      if (wantCompact()) mount();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    return handle;
  }

  /* ---------------- 导出 ---------------- */
  /** 已注册的精简形态句柄，供 PL.compactRefreshAll() 统一刷新 */
  const handles = [];

  PL.compact = function (def) {
    const h = compact(def);
    if (h) handles.push(h);
    return h;
  };
  PL.cwf = wf;                       // 内置格式构造器
  PL.compactSizes = SIZES;
  PL.compactRefreshAll = () => handles.forEach(h => h.refresh());
  /** 已注册句柄（自检脚本据此枚举格式与选项） */
  PL.compactHandles = handles;

  /* ============================================================
     嵌入模式（?view=embed）：去掉插件自带的那层 .win 外壳
     ------------------------------------------------------------
     宿主容器（如 Workbench 的卡片）本身已经是一个窗口：有标题栏、
     圆角、阴影。插件若再渲染自己的 .win，就成了「窗口里套窗口」——
     两层标题栏重复显示同一个名字、双份圆角与阴影，
     且插件按 400px 宽设计的内容会被挤进窄卡片里并严重溢出。

     做法：给 .win 加 .win-flat 类，用 CSS 抹掉它的边框/圆角/阴影/
     宽度限制，并隐藏自己的标题栏与状态栏（这些由宿主提供）。
     插件内部的 body 内容布局完全不动。
     ============================================================ */
  function applyEmbedMode() {
    if (viewMode() !== 'embed') return;
    const root = document.documentElement;
    root.classList.add('pl-embed');
    const win = root.querySelector('.win');
    if (!win) return;
    win.classList.add('win-flat');
    // 隐藏插件自带的标题栏与状态栏：宿主卡片已有等价的头部与状态
    root.querySelectorAll('.win-head, .win-foot').forEach(el => {
      el.classList.add('win-chrome-hidden');
    });
  }

  /* ============================================================
     宿主模式：精简形态 + 抹掉 .cw 自己的窗口外壳。
     与 applyEmbedMode 是同一件事的两个层级 ——
       embed 抹 .win（插件完整窗口）
       host  抹 .cw（精简小组件）
     两者的动机一致：宿主容器已经是一个窗口，插件别再套一层。
     ============================================================ */
  function applyHostMode() {
    if (viewMode() !== 'host') return;
    document.documentElement.classList.add('pl-host');
  }

  function applyViewDecorations() {
    applyEmbedMode();
    applyHostMode();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyViewDecorations);
  } else {
    applyViewDecorations();
  }

  /* ============================================================
     精简设置搬进宿主（二级界面）
     ------------------------------------------------------------
     宿主模式（?view=host）下组件内部没有齿轮，也没有浮层编辑菜单，
     设置入口改由宿主的卡片设置面板承担。宿主通过 postMessage 问
     两件事、答一件事：

       宿主 → 插件  cw:describe      取清单（格式/尺寸/当前格式的选项）
       宿主 → 插件  cw:apply         写入改动
       插件 → 宿主  cw:state         主动上报当前状态（初始化与变更时）

     之所以走 postMessage 而不是让宿主去读 localStorage：
     插件的精简设置存放在 localStorage 的 'cw:' 命名空间里，键名带插件
     与格式 id，宿主无法在不猜结构的前提下可靠地解析；而且宿主改了之后
     还得让插件重绘。让插件自己作为唯一权威更简单，也避免两处逻辑打架。

     只在宿主模式启用 —— 画廊预览仍用组件自己的齿轮，两边互不干扰。
     ============================================================ */
  function sendToHost(type, payload) {
    if (viewMode() !== 'host') return;
    try {
      parent.postMessage(Object.assign({ type: type, id: (handles[0] ? handles[0].id : '') }, payload || {}), '*');
    } catch (e) { /* 脱离 iframe 时忽略 */ }
  }

  /**
   * 上次上报的清单指纹。
   *
   * 组件每秒都会 refresh 一次（时钟、倒计时这类），若每次都无条件上报，
   * 宿主每秒都要 setState 重渲染一次设置面板 —— 白烧性能。
   * 但**完全不上报**也不行：候选项可以是函数（便签按标题选），
   * 便签新增/改名/删除后清单就变了，宿主手里还是首次那份快照，
   * 面板里永远只有旧标题（这正是「按标题选」最初不生效的原因）。
   *
   * 折中：每次 refresh 都算一遍清单，与上次不同才发。
   */
  let lastReportSig = '';

  function reportState(force) {
    // 画廊预览等非宿主模式没有 parent 可报，直接跳过（省掉每秒一次的序列化）
    if (viewMode() !== 'host') return;
    const h = handles[0];
    if (!h) return;
    const desc = h.describe();
    const sig = JSON.stringify(desc);
    if (!force && sig === lastReportSig) return;
    lastReportSig = sig;
    sendToHost('cw:state', { state: h.state(), desc: desc });
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'cw:describe') {
      // 宿主明确来问 → 无论指纹是否相同都答，并刷新指纹
      const h = handles[0];
      const desc = h ? h.describe() : null;
      if (desc) lastReportSig = JSON.stringify(desc);
      sendToHost('cw:describe', { desc: desc });
    } else if (d.type === 'cw:apply') {
      const h = handles[0];
      if (!h) return;
      h.applyPatch(d.patch || {});
      reportState(true);
    }
  });

  // 初次挂载后主动上报一次，让宿主能立刻拿到清单。
  // 注意不要再往 handles 里 push —— 上面的 PL.compact 已经 push 过了，
  // 重复 push 会让 compactRefreshAll 对同一个组件刷新两次。
  const origCompact = PL.compact;
  PL.compact = function (def) {
    const h = origCompact(def);
    if (h && viewMode() === 'host') {
      // 等 DOM 就绪后再上报，避免宿主先于插件初始化
      const kick = () => reportState(true);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kick);
      else kick();
    }
    return h;
  };
})();
