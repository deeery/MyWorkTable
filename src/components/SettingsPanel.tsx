import { useEffect, useState } from 'react'
import type {
  SettingsField,
  SettingsCascadeField,
  SettingsPaletteField,
  SettingsFontField,
  PluginSettingsSchema,
} from '../types/plugin'
import type { CascadeProvince, CascadeCity } from '../core/cascade'
import { loadCascade } from '../core/cascade'
import { getPalette, palettePatch, readableTextColor } from '../core/palettes'
import type { PaletteSwatch } from '../core/palettes'
import { getFontSet } from '../core/fonts'
import type { FontOption } from '../core/fonts'

/**
 * 声明式设置面板
 * ------------------------------------------------------------
 * 依据 manifest.settings 自动渲染齿轮面板中的表单控件，取代此前按插件 id
 * 硬编码在 PluginCard 里的四套面板。第三方插件只需在 manifest 里声明
 * settings 字段即可获得设置界面，无需改动宿主源码。
 *
 * 所有值以字符串写入 config（与 PluginContext.config 的类型一致）。
 */

interface PanelProps {
  schema: PluginSettingsSchema
  config: Record<string, string>
  setConfig: (patch: Record<string, string>) => void
}

/** 单个字段的入参（不含 schema） */
interface FieldProps {
  config: Record<string, string>
  setConfig: (patch: Record<string, string>) => void
}

export function SettingsPanel({ schema, config, setConfig }: PanelProps) {
  return (
    <>
      {schema.title && <h4>{schema.title}</h4>}
      {schema.fields.map((f) => (
        <Field key={f.key} field={f} config={config} setConfig={setConfig} />
      ))}
    </>
  )
}

function Field({ field, config, setConfig }: FieldProps & { field: SettingsField }) {
  switch (field.type) {
    case 'cascade':
      return <CascadeField field={field} config={config} setConfig={setConfig} />
    case 'palette':
      return <PaletteField field={field} config={config} setConfig={setConfig} />
    case 'font':
      return <FontField field={field} config={config} setConfig={setConfig} />
    case 'select':
      return (
        <Row label={field.label} hint={field.hint}>
          <select
            value={config[field.key] ?? field.default ?? ''}
            onChange={(e) => setConfig({ [field.key]: e.target.value })}
          >
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Row>
      )
    case 'color':
      return (
        <Row label={field.label} hint={field.hint}>
          <input
            type="color"
            value={config[field.key] ?? field.default ?? '#ffffff'}
            onChange={(e) => setConfig({ [field.key]: e.target.value })}
          />
        </Row>
      )
    case 'number':
      return (
        <Row label={field.label} hint={field.hint}>
          <NumberInput field={field} config={config} setConfig={setConfig} />
        </Row>
      )
    case 'text':
      return (
        <Row label={field.label} hint={field.hint}>
          <input
            type="text"
            placeholder={field.placeholder}
            value={config[field.key] ?? field.default ?? ''}
            onChange={(e) => setConfig({ [field.key]: e.target.value })}
          />
        </Row>
      )
  }
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span className="setting-label" title={hint}>{label}</span>
      {children}
    </div>
  )
}

/**
 * 数字输入：用 defaultValue + onBlur 提交，避免受控数值在输入过程中被强行夹回，
 * 导致「想输 30 却被逐字符夹成 5」这类问题。
 */
function NumberInput({
  field,
  config,
  setConfig,
}: FieldProps & { field: Extract<SettingsField, { type: 'number' }> }) {
  const commit = (raw: string) => {
    const min = field.min ?? -Infinity
    const max = field.max ?? Infinity
    const fallback = Number(field.default)
    const n = parseInt(raw, 10)
    const v = Number.isFinite(n)
      ? Math.min(max, Math.max(min, n))
      : Number.isFinite(fallback) ? fallback : min
    setConfig({ [field.key]: String(v) })
  }
  return (
    <input
      type="number"
      defaultValue={config[field.key] ?? field.default ?? ''}
      min={field.min}
      max={field.max}
      step={field.step}
      onBlur={(e) => commit(e.target.value)}
    />
  )
}

