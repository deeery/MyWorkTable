# Workbench · 插件式工作台

一个框架式工作台参考实现：界面分 **桌面 / 插件 / 设置 / 我的** 四个页面，左侧菜单栏导航，左下角常驻登录状态。所有功能元素以**插件**形式导入，插件接口、渲染方式、刷新频率等规格全部标准化。

> 在线试用：**<https://deeer.online/pwt/demo/>** ｜ 介绍页：<https://deeer.online/pwt>
> （部署方式与子路径约束见文末「部署到子路径」）

## 快速开始

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # 产物在 dist/
pnpm desktop    # 以独立桌面软件运行（Electron，加载 dist/）
```

> 桌面版首次需构建：`pnpm build && pnpm desktop`。
> 若 Electron 二进制未随依赖下载，设置镜像后手动执行一次
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js`。

## 架构总览

```
┌──────────┬────────────────────────────────────────────┐
│          │  桌面（自由画布 · 拖动平移 · 边缘调整尺寸）  │
│  左侧     │  插件（市场 + 已安装管理：装/停/隐/卸）      │
│  菜单栏   │  设置（主题 / 刷新倍率）                     │
│          │  我的（账号 / 数据概览）                     │
│ 登录状态  ├────────────────────────────────────────────┤
└──────────┤  插件运行时                                  │
           │  ├─ PluginManifest 协议（渲染模式/刷新/权限）│
           │  ├─ IframeHost   —— 沙箱 + postMessage 总线 │
           │  ├─ ModuleHost   —— 动态 import + 生命周期  │
           │  └─ Scheduler    —— 统一刷新调度（倍率/暂停）│
           └────────────────────────────────────────────┘
```

桌面交互：拖动空白处平移 · 滚轮缩放 · 双击背景复位 · 拖顶部栏移动卡片 ·
拖左/右边缘调整宽度（左边缘右边固定）· 拖下边缘调整高度 · 右下角同时调整。
卡片有常态可见的描边，便于在浅色背景上分辨边界；卡片被选中时右下角的
缩放三角形会隐去（避免与选中态的强调色描边叠在一起），但手柄仍可拖动。

**新窗口的落位**由 `src/core/layout.ts` 的 `findFreePosition()` 统一计算：
按被放置卡片自身的尺寸做碰撞检测，铺满一行再换行。列数取的是
**画布 `.desktop-viewport` 的 `clientWidth`**（`desktopViewportWidth()`），
不是 `window.innerWidth` —— 画布右侧还留着侧边栏，用窗口宽度会多算一列，
把新窗口摆到画布外（卡片右半边被裁掉，或者整张看不见）。
`verify-dock.cjs` 与 `.deploy\verify-online.cjs` 都固定断言这一点。

**侧边栏三形态**：标题栏上方有一个形态切换按钮，按「详细 → 迷你 → 隐藏」循环。
隐藏时该按钮仍留在主区左上角，保证随时可恢复；形态会持久化。

**卡片顶部栏**：`↧` 收起顶部栏（收起后仅保留右上角的 `↥` 恢复按钮）、`⚙` 设置、
`✕` 移出桌面（位于最右上角）。刷新与还原尺寸等操作都在 `⚙` 设置菜单里。

## 视觉设计系统

界面按 **Dark Mode (OLED)** 设计系统（来自 `ui-ux-pro-max` 设计库）重构，
令牌全部集中在 `src/styles/global.css` 顶部，分三层：

1. **原始令牌** —— 唯一允许出现 hex 的地方（`--bg` / `--fg` / `--accent` …）
2. **尺度令牌** —— 间距 `--sp-1:1px` `--sp-2:2px` `--sp-3:3px` `--sp-4:4px` `--sp-6:6px`
   `--sp-8:8px` `--sp-10:10px` `--sp-12:12px` `--sp-16:16px` `--sp-24:24px` `--sp-32:32px`
   `--sp-48:48px` `--sp-64:64px`（12px 以下 2px 步进，12px 以上 4/8 节奏；命名直接用数值，
   `--s-xs` 等旧语义名保留为别名）；字号 `--t-2xs:10px` … `--t-2xl:24px`；
   圆角 `--r-2xs:4px` `--r-xs:6px` `--r-sm:8px` `--r-md:12px` `--r-lg:16px` `--r-xl:22px` `--r-pill:999px`；
   图标 `--ico-sm:14px` `--ico-md:18px` `--ico-lg:22px`（图标尺寸不混进字号刻度）
3. **组件规则** —— 只引令牌，不写死数值

> 全站 `font-size` / `border-radius` / 间距已 100% 令牌化，裸 px 为 0；
> `tools/check-css.cjs` 会提示回潮。图标用 `src/components/icons.tsx` 的内联 SVG，
> 不用字形/emoji 当结构图标。

### 深色：深度来自「看得出」的层级差，不是「把颜色调暗」

走过两趟弯路，都记在这里，别再走回去：

| 版本 | 画布 / 面板 / 悬浮 | 结果 |
|---|---|---|
| ① 纯 OLED | `#000000` / `#0c0c0c` / `#121212` | 相邻层只差 4% 明度，卡片与画布糊成一整块 |
| ② 提亮一档 | `#12151b` / `#1a1e26` / `#232833` | 分界有了但不够 |
| ③ **现行** | `#0e1117` / `#1e2430` / `#282f3d` | 层间 RGB 差 16/19/25 + `.12~.13` 白描边 |

| 层 | 令牌 | 值 | 用途 |
|---|---|---|---|
| 画布 | `--bg` | `#0e1117` | 桌面页面底色 |
| 面板 / 卡片 | `--panel` / `--surface` / `--card` | `#1e2430` | 窗口、卡片 |
| 悬浮层 | `--surface-2` | `#282f3d` | 坞、菜单、输入框、toast |
| 侧边导轨 | `--sidebar` | `#090c11` | 最暗，把内容区衬出来 |

> ⚠ **纯黑底上的黑色面板视觉上等于没有边界**。OLED 的确省电，但一个全是卡片的
> 工作台如果分不出卡片边界，省下来的电换来的是看不清。所以这里放弃纯黑，
> 用可分辨的层级差换可读性。

强调色取 **Electric Blue `#2494ff`**（`--accent`）。注意它有两个用途，不能混：
`--accent` 当**黑底上的文字色 / 描边 / 辉光**；`--accent-solid: #006ee6` 当
**承载白字的实心底**（白字 4.80:1）。若把 `--accent` 直接压暗到能让白字达标，
它当文字色就用不了了。
CTA 保持 `#22c55e`，警示 `#ffd700`，危险 `#ff6b6b`；
另有 `--glow` / `--glow-cta` 两条霓虹光晕（只用在聚焦卡片与主按钮上，不做满屏发光）。
字体 **Inter**（`--font-sans`），启动时从 Google Fonts 加载，见 `index.html`。

> ⚠ **插件不能用写死的浅色底**。便签曾经写死 `bg = '#ffffff'`，深色主题下
> 就是一块 476×182 的纯白（相对亮度 1.0，而画布 0.006），刺眼到没法看。
> 便签是**模块型插件**，与宿主同文档、不走 iframe，宿主的深色底救不了它。
> 现在改成 `var(--card)` 跟随主题，并且 `fg` 在每次 `apply()` 按当前主题重算
> （原来只在创建时算一次，切主题文字色不更新）。`desktop/probe-bright.cjs`
> 可以随时扫出这类大亮块。


