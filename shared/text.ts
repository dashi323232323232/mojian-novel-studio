/** 中文字数统计：CJK 字符逐字计数，连续的拉丁字母/数字算一个词。 */
export function countWords(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/g);
  const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
  const other = text.match(/[\u0e00-\u0e7f\u0400-\u04ff]/g);
  return (cjk?.length ?? 0) + (latin?.length ?? 0) + (other?.length ?? 0);
}

export function excerpt(text: string, length = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= length) return flat;
  return flat.slice(0, length) + '…';
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '从未';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDateTime(iso).slice(0, 10);
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function normalizeTitle(value: unknown, field = '名称'): string {
  if (typeof value !== 'string') {
    throw new Error(`${field}必须是字符串`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field}不能为空`);
  if (trimmed.length > 200) throw new Error(`${field}不能超过 200 个字符`);
  return trimmed;
}
