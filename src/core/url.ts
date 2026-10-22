/**
 * 应用内绝对路径解析
 * ------------------------------------------------------------
 * manifest.entry、cascade.source 等以 '/' 开头的路径，语义是「相对于应用根目录」，
 * 而不是「相对于域名根」。两者只在应用部署于域名根时恰好一致。
 *
 * 三种运行环境：
 *   1. dev        http://localhost:5173/          → 应用根 = 域名根
 *   2. Electron   file:///E:/app/dist/index.html  → 应用根 = dist/ 目录
 *   3. 子路径部署 https://deeer.online/pwt/demo/   → 应用根 = /pwt/demo/
 *
 * 历史上这里只处理了 file://（把 '/' 拼到 index.html 所在目录前），
 * 结果子路径部署时所有 `/lab/...`、`/plugins/...` 都会被解析到域名根而 404。
 *
 * 现在统一为：先算出「应用根 URL」，再把去掉前导 '/' 的路径拼上去。
 * 应用根由 Vite 的 BASE_URL 决定（构建时 './'，dev 时 '/'），
 * 用 `new URL(BASE_URL, location.href)` 解析 —— 对上面三种环境都成立：
 *   - dev        '/'   + .../            → http://localhost:5173/
 *   - Electron   './'  + .../index.html  → file:///E:/app/dist/
 *   - 子路径      './'  + .../demo/       → https://deeer.online/pwt/demo/
 *
 * 非 '/' 开头的路径（相对路径、https 绝对 URL、data: 等）原样返回。
 */
export function resolveAppUrl(url: string): string {
  if (!url || !url.startsWith('/')) return url

  try {
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL || './'
    const root = new URL(base, document.baseURI || location.href)
    return new URL(url.replace(/^\//, ''), root).href
  } catch {
    return url
  }
}
