import { randomUUID } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 生成带前缀、可读、按时间大致有序的 ID，例如 ch_2k9z8x4q1m。 */
export function makeId(prefix: string, length = 10): string {
  let time = Date.now();
  let out = '';
  // 时间部分：36 进制，保证按创建时间排序
  for (let i = 0; i < 8; i++) {
    out = ALPHABET[time % 36] + out;
    time = Math.floor(time / 36);
  }
  const random = randomUUID().replace(/-/g, '');
  return `${prefix}_${out}${random.slice(0, Math.max(0, length - 8))}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asTrimmedString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === 'string' && v.trim() && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 简易并发互斥队列：同一 key 的操作串行执行（用于正文保存、自动备份等）。 */
export class SerialQueue {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.tails.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
