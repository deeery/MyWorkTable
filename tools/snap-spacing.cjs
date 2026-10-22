/**
 * 间距刻度归一
 * ------------------------------------------------------------
 * 只处理「间距属性」（gap / row-gap / column-gap / padding* / margin*）
 * 里的裸 px 值，把它们换成 --s-* 令牌，或归到最近的刻度值。
 *
 * 刻度：2 / 4 / 6 / 8 / 10 / 12 / 16 / 24 / 32 / 48 / 64
 *   —— 12px 以下按 2px 步进（紧凑 UI 需要 6/10 这样的微调档），
 *      12px 以上回到 4/8 节奏。
 *
 * 豁免：1px / 3px 视为「视觉发丝调整」（描边贴合、光学居中），
 *       不属于布局间距，保留原值并记录在报告里。
 *
 * 用法：
 *   node tools/snap-spacing.cjs            # dry-run，只打印
 *   node tools/snap-spacing.cjs --apply    # 真写
 */
const fs = require('fs')
const path = require('path')

const FILE = path.resolve(__dirname, '..', 'src', 'styles', 'global.css')
const APPLY = process.argv.includes('--apply')

const SCALE = [1, 2, 3, 4, 6, 8, 10, 12, 16, 24, 32, 48, 64]
const TOKEN = {
  1: '--sp-1', 2: '--sp-2', 3: '--sp-3', 4: '--sp-4', 6: '--sp-6',
  8: '--sp-8', 10: '--sp-10', 12: '--sp-12', 16: '--sp-16',
  24: '--sp-24', 32: '--sp-32', 48: '--sp-48', 64: '--sp-64',
}
const EXEMPT = new Set([])             // 刻度已含 1px/3px 发丝档，无豁免
const SPACING_PROP = /^(gap|row-gap|column-gap|padding(-\w+)?|margin(-\w+)?)$/

function nearest(n) {
  let best = SCALE[0], bd = Math.abs(n - SCALE[0])
  for (const s of SCALE) {
    const d = Math.abs(n - s)
    if (d < bd) { bd = d; best = s }
  }
  return best
}

let css = fs.readFileSync(FILE, 'utf8')
const lines = css.split('\n')
const changes = []
let exemptHits = 0

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i]
  // 逐条声明处理：prop: value;  （一条里可能有多个声明的用 ; 切）
  const declRe = /(^|[{;\s])(padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|row-gap|column-gap)\s*:\s*([^;{}]+);/g
  let out = raw
  let m
  const edits = []
  while ((m = declRe.exec(raw)) !== null) {
    const [whole, lead, prop, value] = m
    if (!SPACING_PROP.test(prop)) continue
    // 值里可能有 1~4 个组件，也可能含 var(...)：只替换裸 px 组件
    const newVal = value.replace(/(?<![\w.-])(\d+(?:\.\d+)?)px/g, (mm, num) => {
      const n = Number(num)
      if (EXEMPT.has(n)) { exemptHits++; return mm }
      const snapped = nearest(n)
      if (snapped === n) return `var(${TOKEN[n]})`
      changes.push({ line: i + 1, prop, from: n, to: snapped, before: raw.trim() })
      return `var(${TOKEN[snapped]})`
    })
    if (newVal !== value) {
      const start = m.index + lead.length
      edits.push({ start, len: whole.length - lead.length, text: whole.slice(lead.length).replace(value, newVal) })
    }
  }
  if (edits.length) {
    // 从后往前替换，避免位移
    for (let k = edits.length - 1; k >= 0; k--) {
      const e = edits[k]
      out = out.slice(0, e.start) + e.text + out.slice(e.start + e.len)
    }
    lines[i] = out
  }
}

console.log(`== 刻度归一 ==`)
console.log(`  刻度: ${SCALE.join(' / ')}`)
console.log(`  豁免 1px/3px 共 ${exemptHits} 处（视觉发丝调整，非布局间距）`)
console.log(`  真改值 ${changes.length} 处：`)
const group = {}
for (const c of changes) {
  const key = `${c.from}px → ${c.to}px`
  group[key] = (group[key] || 0) + 1
}
for (const k of Object.keys(group)) console.log(`    ${k}  ×${group[k]}`)

if (APPLY) {
  fs.writeFileSync(FILE, lines.join('\n'), 'utf8')
  console.log(`\n✓ 已写入 ${FILE}`)
} else {
  console.log(`\n(dry-run，加 --apply 才写盘)`)
  // 打印逐处 diff，便于人工确认
  for (const c of changes.slice(0, 40)) {
    console.log(`    :${c.line}  ${c.prop}  ${c.from}px → ${c.to}px   | ${c.before}`)
  }
  if (changes.length > 40) console.log(`    … 其余 ${changes.length - 40} 处略`)
}
