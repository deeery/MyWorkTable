import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // 允许插件以独立源（iframe）方式加载；实际部署按域名收紧
    cors: true,
  },
})
