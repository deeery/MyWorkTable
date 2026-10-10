/** 尺寸 → 网格跨度（配合桌面 grid 的 grid-column: span N） */
export const SIZE_SPAN: Record<string, number> = { S: 1, M: 1, L: 2, XL: 3 }
export const SIZE_NEXT: Record<string, string> = { S: 'M', M: 'L', L: 'XL', XL: 'S' }
export const SIZE_MIN_H: Record<string, number> = { S: 180, M: 220, L: 260, XL: 300 }
