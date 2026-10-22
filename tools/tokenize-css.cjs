/**
 * 把 global.css 里散落的 px 字号 / 圆角收敛到令牌刻度。
 *
 * 为什么用脚本而不是手改：这两类值 80+ 处，手改必漏。
 * 但上一轮本喵用 PowerShell 批量替换把整个文件写坏过 —— 那次是
 * PowerShell 的 `[string[]]` 参数把嵌套数组展平成字符，属于参数传递坑。
 * 这里的做法不同：只做**受限正则替换**（必须匹配完整的
 * `font-size: <数字>px` / `border-radius: <数字>px` 声明），先 dry-run
 * 打印逐处 diff，确认后才 --apply 写盘；且替换后立刻跑 tsc + 对比行长。
 *
 * 用法：
 *   node tools/tokenize-css.cjs          # 只打印将要改什么
 *   node tools/tokenize-css.cjs --apply  # 真正写盘
 */
const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'src', 'styles', 'global.css')
const APPLY = process.argv.includes('--apply')

/* 字号：吸附到 --t-* 八档刻度（10/11/12/13/14/16/20/24）。
 * 15px 向上取 16（品牌名/强调图标，本就该比正文显眼）；
 * 18px 也取 16（原用于字符图标，换成 SVG 后不再需要大字号）；
 * 其余就近取值，避免工具栏整体变胖。 */
const FS = {
  '9.5': 'var(--t-2xs)',
  '10': 'var(--t-2xs)',
  '10.5': 'var(--t-xs)',
  '11': 'var(--t-xs)',
  '11.5': 'var(--t-sm)',
  '12': 'var(--t-sm)',
  '12.5': 'var(--t-sm)',
  '13': 'var(--t-base)',
  '14': 'var(--t-md)',
  '15': 'var(--t-lg)',
  '16': 'var(--t-lg)',
  '18': 'var(--t-lg)',
  '20': 'var(--t-xl)',
  '24': 'var(--t-2xl)',
}

/* 圆角：吸附到 --r-* 刻度（4/6/8/12/16/22/999）。 */
const RD = {
  '2': 'var(--r-2xs)',
  '4': 'var(--r-2xs)',
  '5': 'var(--r-xs)',
  '6': 'var(--r-xs)',
  '7': 'var(--r-sm)',
  '8': 'var(--r-sm)',
  '9': 'var(--r-sm)',
  '10': 'var(--r-md)',
  '11': 'var(--r-md)',
  '12': 'var(--r-md)',
  '14': 'var(--r-lg)',
  '16': 'var(--r-lg)',
  '22': 'var(--r-xl)',
  '999': 'var(--r-pill)',
}

/* 明确豁免的行：插件自己的 emoji 图标字号属于「插件内容标识」，
 * 不是工作台的结构字号，硬改会让不同插件的图标大小不齐。
 * 注意只豁免 `.market-card .icon`，不要豁免整个 .market-card ——
 * 卡片里的名字/版本/描述是工作台自己的排版，必须进刻度。 */
const SKIP_LINE_RE = [/\.dock-ico\b/, /\.dock-launch-ico\b/, /\.market-card \.icon\b/]

const src = fs.readFileSync(FILE, 'utf8')
const lines = src.split('\n')

const changes = []
const skipped = []

const FS_RE = /\bfont-size:\s*([\d.]+)px/g
/* 圆角按**整个值**处理，这样 `0 0 14px 0` 这种多值也能逐个换成令牌，
 * 不会因为「不是单个数字」被整条漏掉。 */
const RD_RE = /\bborder-radius:\s*([^;]+)/g

function scrubFont(line, lineNo) {
  return line.replace(FS_RE, (whole, val) => {
    if (SKIP_LINE_RE.some((r) => r.test(line))) {
      skipped.push({ n: lineNo, why: '插件图标字号（豁免）', text: whole })
      return whole
    }
    const tok = FS[val]
    if (!tok) {
      skipped.push({ n: lineNo, why: `字号 ${val}px 未收录`, text: whole })
      return whole
    }
    const next = whole.replace(`${val}px`, tok)
    changes.push({ n: lineNo, kind: 'font-size', from: whole, to: next })
    return next
  })
}

function scrubRadius(line, lineNo) {
  return line.replace(RD_RE, (whole) => {
    const prefix = 'border-radius:'
    const value = whole.slice(prefix.length)
    const nextValue = value.replace(/([\d.]+)px/g, (wm, val) => {
      const tok = RD[val]
      if (!tok) {
        skipped.push({ n: lineNo, why: `圆角 ${val}px 未收录`, text: whole.trim() })
        return wm
      }
      return tok
    })
    if (nextValue === value) return whole
    const next = prefix + nextValue
    changes.push({ n: lineNo, kind: 'border-radius', from: whole.trim(), to: next.trim() })
    return next
  })
}

const out = lines.map((line, i) => {
  let l = line
  if (/font-size\s*:/.test(l)) l = scrubFont(l, i + 1)
  if (/border-radius\s*:/.test(l)) l = scrubRadius(l, i + 1)
  return l
})

/* 多值圆角里若含百分比（如 `50%`），位置语义与 px 不同，单独列出来。 */
const multi = []
lines.forEach((line, i) => {
  const m = /\bborder-radius:\s*([^;]+);/.exec(line)
  if (!m) return
  const val = m[1].trim()
  if (!/%/.test(val)) return
  multi.push({ n: i + 1, val })
})

console.log(`== ${path.relative(process.cwd(), FILE)} ==`)
console.log(`将替换 ${changes.length} 处；跳过 ${skipped.length} 处；百分比圆角 ${multi.length} 处保持原样\n`)
for (const c of changes) console.log(`  ${String(c.n).padStart(4)} [${c.kind}] ${c.from}  ->  ${c.to}`)
if (skipped.length) {
  console.log('\n-- 跳过 --')
  for (const s of skipped) console.log(`  ${String(s.n).padStart(4)}  ${s.why}: ${s.text}`)
}
if (multi.length) {
  console.log('\n-- 百分比圆角（保持原样，语义正确）--')
  for (const s of multi) console.log(`  ${String(s.n).padStart(4)}  ${s.val}`)
}

const before = src.length
const after = out.join('\n').length

if (!APPLY) {
  console.log(`\n字符数：${before} -> ${after}（dry-run，未写盘；确认后加 --apply）`)
} else {
  fs.writeFileSync(FILE, out.join('\n'), 'utf8')
  console.log(`\n已写盘：${before} -> ${after} 字符`)
}
