# Workbench · 插件式工作台

一个框架式工作台参考实现：界面分 **桌面 / 插件 / 设置 / 我的** 四个页面，左侧菜单栏导航，左下角常驻登录状态。所有功能元素以**插件**形式导入，插件接口、渲染方式、刷新频率等规格全部标准化。

## 快速开始

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # 产物在 dist/
```

## 架构总览

```
┌──────────┬────────────────────────────────────────────┐
│          │  桌面（卡片网格 · 拖拽排序 · 尺寸切换）      │
│  左侧     │  插件（市场 + 已安装管理：装/停/隐/卸）      │
│  菜单栏   │  设置（主题 / 刷新倍率 / 布局列数）          │
│          │  我的（账号 / 数据概览）                     │
│ 登录状态  ├────────────────────────────────────────────┤
└──────────┤  插件运行时                                  │
           │  ├─ PluginManifest 协议（渲染模式/刷新/权限）│
           │  ├─ IframeHost   —— 沙箱 + postMessage 总线 │
           │  ├─ ModuleHost   —— 动态 import + 生命周期  │
           │  └─ Scheduler    —— 统一刷新调度（倍率/暂停）│
           └────────────────────────────────────────────┘
```

核心源码索引：

| 模块 | 位置 | 职责 |
|---|---|---|
| 插件协议 | `src/types/plugin.ts` | Manifest / PluginContext / 消息协议类型 |
| 注册表 | `src/core/registry.ts` | 内置插件目录（可替换为远端索引服务） |
| 调度器 | `src/core/scheduler.ts` | 按刷新策略派发 tick、页面隐藏暂停、全局倍率 |
| 消息总线 | `src/core/bus.ts` | iframe postMessage 协议（origin 校验） |
| 模块加载器 | `src/core/module-loader.ts` | 动态 import + 工厂签名校验 |
| iframe 宿主 | `src/components/IframeHost.tsx` | 沙箱渲染 + 握手 + 主题下发 |
| module 宿主 | `src/components/ModuleHost.tsx` | 生命周期管理 + ctx 注入 |
| 全局状态 | `src/state/AppContext.tsx` | 安装态/设置/账号，localStorage 持久化 |

## 内置示例插件

| 插件 | 模式 | 刷新 | 演示点 |
|---|---|---|---|
| 🕐 时钟 | iframe | 1s | 高频 tick + 主题跟随 |
| ⛅ 天气 | iframe | 30min | 低频刷新、`pauseWhenHidden:false` |
| 📝 便签 | module | 手动(0) | storage 权限 + 防抖持久化 |
| 📈 系统监控 | module | 2s | canvas 曲线、宿主统一调度 |
| 🍅 番茄钟 | module | 1s | storage+notify 权限、默认不上桌面 |

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
- 桌面卡片自由布局（react-grid-layout）与跨桌面同步
- Electron / Tauri 壳：`PluginContext` 扩展本地文件、系统 API 能力
