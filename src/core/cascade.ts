/**
 * 三级级联数据加载（通用）
 * ------------------------------------------------------------
 * 供声明式设置面板的 `cascade` 字段使用，不再与天气插件耦合。
 * 数据形状：{ provinces: [{ code, name, cities: [{ code, name, districts: [{ code, name }] }] }] }
 * 同一 URL 全站只请求一次（按 URL 缓存 Promise）。
 */

import { resolveAppUrl } from './url'

export interface CascadeDistrict {
  code: string
  name: string
}

export interface CascadeCity {
  code: string
  name: string
  districts: CascadeDistrict[]
}

export interface CascadeProvince {
  code: string
  name: string
  cities: CascadeCity[]
}
/** 兼容旧命名（天气插件的历史类型名） */
export type CityDistrict = CascadeDistrict
export type City = CascadeCity
export type Province = CascadeProvince

const cache = new Map<string, Promise<CascadeProvince[]>>()

/** 懒加载级联数据（失败时返回空数组，设置面板退化为不可选） */
export function loadCascade(url: string): Promise<CascadeProvince[]> {
  // 以 '/' 开头的数据源需按应用根目录解析（file:// 下尤其重要）
  const resolved = resolveAppUrl(url)
  let hit = cache.get(resolved)
  if (!hit) {
    hit = fetch(resolved)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { provinces?: CascadeProvince[] }) => d.provinces ?? [])
      .catch(() => [])
    cache.set(resolved, hit)
  }
  return hit
}
