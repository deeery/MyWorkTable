# Workbench 插件开发规范（Plugin Protocol v1）

本规范定义工作台与插件之间的**全部契约**。遵循规范编写的插件可以在 iframe 沙箱模式或 ES Module 模式下运行，由宿主统一渲染、调度与授权。

---

## 1. 插件清单（Manifest）

每个插件必须提供一份 manifest，这是宿主认识插件的唯一途径：

```ts
interface PluginManifest {
  id: string            // 全局唯一，建议反向域名：com.example.clock
  name: string          // 展示名
  version: string       // semver
  description: string
  author?: string
  icon: string          // emoji 或单字符
  category: 'tool' | 'data' | 'info' | 'fun' | 'other'

  renderMode: 'iframe' | 'module'   // 渲染模式（见 §2）
  entry: string                      // 入口 URL（iframe: HTML 页面；module: ES Module）

  refresh: {                          // 刷新策略（见 §3）
    intervalMs: number                // 0=手动；-1=永不；>0=调度周期
    pauseWhenHidden?: boolean         // 页面不可见时暂停（默认 true）
  }

  permissions?: {                     // 最小权限声明（见 §5）
    readProfile?: boolean
    storage?: boolean
    openUrl?: boolean
    notify?: boolean
  }

  defaultSize?: 'S' | 'M' | 'L' | 'XL' // 桌面卡片默认尺寸（宽 280/480/720/960 px）
  defaultVisible?: boolean             // 安装后是否默认上桌面

  settings?: {                         // 设置面板声明（见 §8）
    title?: string
    fields: SettingsField[]
  }
}
```

manifest 示例：

```json
{
  "id": "workbench.clock",
  "name": "时钟",
  "version": "1.0.0",
  "icon": "🕐",
  "category": "info",
  "renderMode": "iframe",
  "entry": "/plugins/clock/index.html",
  "refresh": { "intervalMs": 1000 },
  "defaultSize": "S"
}
```

---

## 2. 两种渲染模式

| | iframe 沙箱模式 | ES Module 模式 |
|---|---|---|
| 入口 | 完整 HTML 页面 | 导出工厂函数的 `.js` 模块 |
| 隔离性 | 完全隔离（独立 origin/sandbox） | 同进程，共享 DOM |
| 通信 | `postMessage` 协议 | `PluginContext` 直接调用 |
| 适用 | 不可信/第三方插件、复杂独立应用 | 可信插件、轻量卡片 |
| 主题 | 宿主下发 `workbench:theme` | 宿主回调 `onThemeChange` |

### 2.1 module 插件契约

模块必须 `export default` 一个工厂函数：

```js
export default function create(ctx) {
  return {
    mount(container) { /* 渲染 DOM，只允许操作 container 内部 */ },
    unmount() { /* 必须清理定时器、事件监听、DOM */ },
    onTick() { /* 可选：宿主调度刷新回调 */ },
    onThemeChange(theme) { /* 可选：'light' | 'dark' */ },
    onResize(w, h) { /* 可选：容器尺寸变化 */ },
  }
}
```

`ctx`（PluginContext）提供宿主能力，均受 permissions 门控：

| API | 权限 | 说明 |
|---|---|---|
| `ctx.storage.get/set` | `storage` | 命名空间 KV（`plugin:<id>:<key>`） |
| `ctx.getTheme()` | — | 当前主题 |
| `ctx.getProfile()` | `readProfile` | `{ name, avatar } \| null` |
| `ctx.openUrl(url)` | `openUrl` | 新窗口打开链接 |
| `ctx.notify(title, body)` | `notify` | 系统通知 |
| `ctx.config` | — | 当前插件级配置（只读，随宿主状态持久化） |
| `ctx.setConfig(patch)` | — | 合并写入插件级配置，宿主持久化后回调 `onConfigChange` |

### 2.2 iframe 插件契约（postMessage 协议）

插件页面加载完成后**必须**发送握手消息：

```js
parent.postMessage({ type: 'plugin:ready', payload: { id: 'workbench.clock' } }, '*')
```

宿主 → 插件：

| type | payload | 说明 |
|---|---|---|
| `workbench:init` | `{ theme, locale, width, config }` | 握手成功后的初始化（含一次首刷与当前插件配置） |
| `workbench:tick` | `{ ts }` | 调度刷新到达 |
| `workbench:theme` | `{ theme }` | 主题切换 |
| `workbench:config` | `{ ...config }` | 插件级配置变更（齿轮面板改动后下发） |
| `workbench:resize` | `{ width, height }` | 容器尺寸变化（**宿主暂未发送**） |

