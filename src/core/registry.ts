import type { PluginManifest } from '../types/plugin'
import { LAB_PLUGINS } from './lab-plugins'

/**
 * 内置插件目录（模拟插件市场）。
 * 实际部署时该目录可替换为远端插件索引服务，
 * 用户可上传/安装第三方 manifest（entry 指向任意 https URL）。
 *
 * 设置面板由 manifest.settings 声明、宿主通用渲染（components/SettingsPanel.tsx），
 * 因此新增可配置插件无需改动宿主源码。
 */
export const PLUGIN_CATALOG: PluginManifest[] = [
  {
    id: 'workbench.clock',
    name: '时钟',
    version: '1.0.0',
    description: '高精度数字时钟 + 日期与星期，每秒刷新。',
    icon: '🕐',
    category: 'info',
    renderMode: 'iframe',
    entry: '/plugins/clock/index.html',
    refresh: { intervalMs: 1000, pauseWhenHidden: true },
    defaultSize: 'S',
    defaultVisible: true,
    settings: {
      title: '时钟设置',
      fields: [
        {
          type: 'select',
          key: 'tz',
          label: '时区',
          default: '8',
          options: [
            { value: '8', label: 'UTC+8 北京' },
            { value: '9', label: 'UTC+9 东京' },
            { value: '5.5', label: 'UTC+5:30 新德里' },
            { value: '3', label: 'UTC+3 莫斯科' },
            { value: '1', label: 'UTC+1 柏林' },
            { value: '0', label: 'UTC+0 伦敦' },
            { value: '-5', label: 'UTC-5 纽约' },
            { value: '-8', label: 'UTC-8 洛杉矶' },
          ],
        },
      ],
    },
  },
  {
    id: 'workbench.weather',
    name: '天气',
    version: '1.1.0',
    description: '中国天气网真实数据，支持全国省市县三级地区选择（30 分钟刷新）。',
    icon: '⛅',
    category: 'info',
    renderMode: 'iframe',
    entry: '/plugins/weather/index.html',
    refresh: { intervalMs: 30 * 60 * 1000, pauseWhenHidden: false },
    permissions: { storage: true },
    defaultSize: 'M',
    defaultVisible: true,
    settings: {
      title: '天气设置',
      fields: [
        {
          type: 'cascade',
          key: 'cityCode',
          nameKey: 'cityName',
          label: '地区',
          source: '/plugins/weather/cities.json',
        },
      ],
    },
  },
  {
    id: 'workbench.notes',
    name: '便签',
    version: '1.0.0',
    description: '可编辑便签，内容自动持久化。模块模式插件示例。',
    icon: '📝',
    category: 'tool',
    renderMode: 'module',
    entry: '/plugins/notes/main.js',
    refresh: { intervalMs: 0 },
    permissions: { storage: true },
    defaultSize: 'M',
    defaultVisible: true,
    settings: {
      title: '便签设置',
      fields: [
        // 字号与字体都改为下拉表格选择
        {
          type: 'select', key: 'fontSize', label: '字体大小', default: '13',
          options: [
            { value: '11', label: '小 11' },
            { value: '13', label: '中 13' },
            { value: '16', label: '大 16' },
            { value: '20', label: '特大 20' },
            { value: '24', label: '超大 24' },
          ],
        },
        { type: 'font', key: 'font', label: '字体', fonts: 'ui', default: 'inherit' },
        // 单一「配色」字段：每项是一个「底色 │ 字色」配色对，
        // 点击即同时写入背景色与自动搭配的可读字体色（pairWith: 'fg'）。
        { type: 'palette', key: 'bg', pairWith: 'fg', label: '配色', palette: 'note', default: '#ffffff' },
      ],
    },
  },
  {
    id: 'workbench.pomodoro',
    name: '番茄钟',
    version: '0.9.0',
    description: '25 分钟专注计时器，默认不显示在桌面，可从插件市场添加。',
    icon: '🍅',
    category: 'tool',
    renderMode: 'module',
    entry: '/plugins/pomodoro/main.js',
    refresh: { intervalMs: 1000, pauseWhenHidden: true },
    permissions: { storage: true, notify: true },
    defaultSize: 'S',
    defaultVisible: false,
    settings: {
      title: '番茄钟设置',
      fields: [
        { type: 'number', key: 'work', label: '专注时长（分钟）', min: 5, max: 60, step: 5, default: '25' },
        { type: 'number', key: 'rest', label: '休息时长（分钟）', min: 1, max: 30, step: 1, default: '5' },
      ],
    },
  },

  /* 来自 plugin-lab 的插件（由 plugin-lab/tools/mirror-to-workbench.mjs 镜像）。
     它们是完整 HTML 页面，故走 iframe 渲染模式，与宿主已有的通道完全一致。 */
  ...LAB_PLUGINS,
]
