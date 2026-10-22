/**
 * 全量回归跑手：逐个跑 desktop/verify-*.cjs，每个跑完先杀干净 electron 再跑下一个。
 *
 * 为什么需要一个跑手：Electron 单实例锁 —— 上一个脚本的窗口没退干净时，
 * 下一个脚本会**静默退出**（没有任何输出，也不写日志文件），
 * 看起来像「脚本挂了」其实是没跑起来。
 *
 * 用法（在 MyWorkTable 目录下）：
 *   node desktop/run-all.cjs            跑全部
 *   node desktop/run-all.cjs sticky pomo  只跑名字里含这些关键字的
 */
const { spawnSync, execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const DIR = __dirname
const ROOT = path.join(DIR, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

const filters = process.argv.slice(2)
let files = fs.readdirSync(DIR)
  .filter((f) => /^verify-.*\.cjs$/.test(f))
  .sort()
if (filters.length) {
  files = files.filter((f) => filters.some((k) => f.includes(k)))
}

function killElectron() {
  try { execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' }) } catch { /* 没有进程 */ }
}

const results = []
for (const f of files) {
  killElectron()
  const t0 = Date.now()
  /* 必须把 ELECTRON_RUN_AS_NODE 整个删掉，不能只置成空串 ——
     只要这个键存在，electron.exe 就会退化成纯 Node 跑脚本，
     于是 require('./main.cjs') 里的 ipcMain 是 undefined，
     报「Cannot read properties of undefined (reading 'handle')」。 */
  const env = Object.assign({}, process.env)
  delete env.ELECTRON_RUN_AS_NODE
  const r = spawnSync(ELECTRON, [path.join('desktop', f)], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
    maxBuffer: 32 * 1024 * 1024,
  })
  const ms = Date.now() - t0
  const text = (r.stdout || '') + (r.stderr || '')
  const ok = r.status === 0
  results.push({ f, ok, ms, tail: text.trim().split('\n').slice(-6).join('\n') })
  console.log(`${ok ? '✅' : '❌'} ${f}  (${(ms / 1000).toFixed(1)}s)`)
}
killElectron()

console.log('\n===== 汇总 =====')
results.forEach((r) => {
  console.log(`${r.ok ? '✅' : '❌'} ${r.f}`)
  if (!r.ok) console.log('   ' + r.tail.replace(/\n/g, '\n   '))
})
const bad = results.filter((r) => !r.ok)
console.log(`\n共 ${results.length} 套，通过 ${results.length - bad.length}，失败 ${bad.length}`)
process.exit(bad.length ? 1 : 0)