插件 → 宿主（均受 permissions 门控，未声明将被忽略）：

| type | payload | 权限 | 宿主支持 |
|---|---|---|---|
| `plugin:ready` | `{ id }` | — | ✅ |
| `plugin:openUrl` | `{ url }` | `openUrl` | ✅ |
| `plugin:notify` | `{ title, body }` | `notify` | ✅ |
| `plugin:resize` | `{ height }` | — | ⛔ 暂未实现 |
| `plugin:storage` | `{ action, key, value? }` | `storage` | ⛔ 暂未实现 |
| `plugin:profile` | `null` | `readProfile` | ⛔ 暂未实现 |

> 标 ⛔ 的消息宿主不会响应。iframe 插件当前应通过 `workbench:init` /
> `workbench:config` 接收配置，并用插件自身的 `localStorage` 持久化数据。

---

## 3. 刷新调度（核心规格）

刷新由**宿主统一调度**，插件自身不持有 `setInterval`：

- `intervalMs > 0`：宿主 `Scheduler` 按周期派发 tick（iframe 发 `workbench:tick`，module 调 `onTick`）
- `intervalMs = 0`：手动刷新——仅用户点击卡片上的 ⟳ 按钮时派发一次 tick
- `intervalMs = -1`：静态插件，宿主不调度
- **可见性暂停**：`pauseWhenHidden !== false` 且页面切到后台 → 暂停；切回前台 → 立即补一次 tick 再恢复周期
- **全局倍率**：设置页的刷新倍率（0.25×–4×）缩放所有插件实际周期，用于省电模式
- 卡片被隐藏/停用时调度自动注销

> 建议：时钟类 1000ms；监控类 2000ms；行情类 5000ms+；天气类 ≥30min。

---

## 4. 生命周期

```
安装(install) → 启用(enable) → 桌面可见(visible) → 挂载(mount/init)
     ↕ 停用/隐藏                ↕ 拖动/缩放            ↕ 卸载(unmount/销毁 iframe)
卸载(uninstall) → 清除运行状态（manifest 注册表 + 该插件的 localStorage 命名空间）
```

- module 插件在每次 `mount` 时必须可从 `ctx.storage` 恢复状态
- `unmount` 必须保证幂等且无副作用残留
- 卸载会清除 `plugin:<id>:` 前缀下的全部键（`clearPluginStorage`），插件无需自行清理

---

## 5. 权限模型

最小权限原则：manifest 未声明的能力，宿主注入的 API 直接返回空/忽略请求。

生产环境加固建议：

1. 跨源 iframe 插件使用 `sandbox="allow-scripts"`（不带 `allow-same-origin`）
2. postMessage 严格校验 `event.origin` 与 `event.source`
3. module 插件建议经审核后分发，或引入 CSP / 代码签名
4. 可为 iframe 插件提供官方 SDK 脚本（封装握手与消息），降低开发成本

---

## 6. 开发调试

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

新插件开发步骤：

1. 在 `public/plugins/<name>/` 编写插件（参考 `clock/`、`weather/`、`notes/`、`pomodoro/` 四个示例）
2. 在 `src/core/registry.ts` 的 `PLUGIN_CATALOG` 登记 manifest
3. 打开「插件 → 插件市场」安装，即可上桌面验证

发布到真实环境时，`PLUGIN_CATALOG` 可替换为远端插件索引服务（返回 manifest 数组的 JSON API），`entry` 指向任意 https URL 即可加载第三方插件。

---

## 7. 已知限制

| 限制 | 说明 |
|---|---|
| 部分协议消息未实现 | `plugin:resize` / `plugin:storage` / `plugin:profile` 与 `workbench:resize` 尚无宿主实现（见 §2.2） |
| iframe 非安全边界 | 内置插件与宿主同源且带 `allow-same-origin`，可访问宿主 DOM；真正的第三方隔离需去掉该属性并调整 origin 校验 |
| `new Function` 动态 import | `module-loader` 以此绕过打包器静态分析，在无 `unsafe-eval` 的严格 CSP 下会失败 |
| 天气依赖 dev 代理 | `d1.weather.com.cn` 无 CORS 头且校验 Referer，仅 dev server 的 `/wapi` 代理可用；生产构建需自建后端转发 |

---

## 8. 设置面板（声明式）

插件在 manifest 中声明 `settings`，宿主据此自动渲染齿轮设置面板，插件无需自带 UI，
新增可配置插件也不必改动宿主源码。

```ts
settings: {
  title?: string          // 面板标题
  fields: SettingsField[]
}
```

