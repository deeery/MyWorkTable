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

  defaultSize?: 'S' | 'M' | 'L' | 'XL' // 桌面卡片默认尺寸（占 1/1/2/3 列）
  defaultVisible?: boolean             // 安装后是否默认上桌面
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

### 2.2 iframe 插件契约（postMessage 协议）

插件页面加载完成后**必须**发送握手消息：

```js
parent.postMessage({ type: 'plugin:ready', payload: { id: 'workbench.clock' } }, '*')
```

宿主 → 插件：

| type | payload | 说明 |
|---|---|---|
| `workbench:init` | `{ theme, locale, width }` | 握手成功后的初始化（含一次首刷） |
| `workbench:tick` | `{ ts }` | 调度刷新到达 |
| `workbench:theme` | `{ theme }` | 主题切换 |
| `workbench:resize` | `{ width, height }` | 容器尺寸变化 |

插件 → 宿主（均受 permissions 门控，未声明将被忽略）：

| type | payload | 权限 |
|---|---|---|
| `plugin:ready` | `{ id }` | — |
| `plugin:resize` | `{ height }` | — |
| `plugin:openUrl` | `{ url }` | `openUrl` |
| `plugin:notify` | `{ title, body }` | `notify` |
| `plugin:storage` | `{ action, key, value? }` | `storage` |
| `plugin:profile` | `null` | `readProfile` |

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
     ↕ 停用/隐藏                ↕ 尺寸切换/拖拽排序     ↕ 卸载(unmount/销毁 iframe)
卸载(uninstall) → 清除运行状态（manifest 注册表 + localStorage 配置）
```

- module 插件在每次 `mount` 时必须可从 `ctx.storage` 恢复状态
- `unmount` 必须保证幂等且无副作用残留

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

1. 在 `public/plugins/<name>/` 编写插件（参考 `clock/`、`notes/` 等 5 个示例）
2. 在 `src/core/registry.ts` 的 `PLUGIN_CATALOG` 登记 manifest
3. 打开「插件 → 插件市场」安装，即可上桌面验证

发布到真实环境时，`PLUGIN_CATALOG` 可替换为远端插件索引服务（返回 manifest 数组的 JSON API），`entry` 指向任意 https URL 即可加载第三方插件。