/**
 * 省 / 市 / 区县三级联动。
 *
 * 中间状态不单独保存：省份与城市都由已提交的完整区域码**反查级联树**得到，
 * 因此面板重渲染（例如配置下发）不会丢失用户的级联选择。
 *
 * ⚠ 不能用「截取码前缀」来反推省/市：码表已迁移到 9 位 areaid（北京=101010100、
 * 海淀=101010200），省/市/区县各自是独立的 9 位码，彼此并非 5/7/9 位前缀关系。
 * 早期版本用 code.slice(0,5)/slice(0,7) 反推，导致 province/city 恒为 undefined、
 * 城市下拉永久 disabled（点了没反馈）。现改为遍历树按 code 匹配。
 */
function CascadeField({
  field,
  config,
  setConfig,
}: FieldProps & { field: SettingsCascadeField }) {
  const [provinces, setProvinces] = useState<CascadeProvince[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadCascade(field.source).then((list) => {
      if (!alive) return
      setProvinces(list)
      setLoading(false)
    })
    return () => { alive = false }
  }, [field.source])

  const code = config[field.key] ?? field.default ?? ''
  // 按完整 9 位码在级联树里反查所属省/市（而非截取前缀——码制不再是层级前缀）。
  let province: CascadeProvince | undefined
  let city: CascadeCity | undefined
  for (const p of provinces) {
    const pc = p.cities.find((c) => c.districts.some((d) => d.code === code))
    if (pc) { province = p; city = pc; break }
  }
  // 万一当前码是市本级（无区县），退回按市码直接匹配
  if (!province) {
    for (const p of provinces) {
      const pc = p.cities.find((c) => c.code === code)
      if (pc) { province = p; city = pc; break }
    }
  }
  // 万一当前码是省本级，只定位到省
  if (!province) province = provinces.find((p) => p.code === code)
  const pCode = province?.code ?? ''
  const cCode = city?.code ?? ''

  const commit = (districtCode: string | undefined, name: string | undefined) => {
    if (!districtCode) return
    const patch: Record<string, string> = { [field.key]: districtCode }
    if (field.nameKey && name) patch[field.nameKey] = name
    setConfig(patch)
  }

  return (
    <>
      <Row label="省份">
        <select
          value={pCode}
          disabled={!provinces.length}
          onChange={(e) => {
            const d = provinces.find((p) => p.code === e.target.value)?.cities[0]?.districts[0]
            commit(d?.code, d?.name)
          }}
        >
          <option value="">请选择</option>
          {provinces.map((p) => (
            <option key={p.code} value={p.code}>{p.name}</option>
          ))}
        </select>
      </Row>
      <Row label="城市">
        <select
          value={cCode}
          disabled={!province}
          onChange={(e) => {
            const d = province?.cities.find((c) => c.code === e.target.value)?.districts[0]
            commit(d?.code, d?.name)
          }}
        >
          <option value="">请选择</option>
          {(province?.cities ?? []).map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
      </Row>
      <Row label="区县">
        <select
          value={code}
          disabled={!city}
          onChange={(e) => {
            const d = city?.districts.find((x) => x.code === e.target.value)
            commit(d?.code, d?.name)
          }}
        >
          <option value="">请选择</option>
          {(city?.districts ?? []).map((d) => (
            <option key={d.code} value={d.code}>{d.name}</option>
          ))}
        </select>
      </Row>
      {loading && <div className="setting-hint">城市数据加载中…</div>}
      {!loading && !provinces.length && <div className="setting-hint">城市数据加载失败</div>}
    </>
  )
}

/**
 * 字体族选择：渲染为下拉表格，每个选项以该字体本身预览（所见即所得）。
 *
 * 原生 <select> 的 <option> 无法可靠地逐项设置字体（各浏览器支持不一），
 * 故这里用按钮 + 浮层列表自绘一个「下拉表格」，每行以对应字体渲染示例文字。
 */
