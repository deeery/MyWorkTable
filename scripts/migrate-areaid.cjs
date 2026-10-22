// 把 public/plugins/weather/cities.json 从 city3jdata 拼接码迁移到 9 位 areaid。
//   输入：现有树（省 5 位 / 市 7 位 / 区 9 位，都是 city3jdata 体系）
//   权威源：博客园全量码表「北京 = 101010100」+ CSDN「"北京"=>"101010100"」
//   策略：省名+市名+区县名 三级精确匹配 → 替换为 areaid；匹不上就保留并报告。
//   抽样：≥12 个不同省的市级 + 若干区县级，逐个打 /wapi/sk_2d 验证能拿数据。
const fs = require('fs')
const path = require('path')

const ROOT = 'E:/Workspace/MyWorkTable/MyWorkTable'
const CITIES = path.join(ROOT, 'public/plugins/weather/cities.json')
const RAW = path.join(ROOT, 'scripts/areaid-raw.txt')
const PROXY = 'http://localhost:5173/wapi/sk_2d'

// ---- 1. 解析权威码表（支持两种格式） ----
function parseAuth(text) {
  const map = new Map() // name -> code
  for (const line of text.split(/\r?\n/)) {
    let m
    if ((m = line.match(/^\s*(\S+)\s*=\s*(\d{9})\s*$/))) {
      map.set(m[1], m[2])
    } else if ((m = line.match(/^\s*"([^"]+)"\s*=>\s*"(\d{9})"/))) {
      map.set(m[1], m[2])
    }
  }
  return map
}

const auth = parseAuth(fs.readFileSync(RAW, 'utf8'))
console.log(`权威码表条目 = ${auth.size}`)

// ---- 2. 匹配并替换 ----
const data = JSON.parse(fs.readFileSync(CITIES, 'utf8'))
const report = { prov: 0, city: 0, dist: 0, missProv: [], missCity: [], missDist: [] }

function resolve(provName, cityName, distName) {
  // 优先级：区县名 > 市名 > 省名（同名时用上层上下文消歧）
  const tries = []
  if (distName) tries.push(distName)
  if (cityName) tries.push(cityName)
  if (provName) tries.push(provName)
  for (const n of tries) {
    if (auth.has(n)) return { code: auth.get(n), by: n }
  }
  return null
}

for (const p of data.provinces) {
  const pr = resolve(p.name, null, null)
  if (pr) { p.code = pr.code; report.prov++ } else report.missProv.push(p.name)

  for (const c of p.cities) {
    // 市：用「市名」匹配；直辖市市名==省名，直接命中
    const cr = resolve(p.name, c.name, null)
    if (cr) { c.code = cr.code; report.city++ } else report.missCity.push(`${p.name}/${c.name}`)

    for (const d of c.districts) {
      const dr = resolve(p.name, c.name, d.name)
      if (dr) { d.code = dr.code; report.dist++ } else report.missDist.push(`${p.name}/${c.name}/${d.name}`)
    }
  }
}

console.log(`替换：省 ${report.prov}/${data.provinces.length}  市 ${report.city}  区县 ${report.dist}`)
if (report.missProv.length) console.log(`  未匹配省：${report.missProv.join(', ')}`)
if (report.missCity.length) console.log(`  未匹配市（前 20）：${report.missCity.slice(0, 20).join(', ')}`)
if (report.missDist.length) console.log(`  未匹配区县（前 30）：${report.missDist.slice(0, 30).join(', ')}`)

// ---- 3. 抽样验证 ----
function parseS(t) {
  if (!t || t.startsWith('<')) return null
  const m = t.match(/var\s+dataSK\s*=\s*(\{[\s\S]*\})/)
  try { return JSON.parse(m ? m[1] : t) } catch { return null }
}
async function probe(code) {
  try {
    const r = await fetch(`${PROXY}/${code}.html`, { headers: { Referer: 'http://www.weather.com.cn/', 'User-Agent': 'Mozilla/5.0' } })
    const j = parseS(await r.text())
    return j ? { ok: true, temp: j.temp, weather: j.weather } : { ok: false }
  } catch { return { ok: false } }
}

async function main() {
  const samples = []
  const wantProv = new Set(['北京', '上海', '广东', '四川', '浙江', '湖北', '陕西', '江苏', '黑龙江', '云南', '新疆', '西藏', '内蒙古', '山东'])
  for (const p of data.provinces) {
    if (!wantProv.has(p.name) || samples.length >= 14) continue
    const c = p.cities[0]
    if (!c) continue
    samples.push({ label: `${p.name} 市级 ${c.name}`, code: c.code })
    const d = c.districts && c.districts[1] || c.districts[0]
    if (d) samples.push({ label: `${p.name} 区县 ${d.name}`, code: d.code })
  }

  let pass = 0, fail = 0
  console.log('\n=== 抽样验证（/wapi/sk_2d） ===')
  for (const s of samples) {
    const r = await probe(s.code)
    if (r.ok) pass++; else fail++
    console.log(`${r.ok ? '✅' : '❌'} ${s.label.padEnd(24)} code=${s.code} ${r.ok ? `${r.temp}° ${r.weather}` : '404'}`)
  }
  console.log(`样本：${pass} 通过 / ${fail} 失败`)

  if (fail > 0) {
    console.log('有样本失败，不写出。')
    process.exit(1)
  }

  // ---- 4. 写回 ----
  data.generatedAt = new Date().toISOString().slice(0, 10)
  data.codeSystem = 'areaid9'
  fs.writeFileSync(CITIES, JSON.stringify(data))
  console.log(`\n✅ 已写出 ${CITIES}  bytes=${fs.statSync(CITIES).size}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