`body` 声明 `color-scheme: dark`，原生滚动条与表单控件跟着变深；
`index.html` 上写死 `data-theme="dark"` 避免首帧白闪。

### 深色是默认，浅色是覆盖

`:root` 即深色主题，浅色通过 `[data-theme='light']` 覆盖
（`--bg:#f1f5f9`、`--accent:#2563eb`、`--cta:#16a34a`，霓虹光晕收成
`0 0 0 0 transparent`）。`DEFAULT_SETTINGS.theme` 为 `'dark'`。

> ⚠ 设计库对 OLED 风格标注「只有深色」，但**工作台两套主题都必须成立**
> （设置页有浅色/深色切换，且多套回归脚本会切过去）。实测对比度：
> 深色 21.00:1、浅色 16.30:1，都远超 AAA。

> ⚠ **侧边栏在两种主题下都保持深色导轨**（Linear / VS Code 的做法）。
> `.sidebar-brand` 与 `.sidebar-toggle:hover` 里写死了 `#fff` 前景色，
> 浅色主题若把侧边栏改成白底，这些文字会直接消失。

### 排版约束（回归脚本依赖）

`desktop/` 下的 19 套验收脚本按 class 名定位元素，
**重构样式安全、改 HTML 结构会成批打断回归**。必须保留的选择器：

`.nav-item`（按文本含「桌面/插件/设置」找）· `.market-card` · `.settings-panel` ·
`.cw-opt-row` · `.plugin-card` · `.card-head .title` · `.gear` · `.dock-launch` ·
`.dock-item` · `.dock-name` · `.titlebar` · `.tb-btn`

**显示比例**：设置页可调（50%–200%，含 75/100/125/150 快捷档位）。
以 CSS `zoom` 施加在根元素上，浏览器与桌面壳通用，界面是真正变大/变小而非被拉伸。

核心源码索引：

| 模块 | 位置 | 职责 |
|---|---|---|
| 插件协议 | `src/types/plugin.ts` | Manifest / PluginContext / 消息协议类型 |
| 注册表 | `src/core/registry.ts` | 内置插件目录（可替换为远端索引服务） |
| 调度器 | `src/core/scheduler.ts` | 按刷新策略派发 tick、页面隐藏暂停、全局倍率 |
| 消息总线 | `src/core/bus.ts` | iframe postMessage 协议（origin 校验） |
| 模块加载器 | `src/core/module-loader.ts` | 动态 import + 工厂签名校验 |
| 卡片布局 | `src/core/layout.ts` | 尺寸常量 + 不重叠坐标分配（唯一来源） |
| iframe 宿主 | `src/components/IframeHost.tsx` | 沙箱渲染 + 握手 + 主题下发 |
| module 宿主 | `src/components/ModuleHost.tsx` | 生命周期管理 + ctx 注入 |
| 全局状态 | `src/state/AppContext.tsx` | 安装态/设置/账号，localStorage 持久化 |

## 内置示例插件

| 插件 | 模式 | 刷新 | 演示点 |
|---|---|---|---|
| 🕐 时钟 | iframe | 1s | 高频 tick + 主题跟随 + 时区配置下发 |
| ⛅ 天气 | iframe | 30min | 低频刷新、`pauseWhenHidden:false`、三级城市联动 |
| 📝 便签 | module | 手动(0) | storage 权限 + 防抖持久化 + 配色配置 |
| 🍅 番茄钟 | module | 1s | storage+notify 权限、canvas 圆环、默认不上桌面 |

插件开发规范详见 **[docs/PLUGIN_SPEC.md](docs/PLUGIN_SPEC.md)**。

## 技术选型说明（本项目为何这样选）

| 候选方案 | 结论 |
|---|---|
| **React 18 + Vite + TS（已采用）** | 生态最成熟；动态 import / iframe / 状态持久化均有直接支持；类型系统可把插件协议固化为编译期契约 |
| Vue 3 + Vite | 完全可行，协议层（manifest/scheduler/bus）与框架无关，可整体迁移 |
| qiankun / wujie 微前端 | 适合「多团队、多技术栈、独立仓库独立部署」的组织场景；对单人工作台偏重。其子应用加载思路与本项目的 iframe 通道一致 |
| Web Components | 插件即自定义元素，框架无关性最强，但模板/状态生态弱，开发效率低 |

插件机制的三种取舍：

- **iframe 沙箱**：隔离性最好（独立 origin、崩溃不影响宿主），代价是通信样板代码多 → 本项目用协议 + 官方握手模板摊平
- **ES Module**：开发体验最顺（直接函数调用），但插件代码与宿主同进程 → 用「manifest 权限门控 + 工厂签名校验」约束
- **混合（本项目）**：同一套 manifest 协议下两种渲染模式并存，可信插件走 module、第三方走 iframe

## 生产化路线图

- 插件索引服务（远端 manifest API + 签名校验）
- iframe 插件官方 SDK（`<script src="/plugins/sdk.js">` 封装握手/存储/权限请求）
- 账号体系替换 Mock 登录（OAuth），插件配置云端同步
- 桌面布局的吸附对齐 / 网格吸附，以及跨设备同步
- 天气数据源改为自建后端转发（当前依赖 dev server 代理，生产构建不可用）
- Electron / Tauri 壳：`PluginContext` 扩展本地文件、系统 API 能力

## 桌面软件（Electron 壳）

`desktop/` 下是一个 Electron 壳，把工作台作为**独立桌面软件**运行，并提供浏览器
无法实现的能力：

| 能力 | 说明 |
|---|---|
| 原生右键菜单 | 右键卡片 → 刷新/设置/置顶/还原尺寸/移出桌面/停用/卸载；右键空白 → 新建窗口/复位视图/放大/缩小/刷新/关于 |
| 自绘标题栏 | `frame: false` 去掉系统标题栏，改由 `src/components/TitleBar.tsx` 画（最小化 / 最大化 / 关闭） |
| 快捷键 | Ctrl+R 刷新、Ctrl+Shift+I / F12 开发者工具、F11 全屏、Ctrl+0 / Ctrl+± 缩放 |
| 外部链接 | 一律交给系统浏览器打开 |
| 单实例 | 重复启动会聚焦已有窗口 |

### 没有原生菜单栏，快捷键要自己接

窗口用 `frame: false` + `Menu.setApplicationMenu(null)` 去掉了 文件/编辑/视图/帮助
整条菜单栏，也去掉了系统标题栏 —— 目标是一条与 OLED 深色界面一致的顶栏。

> ⚠ **`setApplicationMenu(null)` 会连带干掉所有 accelerator**。菜单里原本挂的
> Ctrl+R / Ctrl+Shift+I / F11 / Ctrl+± 会一起失效，快捷键必须自己接回来：
> `main.cjs` 的 `bindShortcuts()` 用 `webContents.on('before-input-event')`
> 重新绑定。为什么不用 `globalShortcut`？后者是**全局**的，窗口失焦时照样触发。

「关于 Workbench」原本挂在帮助菜单下，菜单没了之后改挂在**空白处右键菜单**里。

