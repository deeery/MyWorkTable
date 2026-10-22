import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  /**
   * 仅在构建时使用相对路径：产物需同时支持 http 服务与 file:// 加载（Electron 桌面壳），
   * 默认的 '/' 会生成 /assets/... 绝对路径，在 file:// 下解析到磁盘根目录而 404（白屏）。
   *
   * dev 必须保持 '/'：把 base 设成 './' 会让 dev server 不再从 public/ 提供文件，
   * 表现为所有插件的 iframe（含 clock / weather / lab/*）全部 404。
   */
  base: command === 'build' ? './' : '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    // 允许插件以独立源（iframe）方式加载；实际部署按域名收紧
    cors: true,
    /**
     * 忽略临时/工具产物，避免 fs watcher 因 EBUSY 崩溃。
     *
     * 背景：Windows 上被其他进程锁定的文件（编辑器/工具的原子写临时目录、
     * 无头浏览器的 profile 缓存等）会让 Vite 的 watcher 抛 EBUSY 并**直接退出进程**，
     * 表现为 dev server 无声死掉、所有请求 404，极难排查。
     * 这里把已知的临时模式排除在 watch 之外。
     */
    watch: {
      ignored: [
        '**/.*.tmpdir/**',
        '**/*.tmpdir/**',
        '**/.bp-*/**',
        '**/.browser-profile/**',
        '**/_wbprobe-*',
        '**/_sweep-*',
        '**/_shot-*',
        '**/_diag*',
        '**/_host.html',
        '**/_d2.html',
        '**/_d3.html',
        '**/_d4.html',
        '**/_probe*',
      ],
    },
    proxy: {
      // 中国天气网实时接口（d1.weather.com.cn）无 CORS 头，且强制校验 Referer + User-Agent
      // （缺任一即 403），浏览器直连必被拦截，故由 dev server 转发。
      // 注意：http-proxy 的顶层 headers 选项会被入站请求头覆盖，必须在 proxyReq 阶段显式设置。
      // ponytail: 仅 dev 可用；上生产需自建后端转发或换 CORS 友好的数据源。
      '/wapi': {
        target: 'http://d1.weather.com.cn',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/wapi/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Referer', 'http://www.weather.com.cn/')
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0')
          })
        },
      },
    },
  },
}))