字段通用属性：`key`（写入 config 的键）、`label`（标签）、`hint?`（说明）、`default?`。

| type | 专有属性 | 渲染为 |
|---|---|---|
| `text` | `placeholder?` | 单行文本输入 |
| `number` | `min?` `max?` `step?` | 数字输入（失焦提交并夹到区间内） |
| `color` | — | 自由取色器（任意颜色） |
| `palette` | `palette` `pairWith?` | 16 色预设色条（见 §8.1） |
| `font` | `fonts?` `options?` | 字体下拉表格，逐项以该字体预览（见 §8.2） |
| `select` | `options: { value, label }[]` | 下拉框 |
| `cascade` | `source` `nameKey?` `defaultName?` | 省 / 市 / 区县三级联动 |

`cascade` 的 `source` 需返回 `{ provinces: [{ code, name, cities: [{ code, name, districts: [{ code, name }] }] }] }`；
选中区县后把完整区域码写入 `key`，若声明了 `nameKey` 则同时写入名称。

### 8.1 预设配色（`palette`）

`palette` 引用内置色板名，渲染为 **4×4 的配色对网格**：每一项都是一个
「色块 │ 竖线 │ 色块」的组合 —— **左半是背景色、右半是与它自动搭配的可读字体色**，
左半上还用该字体色写着 `Aa` 示例。用户一眼就能看到整组配色效果。

| 色板名 | 用途 | 内容 |
|---|---|---|
| `note` | 便签配色 | 16 组「底色 + 配对字色」（Material 50/100 级 + 主流笔记应用便签色） |
| `note-text` | 独立字色 | 由 `note` 的配对前景色导出、去重后的 16 色（用于单独覆盖字色） |

**自动搭配可读字体色**：声明 `pairWith` 后，点击某个配色对会**同时写入**
底色与它配对的前景色 —— 这就是「自动搭配配色」，用户无需自己判断对比度。

```ts
// 推荐：单一「配色」字段，一项即一组完整配色
{ type: 'palette', key: 'bg', pairWith: 'fg', label: '配色', palette: 'note' }

// 可选：再给一个独立字色字段，让用户单独覆盖
{ type: 'palette', key: 'fg', label: '字体颜色', palette: 'note-text' }
```

色板定义在 `src/core/palettes.ts`。新增色板只需在该文件的 `PALETTES` 注册表里加一项。
每对配色的对比度都经过 WCAG 校验（正文 ≥ 4.5:1），当前 16 组实测均 ≥ 5.3:1，
用户无法选出看不清的组合 —— 这正是用 `palette` 取代自由 `color` 的理由。

### 8.2 字体下拉表格（`font`）

`font` 渲染为下拉表格：**每个选项以该字体本身显示字体名与示例文字**（所见即所得）。
写入的值为 CSS `font-family` 片段，插件直接用于 `font-family` 即可。

```ts
{ type: 'font', key: 'font', label: '字体', fonts: 'ui', default: 'inherit' }
```

| 属性 | 说明 |
|---|---|
| `fonts?` | 内置字体清单名，默认 `ui`（见 `src/core/fonts.ts` 的 `FONT_SETS`） |
| `options?` | 覆盖内置清单；此项只有 `value`/`label`，预览时以 `value` 作为字体栈 |

内置 `ui` 清单收录各平台普遍存在的字体（系统默认 / 苹方 / 雅黑 / 宋体 / 楷体 /
Georgia / Times / Consolas / Courier / Verdana / 手写体），每项都带**完整回退链**，
避免用户选到的字体在其系统上缺失时显示异常。`inherit` 表示跟随界面默认字体。

**取值约定**：所有配置值均为字符串，经 `PluginContext.config`（module 模式）或
`workbench:config` / `workbench:init`（iframe 模式）下发。插件读取时须自行做数值校验
与兜底 —— 注意 `Number(undefined)` 得 `NaN`，而 `NaN ?? fallback` 仍是 `NaN`，
应使用 `Number.isFinite` 判断。

示例：

```ts
settings: {
  title: '便签设置',
  fields: [
    {
      type: 'select', key: 'fontSize', label: '字体大小', default: '13',
      options: [
        { value: '11', label: '小 11' },
        { value: '13', label: '中 13' },
        { value: '16', label: '大 16' },
      ],
    },
    { type: 'font',    key: 'font', label: '字体', fonts: 'ui', default: 'inherit' },
    { type: 'palette', key: 'bg', pairWith: 'fg', label: '配色', palette: 'note' },
  ],
}
```