### 标题栏按钮是矢量的，且状态要跟窗口对上

三个按钮是内联 SVG（`stroke="currentColor"`，颜色跟着令牌走），不是 emoji 也不是
字体字符 —— 设计库明确禁止 emoji 作结构图标，且字体细线放在纯黑上会显得灰扑扑。

- 图标状态由 `maximized` 驱动（最大化时换成「向下还原」的双框图标）
- 双击标题栏、Win+↑ 这类**不经过按钮**的路径，主进程监听 `maximize` / `unmaximize`
  事件回推 `win-max-changed` 命令，前端同步
- 渲染进程通过 `winControl(action)` / `winState()` 两个白名单 IPC 驱动窗口，
  **主进程不会把 `BrowserWindow` 实例递给渲染进程**

> ⚠ 写图标时踩过的坑：最大化/还原是三元表达式，未最大化那一支忘了套 `<svg>`，
> 只写了个裸 `<rect>` —— 裸 rect 不在 SVG 命名空间里**不会渲染**，表现是
> 「没最大化时最大化按钮一片空白」。`verify-shell.cjs` 的
> 「每个按钮都必须恰好含 1 个 `<svg>`」断言就是防这个。

架构与安全基线：

- `desktop/main.cjs` —— 主进程：建窗、窗口控制 IPC、快捷键、`ipcMain` 右键菜单处理器
- `desktop/preload.cjs` —— 经 `contextBridge` 只暴露白名单 API
  （`showContextMenu` / `onCommand` / `isDesktop` / `scanApps` / `launchApp` /
  `winControl` / `winState`），**不开启 nodeIntegration**、保持 `contextIsolation`，
  渲染进程拿不到任何 Node 能力
- `src/components/TitleBar.tsx` —— 自绘标题栏。`isDesktop()` 为 false 时
  `return null`：网页版没有真实窗口，画一排点了没反应的按钮纯属误导
- `src/core/desktop.ts` —— 前端桥接：浏览器下所有调用安全降级为 no-op，
  因此**同一份代码同时跑在浏览器与桌面壳里**
- `src/core/cardActions.ts` —— 卡片动作注册表：原生菜单在主进程构建，
  但要执行的动作属于卡片内部实现，靠它按插件 id 桥接

构建产物使用**相对资源路径**（`vite.config.ts` 的 `base: './'`），
并统一经 `src/core/url.ts` 解析以 `/` 开头的插件入口 —— 否则 `file://` 下会解析到
磁盘根目录而白屏。

验收脚本 `desktop/verify.cjs` 会用真实主进程跑一遍并输出断言结果
（面板锚定、点母界面关闭、配色联动、顶栏布局、顶部栏收起、侧边栏三形态、
右键菜单项、菜单命令往返）。`desktop/verify-shell.cjs` 专验这一节的内容
（原生菜单确实为 null、标题栏高度与三个矢量按钮、按钮真的驱动窗口、
Ctrl+R 刷新仍生效、OLED 令牌与对比度、浅色主题仍成立、布局没被标题栏顶破）。
窗口以离屏方式运行，测试时不会弹窗：

```bash
pnpm build
node_modules/electron/dist/electron.exe desktop/verify.cjs
node_modules/electron/dist/electron.exe desktop/verify-shell.cjs
node_modules/electron/dist/electron.exe desktop/shot-shell.cjs   # 出图到 shots/
```

## 来自 plugin-lab 的插件

`plugin-lab/` 里有 51 个单文件 HTML 桌面小工具。其中 **23 个已镜像进本工作台**
（编号 01 02 03 04 06 07 08 09 10 12 13 16 18 19 22 26 27 29 30 42 46 50 51），
它们同时也是「含桌面精简形态」的那批（51 喵酱桌宠是悬浮插件，无精简形态）。
镜像后插件市场共 **27 个**（23 个 lab 插件 + 4 个内置示例）。

**镜像方式**（`plugin-lab/tools/mirror-to-workbench.mjs`）：

```
plugin-lab/plugins/07-countdown-days.html   →   public/lab/plugins/07-countdown-days.html
plugin-lab/assets/{theme,compact}.css,*.js   →   public/lab/assets/…
```

目录层级与源**完全一致**（`plugins/` 与 `assets/` 平级），因此插件内的
`../assets/pl.js` 等相对引用零改动可用；插件源码一行都不用改。

镜像产物 **`public/lab/` 是提交进仓库的**（不是构建时生成）：这样单独克隆本仓库
即可直接 `pnpm dev` / `pnpm build`，不依赖同级的 `plugin-lab/`。
plugin-lab 那边改了插件后，重新跑一次镜像脚本并提交即可。

> ⚠ 踩过的坑：一开始镜像成 `public/plugins/lab/`，多了一层目录导致
> `../assets/pl.js` 解析到 `/plugins/assets/pl.js`（不存在）。更隐蔽的是
> Vite 的 SPA fallback 会对未知路径返回 **200 + index.html**，于是 `<script>`
> 拿到 HTML 而非 JS，**脚本静默不执行** —— 页面静态部分照常显示，看起来像"能用"。
> 镜像后务必用 `verify-mirror.mjs` 确认资源 `content-type` 正确、且 iframe 内 `PL` 已定义。

注册在 `src/core/lab-plugins.ts`（由镜像脚本生成），以 `iframe` 模式加载，
复用宿主已有的 `PluginBus` 握手与主题下发。插件侧由镜像版 `pl.js` 末尾的
一段桥接代码接收 `workbench:init` / `workbench:theme`（两边都用 `data-theme`，
取值也都是 `light`/`dark`，故直接可用）。

验证：

```bash
# 需先启动本工作台的 dev server
cd plugin-lab && node tools/verify-mirror.mjs
```

它会检查资源可达性与 content-type、在真实 iframe 里完成握手、确认完整窗口渲染、
主题桥接与热切换生效、以及精简形态挂载并隐藏完整窗口。

桌面端端到端（市场 → 安装 → 桌面渲染 + 主题下发）：

```bash
pnpm build
node_modules/electron/dist/electron.exe desktop/verify-desktop.cjs
# 卡片在「完整窗口 / 桌面精简」之间切换
node_modules/electron/dist/electron.exe desktop/verify-viewswitch.cjs
```

### 工作台：像浏览器标签页一样管理布局

一个**工作台**是一份独立的插件布局快照。同一批已安装插件，在不同工作台里
可以摆在不同位置、显示不同的子集。

数据模型拆成两层（`core/storage.ts`）：

```
installed:  InstalledPlugin[]   全局：manifest / enabled
workspaces: Workspace[]         每个工作台一份窗口数组
  windows: WindowInstance[]       桌面上的全部卡片（有序，可重复同一插件）
    { id, pluginId, visible, size, x, y, w, h, collapsed, config }
```

**「装没装」「启用没启用」是全局的，「摆在哪儿」「怎么配」是窗口自己的。**
组件消费的是两者合并后的 `PluginView`。

