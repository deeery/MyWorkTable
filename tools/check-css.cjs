#!/usr/bin/env node
/**
 * CSS 体检：抓那些「语法合法、但样式静默失效」的写法。
 *
 * 为什么需要它：曾出现过这样一个真实事故 ——
 *
 *     .settings-panel h4,
 *     .settings-panel .setting-row,
 *     .settings-panel .setting-label,
 *
 *     /* ---------- 下一节 ---------- *\/
 *     :root {
 *       --corner-right: 22px;
 *     }
 *
 * 选择器列表忘了写 `{…}`，而 CSS 注释**允许**出现在选择器列表中间，
 * 于是浏览器把 `:root` 接到了列表末尾，整组面板样式（标题分隔线、
 * 输入框 padding）全部静默消失。花括号是配平的、构建不报错、
 * 浏览器控制台也不报错 —— 只有肉眼看界面才发现「输入框变矮了」。
 *
 * 本脚本抓的就是这类「选择器列表没有声明体」的坑。
 *
 * 用法：node tools/check-css.cjs [文件...]
 *   默认检查 src/styles/global.css
 * 退出码：0 干净 / 1 有问题（可直接挂进 CI 或 run-all）
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : [path.join(ROOT, 'src/styles/global.css')]

let problems = 0

function report(file, line, kind, detail) {
  problems++
  console.log(`  ✗ ${path.relative(ROOT, file)}:${line}  [${kind}] ${detail}`)
}

/** 把 CSS 拆成「顶层条目」：@rule / 普通规则 / 注释 / 杂项 */
function scan(text) {
  const items = []       // { type, start, selEnd, bodyStart, bodyEnd, text }
  let i = 0
  let cur = 0            // 当前条目的起始偏移
  let depth = 0
  let declStart = -1

  while (i < text.length) {
    const ch = text[i]

    /* 跳过注释（但要记住它，因为注释能出现在选择器列表中间） */
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    }
    /* 跳过字符串 */
    if (ch === '"' || ch === "'") {
      const q = ch
      i++
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') i++
        i++
      }
      i++
      continue
    }

    if (ch === '{') {
      if (depth === 0) {
        items.push({ type: 'rule', start: cur, selEnd: i, bodyStart: i + 1 })
        declStart = i + 1
      }
      depth++
      i++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) {
        const it = items[items.length - 1]
        if (it && it.type === 'rule' && it.bodyStart === declStart) it.bodyEnd = i
        cur = i + 1
        declStart = -1
      }
      i++
      continue
    }
    if (ch === ';' && depth === 0) {
      const chunk = text.slice(cur, i + 1)
      if (/^\s*@/.test(chunk)) items.push({ type: 'atstatement', start: cur, end: i + 1 })
      cur = i + 1
      i++
      continue
    }
    i++
  }
  return items
}

/** 偏移 → 行号 */
function lineOf(text, off) {
  let n = 1
  for (let i = 0; i < off && i < text.length; i++) if (text[i] === '\n') n++
  return n
}

/** 去掉注释后的选择器文本 */
function bareSelector(sel) {
  return sel.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/**
 * 求「真正的选择器起点」：从 from 开始跳过空白与注释。
 *
 * 必须这么做：规则之间的空行与成段注释属于「上一节到下一节之间的
 * 排版留白」，不属于下一条规则的选择器。若不跳过，任何带注释头的
 * 规则都会被误判成「选择器列表里有空行」。
 */
function selectorStart(text, from, to) {
  let i = from
  for (;;) {
    while (i < to && /\s/.test(text[i])) i++
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1 || end + 2 > to) return i
      i = end + 2
      continue
    }
    return i
  }
}

