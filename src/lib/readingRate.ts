/**
 * 朗读语速：范围常量与格式化（纯函数，不依赖 DOM / React，便于单测）。
 *
 * 实时朗读引擎（SpeechReader）与迷你朗读弹窗共用同一套夹紧规则，
 * 避免「UI 允许 0.1~3、引擎却写死 0.5~2」这类不一致。
 */

/** 最小语速倍率 */
export const MIN_RATE = 0.1;
/** 最大语速倍率 */
export const MAX_RATE = 3;

/** 语速预设按钮：从小到大，全部落在 [MIN_RATE, MAX_RATE] 内。 */
export const RATE_PRESETS: number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

/** 统一保留两位小数，避免 0.1 + 0.2 之类的浮点尾巴显示成 0.30000000000000004。 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 把任意输入夹到 0.1 ~ 3，并保留两位小数。
 * 非数字（含 null / undefined / '' / NaN / Infinity）回退到 fallback（默认 1 倍速）。
 */
export function clampRate(n: unknown, fallback = 1): number {
  const raw =
    typeof n === 'number' ? n : typeof n === 'string' && n.trim() !== '' ? Number(n) : Number.NaN;
  if (!Number.isFinite(raw)) {
    const fb = typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 1;
    return round2(Math.min(MAX_RATE, Math.max(MIN_RATE, fb)));
  }
  return round2(Math.min(MAX_RATE, Math.max(MIN_RATE, raw)));
}

/**
 * 语速显示格式：1 → "1"，1.5 → "1.5"，0.85 → "0.85"，2 → "2"。
 * 非法值按 1 倍速显示。
 */
export function formatRate(n: number): string {
  const value = typeof n === 'number' && Number.isFinite(n) ? round2(n) : 1;
  return String(value);
}