> ⚠ **`PluginView.id` 是窗口实例 id，不是插件 id。** 这是整个多窗口机制的
> 枢纽，也是最容易搞错的地方：
>
> | 操作用哪把键 | 用 `winId`（`plugin.id`） | 用 `pluginId`（`plugin.pluginId`） |
> | --- | --- | --- |
> | 位置 / 尺寸 / 可见 / 收起 | ✅ | |
> | 该窗口的设置（config） | ✅ | |
> | 聚焦 / 关闭窗口 | ✅ | |
> | 新建窗口 | | ✅ |
> | 启用停用 / 安装卸载 | | ✅ |
> | 插件坞排序 | | ✅ |
>
> 用错键的症状：改 A 的尺寸结果 B 也变了（用了 pluginId）；
> 或者关掉一个窗口把同插件的其他窗口一起关了。
>
> 连带要改的地方（都踩过）：React `key`、`registerCardActions` 的键、
> 桌面壳右键菜单命令的 `id`、`scheduler.register` 的 id、
> `OverlayHost` 的位置存储键。

### 多窗口：同一个插件可以开多个

同一个插件可以在一个工作台里开任意多个窗口，各自独立：

- **位置 / 尺寸**各自独立（拖开一个，另一个不动）
- **设置各自独立** —— 最典型的用法就是「两个世界时钟看不同时区」
  「两个倒数日盯不同的事」。共享设置的话两个窗口长得一模一样，多开就没意义
- **✕ 只关这一个窗口**；插件仍在插件坞里，随时可以再建
- 开了 2 个以上时，卡片标题旁显示 `#2` `#3` 序号（单窗口不显示，免得莫名多个 #1）

开窗口的三个入口：右下角插件坞、卡片头上的 `⧉`、插件页的「＋ 新建窗口」。

> ⚠ **序号只数可见窗口。** 每个已安装插件在新建工作台时都会被补一个
> `visible: false` 的占位窗口（这样插件坞里点一下就能建出来）。
> 序号若把占位也算进去，桌面上唯一一张卡片会显示成 `#2` 甚至 `#3` ——
> 用户看到「只有一张卡却写着 #3」会以为还有两张没显示。
> 同理 `countWindows`（坞里「已开 N 个」）也必须只数可见的，
> 否则刚建好的空工作台里每个插件都显示「已开 1 个」。
>
> ⚠ 旧数据（`slots: Record<插件id, 布局>`）会自动迁移成窗口数组，
> 每个 slot 变成一个窗口实例，用户升级后看到的桌面与升级前完全一致。
> 更旧的数据（布局与全局信息混在一个数组里）也能一路迁上来。
> 迁移链见 `normalizeWorkspaces()` / `migrateFlat()`。

交互（顶部栏，见下文）：新建 ＋ / 关闭 ✕ / 双击重命名 / ☆ 设默认 /
右键菜单（重命名 / 设为默认 / 复制一份 / 关闭）。

**新建的工作台是一张空桌面** —— 不继承当前工作台的任何插件。> 早先这里继承的是「插件可见性」，理由是「否则新建出来是空的，还得
> 一个个手动加回来」。实际用下来反了：用户新建工作台多半就是想从零
> 摆一套，结果一进来就被塞满上一套的插件，还得先一个个移出去。
> 清空更符合「新建」的直觉。
>
> 空桌面不等于插件被卸载：每个已安装插件仍会补一份 `visible: false`
> 的 slot，插件坞里点一下就能放到这个工作台上（`desktop/verify-newws.cjs`
> 对这两件事都有断言）。要「带着布局新建」用右键菜单的**复制一份**。

**默认工作台**就是 `activeWorkspace` —— 不另存一个 `defaultId`，
避免出现「默认指向一个已删除的工作台」这种悬空引用。

### 卡片内条目拖放：排序 / 拆成新窗口 / 并入别的窗口

插件内部的**条目**（目前只有快速便签的标签）可以拖动，三种落点三种结果：

| 落点 | 结果 |
| --- | --- |
| 还在自己卡片里 | 调整顺序（出现绿色插入位竖条） |
| 拖到自己卡片外、没落到别的卡片 | **拆成一个新窗口**，只装被拖走的那一条 |
| 落到**同一个插件的另一个窗口**上 | **并进那个窗口**（卡片描虚线框，提示语写目标窗口名） |
| 落到别的插件窗口上 | 什么都不做 |

「哪几张归哪个窗口」存在**窗口级** `config.notes`（逗号分隔的条目 id）。
没写这个键 = 显示全部 —— 这是向后兼容的关键：老窗口的 `config` 里没有
`notes`，行为必须和以前一模一样。记了但相关条目全被删光时也回落到全部，
不让窗口空着。

> ⚠ **落点判定与窗口操作全在宿主**，插件只负责「报账」。
> 插件在 iframe 里看不见别的卡片、也不能新建窗口或改别的窗口的配置。
> 消息分两趟：
>
> - 插件 → 宿主 `pl:card-drag`（`cardDrag.ts` 的 `CARD_ITEM_DRAG`）：
>   `{ winId, itemId, itemLabel, allIds, phase, x, y }`。
>   `phase` 走 `start` / `move` / `end` / `cancel`；`x`/`y` 是**父页面视口坐标**
>   （iframe 被画布 `transform: scale()` 缩放过，直接发 `clientX` 会偏，
>   插件侧用 `frameElement.getBoundingClientRect()` 与 `clientWidth` 的比值还原）。
>   `allIds` 随消息一起带来，宿主才能在松手那一瞬间直接算出两边各该留哪些 ——
>   否则得反问一轮插件，松手到生效之间有可见延迟。
> - 宿主 → 插件 `pl:card-drop`：`{ kind, targetWinId, targetLabel, final }`，
>   `kind` 是 `own` / `merge` / `tearout` / `none`。
>
> **`move` 阶段的 `kind` 只用来做视觉反馈**（虚线框、插入位竖条），
> 真正的改动只发生在 `end`。

> ⚠ **四种 `kind` 都必须回 `final`。** 只回一部分的话，插件那边的
> `draggingId` / 待插入位置 / 拖出标记三个状态永远不复位，
> `#tabs` 上的虚线框也摘不掉 —— 标签栏会一直描着虚线，而且下一次拖动的
> 起始状态是脏的。提示语（「已拆成独立窗口喵~」）更是永远不出现。
> 这个 bug 真出现过：原来只有 `own` 与 `none` 会回执。

> ⚠ **合并时必须先判断源窗口拆不拆得开，再动目标窗口。** 反过来写
> （先把条目塞进目标，再发现源窗口只剩一张而放弃）的结果是条目**同时留在
> 两个窗口里**：源窗口回 `none`（什么都没做），目标窗口却已经被加了这一条。
> 规则是「源窗口拆完不能为空」—— 宁可整件事不做，也不能做一半。

> ⚠ **拖出/合并后新窗口的归属必须随 `openWindow` 一起给。**
> `AppContext.openWindow(pluginId, config)` 的第二个参数就是为这个加的：
> 新窗口若先按默认（显示全部）渲染一帧再收窄，肉眼能看见闪一下。

验收：`desktop/verify-notesdrag.cjs`（排序 / 拆出 / 合并 / **源窗口只剩一张时
整体拒绝**四件事，其中拒绝那节还会断言目标窗口没被改、两边虚线框都摘掉了）。
截图：`desktop/shot-notesdrag.cjs` → `shots/notes-1-tabs.png` ~
`notes-4-merge.png`。

### 新建窗口 = 插件坞（右下角）