for (const file of files) {
  if (!fs.existsSync(file)) { report(file, 0, '文件不存在', file); continue }
  const text = fs.readFileSync(file, 'utf8')
  console.log(`\n== ${path.relative(ROOT, file)} ==`)

  /* 1. 花括号配平（基础，但抓不到上面那个事故） */
  const open = (text.match(/\{/g) || []).length
  const close = (text.match(/\}/g) || []).length
  if (open !== close) report(file, 0, '花括号不配平', `{ ×${open} / } ×${close}`)

  const items = scan(text)

  /* 2. 选择器列表里出现空行 —— 这就是「声明体被删掉了」的指纹。
     正常写法不会在逗号后面空一行再接选择器。 */
  for (const it of items) {
    if (it.type !== 'rule') continue
    const selBegin = selectorStart(text, it.start, it.selEnd)
    const sel = text.slice(selBegin, it.selEnd)
    /* 空行（两个以上换行，中间只有空白） */
    const blank = /\n\s*\n/.exec(sel)
    if (blank) {
      const line = lineOf(text, selBegin + blank.index)
      const first = bareSelector(sel).split(',').map((s) => s.trim()).filter(Boolean)[0] || '(空)'
      report(file, line, '选择器列表中有空行',
        `「${first} …」—— 很可能这段选择器丢了声明体，后面的规则会被吸进来`)
    }
  }

  /* 3. 同一个选择器列表里出现重复项（复制粘贴残留） */
  for (const it of items) {
    if (it.type !== 'rule') continue
    const selBegin = selectorStart(text, it.start, it.selEnd)
    const sel = bareSelector(text.slice(selBegin, it.selEnd))
    const parts = sel.split(',').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
    const seen = new Map()
    for (const p of parts) {
      const k = p.toLowerCase()
      if (seen.has(k)) {
        report(file, lineOf(text, selBegin), '选择器列表里有重复项', `「${p}」出现两次`)
      }
      seen.set(k, true)
    }
  }

  /* 4. 规则体的右花括号不存在（说明被后续内容吞掉） */
  for (const it of items) {
    if (it.type !== 'rule') continue
    if (it.bodyEnd === undefined) {
      const selBegin = selectorStart(text, it.start, it.selEnd)
      const sel = bareSelector(text.slice(selBegin, it.selEnd)).trim().split('\n')[0]
      report(file, lineOf(text, selBegin), '规则没有闭合的 }', `「${sel}」`)
    }
  }

  /* 5. `:root` 出现在一个非首位的选择器列表里 —— 上面那个事故的直接特征：
     :root 只该单独成组（或与 html 一起），不该跟在 .xxx 后面。 */
  for (const it of items) {
    if (it.type !== 'rule') continue
    const selBegin = selectorStart(text, it.start, it.selEnd)
    const parts = bareSelector(text.slice(selBegin, it.selEnd))
      .split(',').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
    const idx = parts.findIndex((p) => p === ':root' || p === 'html')
    if (idx > 0) {
      report(file, lineOf(text, selBegin), ':root 混进了选择器列表',
        `它在第 ${idx + 1} 位：「${parts[0]}」后面的 :root 通常意味着前一组丢了声明体`)
    }
  }

  console.log(`  规则 ${items.filter((x) => x.type === 'rule').length} 条`);
  /* 6. 令牌使用体检：规则体里出现裸 px 的字号/圆角（刻度外逃） */
  const escaped = []
  const re = /(font-size|border-radius)\s*:\s*([^;{}]*\d+\.?\d*px[^;{}]*)/g
  let m
  while ((m = re.exec(text))) {
    const line = lineOf(text, m.index)
    escaped.push({ line, prop: m[1], val: m[2].trim() })
  }
  if (escaped.length) {
    console.log(`  提示：${escaped.length} 处字号/圆角仍是裸 px（若为插件图标等豁免项可忽略）`)
    escaped.slice(0, 12).forEach((e) => console.log(`     · :${e.line}  ${e.prop}: ${e.val}`))
  }
}

console.log('')
if (problems) {
  console.log(`✗ 发现 ${problems} 个问题`)
  process.exit(1)
} else {
  console.log('✓ CSS 体检通过')
}
