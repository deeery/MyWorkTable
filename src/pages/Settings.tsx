import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { MIN_DISPLAY_SCALE, MAX_DISPLAY_SCALE, BACKGROUNDS } from '../core/storage'

/** 显示比例预设档位（1 为标准） */
const SCALE_PRESETS = [0.75, 1, 1.25, 1.5]

/** 单个文件转成 data URL 的大小上限（MB）。
 *  背景图/视频直接以 data URL 存进 localStorage，省得另外管文件路径。
 *  上限不能太大：localStorage 一般只有 5~10MB，超了会静默写入失败，
 *  表现为「选了图片但背景没变」。 */
const MAX_BG_MB = 4

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('读取文件失败'))
    r.readAsDataURL(file)
  })
}

/** 设置页：主题 / 显示比例 / 刷新倍率 / 桌面 */
export function Settings() {
  const {
    settings, setTheme, setRefreshMultiplier, setDisplayScale,
    setTopbarMode, setBackground, setBgImage, setBgVideo,
  } = useApp()
  const [bgErr, setBgErr] = useState<string | null>(null)
  const multiplierLabel =
    settings.refreshMultiplier === 1 ? '标准' :
    settings.refreshMultiplier > 1 ? `省电（${settings.refreshMultiplier}×）` : `高频（${settings.refreshMultiplier}×）`
  const scalePct = Math.round(settings.displayScale * 100)

  /** 选择自定义背景图 */
  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''   // 允许再次选同一个文件
    if (!f) return
    setBgErr(null)
    if (f.size > MAX_BG_MB * 1024 * 1024) {
      setBgErr(`图片太大（${(f.size / 1024 / 1024).toFixed(1)}MB），上限 ${MAX_BG_MB}MB`)
      return
    }
    try {
      setBgImage(await readAsDataUrl(f))
    } catch (err) {
      setBgErr(String(err instanceof Error ? err.message : err))
    }
  }

  /** 选择自定义背景视频 */
  const onPickVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBgErr(null)
    if (f.size > MAX_BG_MB * 1024 * 1024) {
      setBgErr(`视频太大（${(f.size / 1024 / 1024).toFixed(1)}MB），上限 ${MAX_BG_MB}MB`)
      return
    }
    try {
      setBgVideo(await readAsDataUrl(f))
    } catch (err) {
      setBgErr(String(err instanceof Error ? err.message : err))
    }
  }

  return (
    <>
      <div className="panel">
        <h3>外观</h3>
        <div className="setting-row">
          <div>
            <div className="label">主题模式</div>
            <div className="hint">切换后所有插件将收到 workbench:theme / onThemeChange 通知</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn small${settings.theme === 'light' ? ' on' : ''}`} onClick={() => setTheme('light')}>浅色</button>
            <button className={`btn small${settings.theme === 'dark' ? ' on' : ''}`} onClick={() => setTheme('dark')}>深色</button>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="label">显示比例：{scalePct}%</div>
            <div className="hint">
              整体放大或缩小界面（{MIN_DISPLAY_SCALE * 100}%–{MAX_DISPLAY_SCALE * 100}%），
              适合高分辨率屏幕或需要更大字号的场景
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={MIN_DISPLAY_SCALE} max={MAX_DISPLAY_SCALE} step={0.05}
              value={settings.displayScale}
              onChange={(e) => setDisplayScale(Number(e.target.value))}
            />
            <span style={{ minWidth: 44, textAlign: 'right' }}>{scalePct}%</span>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <div className="label">快捷档位</div>
            <div className="hint">常用比例一键切换</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {SCALE_PRESETS.map((s) => (
              <button
                key={s}
                className={`btn small${Math.abs(settings.displayScale - s) < 0.001 ? ' on' : ''}`}
                onClick={() => setDisplayScale(s)}
              >
                {Math.round(s * 100)}%
              </button>
            ))}
            <button className="btn small" onClick={() => setDisplayScale(1)}>重置</button>
          </div>
        </div>
      </div>

      {/* 顶部栏：收起策略 */}
      <div className="panel">
        <h3>顶部栏</h3>
        <div className="setting-row">
          <div>
            <div className="label">收起方式</div>
            <div className="hint">
              顶部栏现在只有工作台选择这一个作用。默认鼠标离开就自动缩成
              一条细线（移上去展开），把空间让给桌面；也可以锁定成一直展开，
              方便频繁切换工作台。顶部栏右侧的锁形按钮是同一个开关。
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn small${settings.topbarMode === 'auto' ? ' on' : ''}`}
              onClick={() => setTopbarMode('auto')}
            >
              自动缩入
            </button>
            <button
              className={`btn small${settings.topbarMode === 'locked' ? ' on' : ''}`}
              onClick={() => setTopbarMode('locked')}
            >
              锁定展开
            </button>
          </div>
        </div>
      </div>

      {/* 背景样式 */}
      <div className="panel">
        <h3>背景</h3>
        <div className="bg-grid">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.id}
              className={`bg-item${settings.background === b.id ? ' on' : ''}`}
              onClick={() => setBackground(b.id)}
            >
              {/* 预览块：与真实背景同源的缩略图 */}
              <span className={`bg-swatch bg-swatch-${b.id}`} aria-hidden="true">
                {b.id === 'image' && settings.bgImage && (
                  <img src={settings.bgImage} alt="" />
                )}
                {b.id === 'video' && settings.bgVideo && (
                  <video src={settings.bgVideo} muted loop autoPlay playsInline />
                )}
              </span>
              <span className="bg-name">{b.name}</span>
              <span className="bg-desc">{b.desc}</span>
            </button>
          ))}
        </div>

        {/* 自定义图片 */}
        {settings.background === 'image' && (
          <div className="setting-row">
            <div>
              <div className="label">自定义背景图</div>
              <div className="hint">选一张本地图片。上限 {MAX_BG_MB}MB，转存后随设置一起持久化。</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className="btn small">
                选择图片
                <input type="file" accept="image/*" hidden onChange={onPickImage} />
              </label>
              {settings.bgImage && (
                <button className="btn small danger" onClick={() => setBgImage(undefined)}>移除</button>
              )}
            </div>
          </div>
        )}

        {/* 自定义视频 */}
        {settings.background === 'video' && (
          <div className="setting-row">
            <div>
              <div className="label">自定义背景视频</div>
              <div className="hint">
                选一段本地视频，循环静音播放。上限 {MAX_BG_MB}MB；
                切回其他背景即停止播放（不继续耗电）。
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className="btn small">
                选择视频
                <input type="file" accept="video/*" hidden onChange={onPickVideo} />
              </label>
              {settings.bgVideo && (
                <button className="btn small danger" onClick={() => setBgVideo(undefined)}>移除</button>
              )}
            </div>
          </div>
        )}

        {bgErr && <div className="setting-hint" style={{ color: 'var(--danger)' }}>{bgErr}</div>}
      </div>

      <div className="panel">
        <h3>刷新调度</h3>
        <div className="setting-row">
          <div>
            <div className="label">全局刷新倍率：{multiplierLabel}</div>
            <div className="hint">缩放所有插件的实际刷新周期（页面不可见时自动暂停调度以省资源）</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range" min="0.25" max="4" step="0.25"
              value={settings.refreshMultiplier}
              onChange={(e) => setRefreshMultiplier(Number(e.target.value))}
            />
            <span style={{ minWidth: 40, textAlign: 'right' }}>{settings.refreshMultiplier}×</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>桌面</h3>
        <div className="setting-row">
          <div>
            <div className="label">自由布局</div>
            <div className="hint">
              桌面采用自由画布：滚轮缩放、拖拽顶部栏移动、拖拽右下角任意比例缩放。
              卡片位置与尺寸会自动持久化。
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>关于插件协议</h3>
        <div className="setting-row">
          <div className="hint" style={{ lineHeight: 1.8 }}>
            本工作台采用 <b>Plugin Protocol v1</b>：插件以 <b>manifest</b> 声明入口、渲染模式
            （iframe 沙箱 / ES Module）、刷新策略与权限；宿主统一调度刷新、下发主题，并以
            postMessage / PluginContext 两种通道通信。完整规范见项目 <code>docs/PLUGIN_SPEC.md</code>。
          </div>
        </div>
      </div>
    </>
  )
}