右下角那个带计数的 `＋` 圆钮是**桌面唯一的「新建窗口」入口**：
点开面板 → 点一个插件 → 它的窗口就建到桌面上。

- 最多同时显示 **10 个**，超出用搜索找
- 可拖动排序；顺序单独存在 `workbench:dock-order:v1`，**不复用**工作台的
  slot 顺序 —— 坞是按使用频率排的，桌面布局顺序是另一回事，
  混在一起会让拖坞里的一项意外改动桌面层级
- 支持搜索插件名 / 描述 / id
- 每项带描述与状态徽标（已在桌面 / 悬浮 / 已停用）

**点击的语义**（这是「新建窗口」而不是「切换开关」）：

| 插件状态 | 点击后 |
| --- | --- |
| 不在桌面 | 建出窗口（= 上桌面）并置顶，面板自动收起 |
| 已在桌面 | 不重复建，只把它置顶 |
| 已停用 | 先自动启用再建窗口（否则建出来是个空壳） |

面板标题是「新建窗口」，副标题「点击一个插件，把它的窗口建到桌面上」，
把这个语义写在脸上，免得用户以为是「添加插件到列表」。

> **合并说明**：这里原本与桌面右下角的「＋新建窗口」按钮并存 ——
> 两者功能完全重叠（都是「列出插件 → 点一下放到桌面」），只是表现不同：
> `＋` 面板有描述与状态徽标但不可拖动、无搜索；插件坞可拖动可搜索但信息较简。
> 两个入口做同一件事，用户还得猜该点哪个。现在合并成一个：以插件坞为底，
> 吸收 `＋` 面板的描述与徽标，`.add-panel` / `.new-window-btn` / `.add-shield`
> 连同它们的 CSS 一并删除。
>
> 桌面右键菜单的「新建窗口」由桌面壳主进程下发 `open-add` 命令 ——
> 插件坞挂在 `App` 层，`Desktop` 与它不在同一棵子树，故用一个
> `window` 级 `CustomEvent`（`OPEN_DOCK_EVENT`）打通，
> 比为这一件事加一份 context state 轻。

> ⚠ **右下角控件曾互相重叠**：`＋新建窗口` 与 `插件坞` 各写各的
> `bottom/right`（24/24 与 22/22），两个圆钮几乎完全重合，点哪个全看
> z-index。当时用一组共享的定位变量 `--corner-right` / `--corner-bottom` /
> `--corner-slot` 让它们按「第几格」横向排开。现在只剩一个控件，
> 但这组变量保留着 —— 以后若再往右下角加东西，按格排就不会重蹈覆辙。
> 验收：`desktop/verify-corner.cjs`（断言旧按钮确实已不存在 +
> 面板完整在视口内），`desktop/verify-dock.cjs`（点击真的建出窗口）。

### 卡片圆角：为什么必须 `overflow: clip`

卡片内的 `.card-head` 有 `background: var(--panel)`（不透明）且
`border-radius: 0`，而卡片自己是 `border-radius: 14px`。
卡片原来是 `overflow: visible`，于是 `.card-head` 用自己的**直角**
盖住了卡片的圆角 —— 四角看起来是白的、描边被切断。

改成 `overflow: clip` 让子元素被圆角裁掉。用 `clip` 而不是 `hidden`：
两者都不产生滚动条，但 `hidden` 会创建滚动容器（子元素仍可被程序化
`scrollLeft/scrollTop` 移动），`clip` 完全不滚动，语义更准确。

> ⚠ 代价：卡片内容再也不能溢出到卡片外。设置面板是 portal 到 `body` 的，
> 不受影响；右下角缩放把手绝对定位在卡片边缘内，也不受影响。
>
> 验收手法：对卡片四角用 `elementFromPoint` 取点，命中 `.desktop-canvas`
> 才说明圆角外的区域真的透出了背景；命中白色子元素就是被盖住了。

### 双形态：桌面精简（默认） / 完整内容

plugin-lab 的插件支持这些视图参数：

| 参数 | 表现 |
| --- | --- |
| `?view=host` | **默认**。精简组件，**抹掉 `.cw` 自身的边框/圆角/阴影**，且不渲染组件内的齿轮与浮层设置 |
| `?view=compact` | 精简组件，保留立体感（圆角 + 投影 + 毛玻璃）与组件内齿轮（画廊预览用） |
| `?view=embed` | 完整内容，**不套插件自己的 `.win` 外壳** |
| 无参数 | 插件完整窗口（仅独立打开时出现） |

宿主侧对应 `manifest.compact`：

```ts
{
  entry: '/lab/plugins/07-countdown-days.html',
  compact: { size: 'S' },   // 声明后卡片设置菜单里出现「显示形态」切换
}
```

用户在卡片齿轮菜单里切换后，选择写进该插件的 `config.view`，
`IframeHost` 据此拼出 URL 并以 `key` 强制重挂载。

切换形态时卡片尺寸跟着换档（精简 → `S` 280×180，完整 → `M` 480×220），
**左上角坐标保持不变** —— 用户是刻意摆过位置的，切换不该让卡片在桌面上跳走。
注意要一并 `setDim(id, undefined, undefined)` 清掉手动拖拽留下的 `w/h`，
否则 `cardW = plugin.w ?? SIZE_W[size]` 会让旧值盖过档位值，来回切几次尺寸就卡住。

### 精简设置：全部收进卡片设置的二级界面

精简形态下组件**只出内容**：齿轮、浮层编辑菜单、角标都不渲染。
卡片自己已有齿轮与设置面板，组件内部再放一套就成了「设置里套设置」——
两处都能改同一份设置、样式还不一样，用户不知道该动哪个。

所以卡片设置面板里给了一个二级入口，**精简时默认展开**、**完整时整个隐藏**
（入口与二级界面都带 `isCompactView` 判断）：

```
精简形态 —— 开面板直接就能看到
  显示形态    [🧩 桌面精简] [🪟 完整内容]
  精简设置    [ 收起 ▲ ]                    ← 默认展开
              ├ 显示格式   📅单日期  📋最近几条  🔢事件数
              ├ 组件尺寸   迷你  方形  宽版  竖版  横幅
              └ 选项       显示条数 [3] / 显示事件名 [开关] / …

完整形态 —— 精简设置整段不渲染
  显示形态    [🧩 桌面精简] [🪟 完整内容]
  （完）
```

默认展开是因为它已经是精简形态下**全部**的设置入口，藏起来还要多点一次，
而格式和尺寸恰好是这个形态下最常调的东西。`useState(isCompactView)` 取初值，
`switchView('compact')` 时也重新展开，用户不用记自己上次收没收起过。

清单由插件 `describe()` 上报，宿主**不解释插件内部结构**，只负责渲染与回传：

| 方向 | 消息 | 载荷 |
| --- | --- | --- |
| 宿主 → 插件 | `cw:describe` | — |
| 宿主 → 插件 | `cw:apply` | `{ format?, size?, opts? }` |
| 插件 → 宿主 | `cw:state` | `{ state, desc }` |

实现散在四处，改动时注意一起动：

