// migrate-areaid-v2.mjs — 权威重解所有市/区县的 areaid
// 用官方 search 接口按「短名 + 省名」消歧，替换 cities.json 中所有市/区县码。
// 7 位旧码、回退到父级的码、撞码，全部重解。省/容器级不动（0 撞）。
import fs from 'fs'
import { setTimeout as sleep } from 'node:timers/promises'

const FILE = 'public/plugins/weather/cities.json'
const H = { Referer: 'http://www.weather.com.cn/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
const SEARCH = 'http://toy1.weather.com.cn/search?cityname='
const isArea = (c) => /^\d{9}$/.test(c)

const cache = new Map() // name -> array of ref-fields
async function search(name) {
  if (cache.has(name)) return cache.get(name)
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(SEARCH + encodeURIComponent(name), { headers: H })
      const t = await r.text()
      const i = t.indexOf('('), j = t.lastIndexOf(')')
      if (i < 0 || j < 0) throw new Error('no-parens:' + t.slice(0, 40))
      const arr = JSON.parse(t.slice(i + 1, j)).map(x => String(x.ref).split('~'))
      await sleep(120)
      cache.set(name, arr)
      return arr
    } catch (e) { lastErr = e; await sleep(300 * (attempt + 1)) }
  }
  console.error(`  ! search失败 ${name}: ${lastErr && lastErr.message}`)
  return []
}

// 在 search 结果里按「省名 + 名称」消歧，返回 best code 或 null
function pick(rs, provName, name, parentCode) {
  const nine = rs.filter(f => isArea(f[0]))
  const inProv = nine.filter(f => f[9] === provName)
  // 1) 省内精确同名
  let exact = inProv.filter(f => f[2] === name)
  if (exact.length === 1) return exact[0][0]
  if (exact.length > 1) {
    // 同省内多条同名：用父级码前缀(前6位)择近
    if (parentCode) {
      const pref = parentCode.slice(0, 6)
      const near = exact.filter(f => f[0].slice(0, 6) === pref)
      if (near.length === 1) return near[0][0]
      if (near.length > 1) return near.sort((a, b) => a[0] < b[0] ? -1 : 1)[0][0]
    }
    return exact.sort((a, b) => a[0] < b[0] ? -1 : 1)[0][0]
  }
  // 2) 省内模糊（处理 同仁 vs 同仁市、冠/冠豸山 之类）
  let fuzzy = inProv.filter(f => f[2].includes(name) || name.includes(f[2]))
  if (fuzzy.length === 1) return fuzzy[0][0]
  if (fuzzy.length > 1) {
    if (parentCode) {
      const pref = parentCode.slice(0, 6)
      const near = fuzzy.filter(f => f[0].slice(0, 6) === pref)
      if (near.length >= 1) return near.sort((a, b) => a[0] < b[0] ? -1 : 1)[0][0]
    }
    return fuzzy.sort((a, b) => a[0] < b[0] ? -1 : 1)[0][0]
  }
  return null
}

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  const changes = []   // {path, old, new}
  const unresolved = [] // {path, name, old}

  // 市级
  for (const p of data.provinces) {
    for (const c of p.cities) {
      const rs = await search(c.name)
      const code = pick(rs, p.name, c.name, p.code)
      if (code && code !== c.code) { changes.push({ path: `${p.name}/${c.name}`, old: c.code, new: code }); c.code = code }
      else if (!code) unresolved.push({ path: `${p.name}/${c.name}`, name: c.name, old: c.code })
    }
  }
  // 区县级
  for (const p of data.provinces) {
    for (const c of p.cities) {
      for (const d of c.districts) {
        const rs = await search(d.name)
        const code = pick(rs, p.name, d.name, c.code)
        if (code && code !== d.code) { changes.push({ path: `${p.name}/${c.name}/${d.name}`, old: d.code, new: code }); d.code = code }
        else if (!code) unresolved.push({ path: `${p.name}/${c.name}/${d.name}`, name: d.name, old: d.code })
      }
    }
  }

  data.generatedAt = new Date().toISOString()
  data.codeSystem = 'areaid9'
  fs.writeFileSync(FILE, JSON.stringify(data))

  console.log(`改动 ${changes.length} 条，未解析 ${unresolved.length} 条(保留旧码)`)
  console.log('\n--- 改动样例(前30) ---')
  changes.slice(0, 30).forEach(x => console.log(`${x.path}: ${x.old} → ${x.new}`))
  console.log('\n--- 未解析(前30) ---')
  unresolved.slice(0, 30).forEach(x => console.log(`${x.path} (保留 ${x.old})`))

  // 导出改过的码供验证
  fs.writeFileSync('scripts/_changed-codes.json', JSON.stringify(changes, null, 2))
  fs.writeFileSync('scripts/_unresolved.json', JSON.stringify(unresolved, null, 2))
}
main()