function FontField({
  field,
  config,
  setConfig,
}: FieldProps & { field: SettingsFontField }) {
  const [open, setOpen] = useState(false)
  // 统一两种来源：内置字体清单带 stack（完整回退链），自定义 options 只有 value/label
  const fonts: FontOption[] = field.options
    ? field.options.map((o) => ({ value: o.value, label: o.label, stack: o.value }))
    : (getFontSet(field.fonts) ?? [])
  const current = config[field.key] ?? field.default ?? 'inherit'
  const currentFont = fonts.find((f) => f.value === current)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.font-select')) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  if (!fonts.length) {
    return <div className="setting-hint">字体清单 “{field.fonts ?? 'ui'}” 不存在</div>
  }

  const sample = '便签文字 Aa 123'

  return (
    <div className="setting-row">
      <span className="setting-label" title={field.hint}>{field.label}</span>
      <div className="font-select">
        <button
          type="button"
          className="font-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{ fontFamily: currentFont?.stack }}
        >
          <span className="font-trigger-label">{currentFont?.label ?? current}</span>
          <span className="font-caret">▾</span>
        </button>
        {open && (
          <div className="font-menu" role="listbox" aria-label={field.label}>
            {fonts.map((f) => {
              const active = f.value === current
              return (
                <button
                  key={f.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`font-option${active ? ' active' : ''}`}
                  onClick={() => { setConfig({ [field.key]: f.value }); setOpen(false) }}
                >
                  <span className="font-option-name" style={{ fontFamily: f.stack }}>
                    {f.label}
                  </span>
                  <span className="font-option-sample" style={{ fontFamily: f.stack }}>
                    {sample}
                  </span>
                  {active && <span className="font-option-check">✓</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 预设配色选择。
 *
 * 每一项都是一个「色块 │ 竖线 │ 色块」的配色对：左半是背景色、右半是与之
 * 自动搭配的可读字体色，中间以细竖线分隔。用户一眼就能看到整组配色效果，
 * 而不是只看到一个孤立色块。
 *
 * 点击某项会同时写入背景色与配对字体色（后者写入 `pairWith` 指定的键）；
 * 若未声明 `pairWith`，则退化为单色块（仅写入本字段）。
 */
function PaletteField({
  field,
  config,
  setConfig,
}: FieldProps & { field: SettingsPaletteField }) {
  const swatches = getPalette(field.palette)
  const current = (config[field.key] ?? field.default ?? '').toLowerCase()

  if (!swatches || !swatches.length) {
    return <div className="setting-hint">色板 “{field.palette}” 不存在</div>
  }

  const pick = (swatch: PaletteSwatch) => {
    setConfig(palettePatch(field.key, swatch, field.pairWith))
  }

  // 是否成对展示：声明了 pairWith 且色板项带配对前景色
  const paired = !!field.pairWith && swatches.some((s) => s.fg)

  return (
    <div className="setting-row palette-row">
      <span className="setting-label" title={field.hint}>{field.label}</span>
      <div
        className={`palette-grid${paired ? ' paired' : ''}`}
        role="radiogroup"
        aria-label={field.label}
      >
        {swatches.map((s) => {
          const active = s.value.toLowerCase() === current
          return (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={paired ? `${s.label}：底色 ${s.value} / 字色 ${s.fg}` : `${s.label} ${s.value}`}
              title={paired ? `${s.label}　底色 ${s.value} · 字色 ${s.fg}` : `${s.label} ${s.value}`}
              className={`palette-pair${active ? ' active' : ''}`}
              onClick={() => pick(s)}
            >
              <span className="palette-half" style={{ background: s.value }}>
                {paired && s.fg && (
                  <span className="palette-sample" style={{ color: s.fg }}>Aa</span>
                )}
              </span>
              {paired && s.fg && (
                <>
                  <span className="palette-divider" />
                  <span className="palette-half" style={{ background: s.fg }} />
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