| 文件 | 改什么 |
| --- | --- |
| `plugin-lab/assets/compact.js` | `describe()` / `applyPatch()` + 末尾的消息桥 |
| `src/types/plugin.ts` | `CompactDescription` / `CompactHostMessage` / `CompactPluginMessage` |
| `src/core/bus.ts` | `listen()` 的白名单加 `^cw:` |
| `src/components/IframeHost.tsx` | 把 `cw:*` 转发给 `cwRef` 的订阅者 |

> ⚠ `bus.ts` 的白名单原本只放行 `plugin:` 前缀。漏掉 `^cw:` 会表现为
> 「插件上报了但宿主收不到，二级界面一直停在『正在向插件取精简设置…』」。

验收：`desktop/verify-cwsettings.cjs`（组件内无齿轮 + 精简时默认展开 +
改格式/尺寸/选项真的生效 + 刷新后不丢 + 完整时隐藏 + 切回精简能恢复）。

### 快捷启动器：拉取系统应用并真正启动

插件 #08（快捷启动器）原本内置 20 个写死的假应用，点「启动」只加计数、
什么都不做。现在改成拉取**系统开始菜单里真实安装的应用**并真正启动。

```
插件 (iframe 沙箱)          宿主 (渲染进程)         桌面壳 (主进程)
     │                          │                       │
     │──wb:apps-request────────▶│                       │
     │                          │──scanApps()──────────▶│  扫开始菜单
     │                          │◀─164 个应用───────────│
     │◀─wb:apps { apps }────────│                       │
     │  渲染真实图标与名字        │                       │
     │                          │                       │
     │──wb:launch { target }───▶│──launchApp()─────────▶│  exec / openExternal
     │◀─wb:launch-result────────│◀─ok / err─────────────│
```

插件是沙箱 iframe，不能读文件系统也不能起进程 —— 所以它只负责渲染与转发，
真正的事都由主进程做（`desktop/main.cjs` 的 `scanApps` / `launchApp`）。

扫描范围限定在开始菜单的三个标准目录，只取 `.lnk` / `.url` / `.exe`，
按名称去重并跳过卸载程序（`uninstall` / `卸载` / `help` 之类）。

> ⚠ **踩过的两个坑，都表现为「拉不到应用」**：
>
> 1. **字段名不一致**：宿主发 `{ type, payload: apps }`，插件读的是
>    `d.apps` —— 插件永远拿不到，一直用内置兜底清单。消息字段必须两边对齐。
> 2. **时序竞态**：iframe 在 JSX 里创建后立刻加载，而 `bus.listen` 注册在
>    `useEffect`（paint 之后）。本地文件加载极快，插件的 `wb:apps-request`
>    可能在监听挂上之前就发出来了。所以宿主在 `plugin:ready` 握手时**主动推**
>    一次清单（那个时点监听必然已就位），插件侧也保留主动要一次，双保险。
>
> 另外 `bus.ts` 的白名单要放行 `^wb:`。

验收：`desktop/verify-launch.cjs`。启动能力用一个自造的 `.cmd`
（只做「写标记文件然后退出」）来测，既验证 `exec` 链路真的执行了目标，
又不会在用户机器上弹出真实软件。同时断言「启动不存在的程序要如实报错」——
Windows 上 `exec` 经 `cmd.exe` 执行，目标不存在时 `cmd.exe` 自己启动成功、
只返回退出码 1，`err.code` 是数字不是 `'ENOENT'`，只看 `err.code`
会把失败当成功（实测确实如此，故改为先判路径存在性）。

### 已移除：定位模式

曾有一个「⇄ 定位模式」按钮：进入后拖一张卡片到另一张上即互换位置。
**已按需求删除**，原因：桌面本来就支持直接拖卡片移动，再叠一套
「拖到别张卡上换位」的拖拽，两种行为落在同一个手势上，用户分不清
这次拖是移动还是换位，实际使用中作用不明显。

（删掉它顺带修掉了一个坑：HTML5 拖放事件不穿透 iframe，当时得在
卡片正文上盖一层透明遮罩才能让 drop 生效。现在整套都不需要了。）

### 背景样式与顶部栏

背景由 `<Backdrop>` 组件渲染（fixed + `z-index:0`，`.app-shell` 是 `z-index:1`），
在 `<html>` 上写 `data-bg` 选分支：

| 样式 | 实现 |
| --- | --- |
| 纯色 | `.main` 用 `var(--bg)` |
| 点阵 / 网格 | 两层 `radial-gradient` / `linear-gradient` |
| 光晕 | 两团斜对角的 `radial-gradient` 色块 |
| 自定义图片 | `--bg-image` + 一层暗膜（浅色图上的文字仍可读） |
| 自定义视频 | `<video>` + 暗膜；**切走即卸载**，不在后台继续解码耗电 |

图片/视频转成 data URL 存进 localStorage，上限 4MB（localStorage 只有
5~10MB，超了会静默写入失败，表现为「选了图片但背景没变」）。

### 桌面交互：边缘自适应缩边

拖卡片时，鼠标顶到屏幕边缘就动不了了，而卡片还没拖到位 ——
表现为「鼠标与卡片分离」。Desktop 监听卡片发来的 `CARD_DRAG_EVENT`：

- 鼠标进入距视口边缘 `EDGE_ZONE`(90px) 的范围内时，按进入深度
  把显示比例调小（最多缩到一半，下限 `MIN_DRAG_ZOOM` = 0.35），
  一屏能看到更大的画布范围，鼠标继续移动就能继续带动卡片
- **松手严格脱钩**：缩放回到拖动前的值，此后鼠标位置不再影响任何东西

> ⚠ 拖拽的位移换算必须**逐帧累加增量**，不能记「起点→当前」的总位移
> 再除以缩放 —— 缩放是拖动过程中会变的，用总位移除当前缩放会把前面
> 那段按新缩放重算，卡片突然跳一下。见 `PluginCard` 的 `dragRef` 注释。
>
> ⚠ 松手后不还给用户原本的缩放，拖几次卡片工作台就越来越小。
> 用 `dragZoomBaseRef` 记住拖动前的值，结束时原样还回去。

验收：`desktop/verify-global.cjs`（实测 `start:1 → atEdge:0.5 → afterUp:1 → afterMove:1`）。

### 卡片尺寸：跟随窗口，不再单独设置

组件尺寸原本有两套来源 —— 插件侧的 `sz-*` 档位（140×140、96×96…）
与宿主卡片的尺寸档位，两者互相打架：

- 卡片拉得很大，组件还是 140px 的小方块，四周一大片空白
- 卡片拖得很小，组件溢出、出现滚动条

现在统一成一条规则：**宿主模式下组件铺满容器**，尺寸完全由窗口决定。
「组件尺寸」那一组设置已从精简设置里移除，用户只要拖卡片即可。
`?view=compact`（画廊预览）仍保留档位，那里组件是页面主角。

> ⚠ 切到「完整内容」时的高度：插件按 400px 宽 / 500~2000px 高设计，
> 早先套用 M 档的「最小高度」220px 只露出一条缝。现在显式给
> `FULL_VIEW_H = 640`（见 `PluginCard.tsx`），用户仍可自行拖右下角调整。

### 背景样式为什么在桌面页看不到

`.wb-backdrop` 是 `fixed + z-index:0`，垫在 `.app-shell` 之下。
而 `.desktop-viewport` 铺满整块主区域且原本写死了
`background: var(--bg)`（不透明）—— 于是点阵/网格/自定义图片
**只在桌面页**看不见（设置页没有这层遮挡，所以那边正常）。

修法：`.main` 与 `.desktop-viewport` 一律 `background: transparent`，
底色统一交给 `.wb-backdrop`（它自己就画了 `background-color: var(--bg)`），
这样「纯色」与其它模式走同一条路径，不会出现两处底色不一致。

验收：`desktop/verify-global.cjs` 断言 viewport 的计算背景是透明的、
且切到点阵后 backdrop 真的有 `radial-gradient`。

### 顶部栏（唯一的一条，只做工作台选择）

各页原有的「页面标题 + 描述」顶部栏**已全部移除** —— 那一条只是重复说明
「你在哪一页」，而侧边栏高亮已经把这件事说清楚了。现在顶部栏只做一件事：
**选工作台**。因此它平时也不该占地方：

- **默认锁定展开**（40px）。锁定态才看得出有几个工作台、当前在哪个；
  自动缩入虽省空间，但新用户一进来只看到一条细线，不知道那里能点
- 解锁后：鼠标不在上面时**自动缩成一条细线**（6px，中间一条短横线提示可展开），
  鼠标移上去展开
- 右侧锁形按钮切换锁定 / 自动
- 配色用 `--topbar-bg` / `--topbar-line`，与主背景拉开层次

> ⚠ **CSS 优先级陷阱**（踩过）：收起态写成 `.ws-bar:not(.expanded){height:6px}`
> 时权重是 (0,2,0)，而展开态 `.ws-bar{height:40px}` 只有 (0,1,0) ——
> `:not()` 里的类也计入权重，于是**收起规则反而压过展开规则**，
> 无论加不加 `.expanded` 高度都停在 6px。正确写法：两条规则同权重，
> 先写收起、后写展开，靠源码顺序决胜。

> ⚠ **验收环境陷阱**：验收窗口是 `show:false` 的离屏窗口，Chromium 在其中
> **不推进 CSS 过渡**。顶部栏的展开靠 `transition: height/opacity`，于是
> 高度与透明度会永远停在起始值 —— 表现为「加了 `.expanded` 但高度还是 6px」，
> 看起来像功能坏了。对照实验：注入 `transition:none` 后立刻变成 40px；
> 把窗口 `show()` 出来也立刻正确。故 `verify-topbar.cjs` 里先禁用过渡再断言。
> （注意要在页面 reload **之后**注入 —— 注入的 `<style>` 活不过重载。）

> ⚠ 模拟 hover 不能用 `dispatchEvent(new MouseEvent('mouseenter'))`：
> React 的 `onMouseEnter` 是靠 mouseover/mouseout 事件委托实现的，
> 手工派发的 mouseenter 不被识别。要用 `webContents.sendInputEvent` 发真实鼠标移动。

验收：`desktop/verify-topbar.cjs`（收起 6px → 移入展开 40px → 移出缩回 →
锁定后不缩 → 解锁恢复），`desktop/verify-features.cjs` 做存在性检查。

### 悬浮插件（桌宠）

桌宠**是一个插件**：plugin-lab **#51 喵酱桌宠**，走 `manifest.overlay`，
由 `OverlayHost` 渲染成 `position:fixed` 的浮动层。装了才有，卸载就消失。

它跟普通插件的区别：

| | 普通插件 | 悬浮插件（overlay） |
| --- | --- | --- |
| 渲染 | 桌面卡片（占 x/y/w/h） | fixed 浮动层，不占坐标 |
| 桌面画布缩放 | 跟着 `transform: scale` 变形 | **不受影响**（贴屏幕上） |
| 出现在布局 / 插件坞 | 是 | **否** |

拖动实现有个绕不开的地方：鼠标事件发生在 iframe 内部（那里才能准确拿到
按下/移动/抬起），但 **iframe 不能移动自己的父元素**。所以插件把位移
`postMessage` 出来（`pl:pet-move`），由 `OverlayHost` 累加并移动容器；
位置按插件 id 存进 localStorage。

镜像脚本靠源码里的 `data-overlay=` 标记识别悬浮插件（见
`mirror-to-workbench.mjs`），`verify-mirror.mjs` 对它们跳过
`.win` / `.cw` 断言 —— 悬浮插件按设计就没有这两个东西。

### 已移除：分页器

曾有一个「每页 4 个插件」的分页器（临时验收设施）。
**已按需求删除**，原因：它与「工作台」语义重叠 —— 两者都是
「切换一组插件视图」，用户面对两套切换机制会困惑
（想换一组插件到底该点标签还是点箭头？）。
现在统一由工作台承担：要分屏看就新建一个工作台。

### 为什么要「去壳」

宿主卡片本身已经是一个窗口（标题栏、圆角、阴影俱全）。插件若再渲染自己的
外壳，就成了「窗口里套窗口」—— 两层标题栏重复显示同一个名字、双份圆角阴影，
且插件按 400px 宽设计的内容会被挤进窄卡片里并严重溢出。

所以两种形态各去一层壳：

| 形态 | 抹掉什么 | 效果 |
| --- | --- | --- |
| 桌面精简 `host` | `.cw` 的 border / radius / shadow / backdrop-filter | 卡片是唯一那层窗口 |
| 完整内容 `embed` | `.win` 的外壳 + 隐藏 `.win-head` / `.win-foot` | 同上 |

实测（`desktop/verify-viewswitch.cjs` 对两个形态都强制断言）：

```
精简  ?view=host    html.pl-host    .cw  radius 0px · border 0px · shadow none
                                   无 .cw-gear / .cw-editor / .cw-dot
完整  ?view=embed   html.pl-embed   .win win-flat（radius 0px · border 0px · shadow none）
```

保留 `?view=compact` 供画廊独立预览 —— 那里 `.cw` 就是页面主角，
投影和毛玻璃是刻意的设计，且没有宿主窗口，多层外壳不构成问题。

> ⚠ embed 必须同时把 `body` 的 `display` 从 `grid` 改回 `block`。
> `theme.css` 里 `body { display:grid; place-items:center }` 是用于把窗口在整页居中的；
> 嵌入时若保留它，`.win` 会被 shrink-to-fit 塌成几十像素宽、**文字逐字竖排**。

> 用 URL 参数而不是 postMessage：插件在解析 URL 时就能决定渲染哪一套 DOM，
> 不必等握手，也不会先渲染完整窗口再隐藏（避免闪烁）。

### file:// 下的 postMessage 陷阱

Electron 桌面壳用 `file://` 加载产物时，iframe 的 `location.origin` 在 Chromium 里
是字符串 **`"file://"`**（不是 `"null"`）。而 `postMessage` 的 `targetOrigin`
不接受它，会抛 `SyntaxError`，消息**根本发不出去** —— 表现为插件收不到
`workbench:init` / `workbench:theme`，主题与配置全部失效，但插件本身照常渲染，
所以只看界面很难发现。

`src/core/bus.ts` 因此只在 origin 是 `*` / `/` / `http(s)://…` 时才把它当
`targetOrigin`，其余一律退化为 `'*'`；安全性由 `listen()` 的 `e.source`
校验保证（窗口对象引用无法被第三方伪造）。

## 已知取舍

- **坐标换算有两级缩放**：桌面画布用 `transform: scale()` 缩放，界面显示比例用
  CSS `zoom`。二者叠加后，`getBoundingClientRect()` 给的是**视觉**坐标，而样式里的
  `top/right/width` 是**布局**坐标，相差 zoom 倍率。混用会导致定位按比例偏移
  （实测 150% 下设置面板跑偏 154px）。凡是要按视觉位置摆放元素，务必走
  `src/core/uiScale.ts` 的换算（`toLayoutPx` / `visualDeltaToCanvas`）。

- **iframe 沙箱对内置插件不构成安全边界**：内置插件与宿主同源且带 `allow-same-origin`，
  可访问宿主 DOM；如需真正的第三方隔离，应去掉 `allow-same-origin` 并相应调整
  origin 校验与插件内的同源请求。
- **`module-loader` 使用 `new Function` 构造动态 import**：绕过打包器静态分析，
  但在启用严格 CSP（无 `unsafe-eval`）的环境下会失败。
- **部分协议消息未实现**：`plugin:resize` / `plugin:storage` / `plugin:profile` 与
  `workbench:resize` 尚无宿主实现，详见 [docs/PLUGIN_SPEC.md](docs/PLUGIN_SPEC.md) §7。

## 插件设置面板（声明式）

插件在 manifest 里声明 `settings` 字段，宿主即自动渲染齿轮面板，**无需改动宿主源码**：

```ts
settings: {
  title: '便签设置',
  fields: [
    {
      type: 'select', key: 'fontSize', label: '字体大小', default: '13',
      options: [{ value: '11', label: '小 11' }, { value: '13', label: '中 13' }],
    },
    { type: 'font',    key: 'font', label: '字体', fonts: 'ui', default: 'inherit' },
    { type: 'palette', key: 'bg', pairWith: 'fg', label: '配色', palette: 'note' },
  ],
}
```

支持的字段类型：`text` / `number` / `color` / `palette` / `font` / `select` / `cascade`
（省市区三级联动，需提供 `{ provinces: [...] }` 形状的 JSON 数据源）。
所有值以字符串写入 `config`，再经 `PluginContext.config`（module）或
`workbench:config`（iframe）下发给插件。

### 预设配色

`palette` 渲染为 **4×4 的配色对网格**：每一项是「色块 │ 竖线 │ 色块」的组合 ——
**左半是背景色、右半是与之自动搭配的可读字体色**，左半上还用该字体色写着 `Aa` 示例。
用户一眼就能看到整组配色效果，不必预先知道十六进制值。

声明 `pairWith` 后，**点击一项即同时写入底色与配对字色**（自动搭配，无需自己判断对比度）。
内置 `note` 色板 16 组，取自 Material 50/100 级浅色与主流笔记应用的便签配色。

每对配色都经 WCAG 对比度校验，实测全部 ≥ 5.3:1（AA 正文要求 4.5:1），
因此用户无法选出看不清的组合。色板定义在 `src/core/palettes.ts`。

### 字体下拉表格

`font` 渲染为下拉表格，**每个选项以该字体本身显示字体名与示例文字**（所见即所得）。
内置 `ui` 清单收录各平台普遍存在的字体，每项都带完整回退链，避免所选字体在用户
系统上缺失时显示异常。清单定义在 `src/core/fonts.ts`。

## 部署到子路径（deeer.online/pwt/demo）

线上演示地址：**<https://deeer.online/pwt>**（介绍页），
按钮进入 **<https://deeer.online/pwt/demo/>** 试用工作台。

### 关键约束：`/` 开头的资源路径必须走 `resolveAppUrl`

构建产物用相对路径（`vite.config.ts` 里 `base: 'build' ? './' : '/'`），但
**manifest 里的 `entry` 全部是 `/lab/...`、`/plugins/...` 这种根绝对路径**。
子路径部署时它们会被解析到域名根（`deeer.online/lab/...`）而不是
`deeer.online/pwt/demo/lab/...`，插件 iframe 与天气数据全部 404。

因此**任何要把 manifest 路径变成 URL 的地方都必须过 `src/core/url.ts` 的
`resolveAppUrl()`**：它用 `import.meta.env.BASE_URL` + `document.baseURI` 算出
「应用根」，再拼上相对部分。三种环境同时成立：

| 环境 | `BASE_URL` + `baseURI` | 结果 |
| --- | --- | --- |
| dev | `'/'` + `http://localhost:5173/` | `http://localhost:5173/lab/...` |
| Electron | `'./'` + `file:///E:/app/dist/index.html` | `file:///E:/app/dist/lab/...` |
| 子路径 | `'./'` + `https://deeer.online/pwt/demo/` | `https://deeer.online/pwt/demo/lab/...` |

已接入的地方：`IframeHost`（entry 与握手 URL）、`ModuleHost`/`module-loader`、
`cascade`（级联数据源）、`OverlayHost`（悬浮插件 iframe）。

> ⚠ `public/plugins/weather/index.html` 内部用 `fetch('/wapi/...')` 拿中国天气网数据。
> `/wapi` 是 **Vite dev server 的代理**（生产不可用），且路径是根绝对的 ——
> 线上 demo 的天气插件会取不到数据（显示「点击齿轮选择城市」）。这是已知限制，
> 生产化需要自建后端转发（见「生产化路线图」）。

### 本地模拟子路径

`plugin-lab` 之外另有一套部署工具在 `E:\Workspace\MyWorkTable\.deploy\`：

```powershell
# 1) 构建 + 把 dist / public / 介绍页 汇总到 wwwroot\pwt
cd MyWorkTable && pnpm build
cd ..\.deploy && powershell -File sync-wwwroot.ps1

# 2) 本地按 deeer.online 的目录结构起静态服务（含 try_files 模拟）
node subpath-serve.cjs wwwroot 5200
#    → http://127.0.0.1:5200/pwt/ 与 /pwt/demo/

# 3) 用 Electron 探针复核子路径解析（不用起浏览器）
cd ..\MyWorkTable
node_modules\electron\dist\electron.exe desktop\probe-subpath.cjs http://127.0.0.1:5200/pwt/demo/
```

### 服务器侧

nginx 里 **必须把 `location ^~ /pwt/` 插在 `location /` 之前**，否则会被
反代给 Next.js 的 `location /` 吃掉，返回 Next 的 404 页面：

```nginx
location ^~ /pwt/ {
    alias /var/www/pwt/;
    index index.html;
    try_files $uri $uri/ /pwt/index.html;
}
```

`alias` 与 `try_files` 的配合注意：`/pwt/` 带尾斜杠时 `alias` 才能正确拼接；
不带尾斜杠的 `/pwt` 由 nginx 自动 301 到 `/pwt/`（实测已生效）。
站点目录 `/var/www/pwt` 归 `deepseek` 所有，上传无需提权；改 nginx 需要 `sudo`。

线上验收脚本：`.deploy\verify-online.cjs`（走真实 Chromium 加载
`https://deeer.online/pwt/demo/`，覆盖外壳渲染 → 四页导航 → 市场安装 →
插件坞建窗 → 精简组件 → 切完整内容 → 介绍页跳转，并断言**新建窗口落在画布
可见范围内**）。


