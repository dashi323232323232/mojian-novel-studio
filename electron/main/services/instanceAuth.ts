import crypto from 'node:crypto';
import type { Database } from '../db/database';
import { nowIso, parseJson, toJson } from '../util';

/**
 * 实例密码服务。
 *
 * 设计要点：
 * - 只使用 Node 内置 crypto（scrypt 加盐哈希），不引入任何第三方依赖；
 * - 数据库中只保存 salt / hash / 参数，**永不保存明文密码**；
 * - 校验使用 crypto.timingSafeEqual，避免逐字节比较带来的时间侧信道；
 * - 首次使用（还没有任何密码记录）时，用默认密码初始化，并把 isDefault 标记为 true，
 *   方便界面提示「当前仍是默认密码，请尽快修改」。
 */

/** 首次使用时的默认密码（用户明确要求，会写进 GitHub 仓库简介）。修改密码后该值不再生效。 */
export const DEFAULT_INSTANCE_PASSWORD = 'Qy60811';

/** app_settings 中的存储键。 */
const AUTH_KEY = 'instance.auth';
const ALGO = 'scrypt';
/** 派生密钥长度（字节）。 */
const KEY_LENGTH = 32;
/** scrypt 参数：N（CPU/内存代价，必须是 2 的幂）、r（块大小）、p（并行度）。 */
const DEFAULT_COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
/** 密码最大长度：1KB，超过直接拒绝，避免异常输入拖慢哈希计算。 */
const MAX_PASSWORD_LENGTH = 1024;
/** 新密码最短长度，避免把密码改成空串或单个字符。 */
const MIN_PASSWORD_LENGTH = 4;

/** 落库的密码记录结构（不含明文）。 */
export interface InstanceAuthRecord {
  algo: typeof ALGO;
  /** 随机盐（hex）。 */
  salt: string;
  /** scrypt 派生结果（hex）。 */
  hash: string;
  /** scrypt 的 N 参数（每次初始化随机生成新盐，参数固定）。 */
  iterations: number;
  updatedAt: string;
  /** 是否仍在使用默认密码。 */
  isDefault: boolean;
}

export type SetPasswordResult = { ok: true } | { ok: false; error: string };

function isHex(value: string, bytes?: number): boolean {
  if (!/^[0-9a-fA-F]+$/.test(value)) return false;
  if (bytes !== undefined && value.length !== bytes * 2) return false;
  return value.length % 2 === 0;
}

/** 密码入参校验：非字符串、空串、超过 1KB 一律拒绝。 */
function checkPasswordInput(value: unknown, label: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string') return { ok: false, error: `${label}格式无效` };
  if (value.length === 0) return { ok: false, error: `${label}不能为空` };
  if (value.length > MAX_PASSWORD_LENGTH) return { ok: false, error: `${label}长度不能超过 1KB` };
  return { ok: true, value };
}

export class InstanceAuthService {
  constructor(private db: Database) {}

  /** 是否已经存在密码记录（首次启动时为 false）。 */
  isInitialized(): boolean {
    return this.readRecord() !== null;
  }

  /** 是否仍在使用默认密码（未初始化时按默认密码处理，返回 true）。 */
  isUsingDefaultPassword(): boolean {
    this.ensureInitialized();
    return this.readRecord()?.isDefault !== false;
  }

  /**
   * 首次使用时用默认密码初始化。
   * 重复调用是安全的：已有记录时直接返回。
   */
  ensureInitialized(): void {
    if (this.readRecord()) return;
    this.writeRecord(this.createRecord(DEFAULT_INSTANCE_PASSWORD, true));
  }

  /** 校验密码。非法输入（非字符串 / 空串 / 超长）直接返回 false，不做哈希计算。 */
  verify(password: string): boolean {
    const checked = checkPasswordInput(password, '密码');
    if (!checked.ok) return false;
    this.ensureInitialized();
    const record = this.readRecord();
    if (!record) return false;
    const expected = Buffer.from(record.hash, 'hex');
    const actual = this.derive(checked.value, Buffer.from(record.salt, 'hex'), record.iterations);
    if (expected.length !== actual.length) return false;
    try {
      return crypto.timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  /**
   * 修改密码：必须提供正确的当前密码。
   * 失败时返回 { ok: false, error }，不抛出内部细节。
   */
  setPassword(current: string, next: string): SetPasswordResult {
    const currentChecked = checkPasswordInput(current, '当前密码');
    if (!currentChecked.ok) return currentChecked;
    const nextChecked = checkPasswordInput(next, '新密码');
    if (!nextChecked.ok) return nextChecked;
    if (nextChecked.value.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, error: `新密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符` };
    }
    this.ensureInitialized();
    if (!this.verify(currentChecked.value)) {
      return { ok: false, error: '当前密码不正确' };
    }
    this.writeRecord(this.createRecord(nextChecked.value, false));
    return { ok: true };
  }

  /** 生成一条新记录：每次都用 crypto.randomBytes 生成 16 字节随机盐。 */
  private createRecord(password: string, isDefault: boolean): InstanceAuthRecord {
    const salt = crypto.randomBytes(16);
    const hash = this.derive(password, salt, DEFAULT_COST);
    return {
      algo: ALGO,
      salt: salt.toString('hex'),
      hash: hash.toString('hex'),
      iterations: DEFAULT_COST,
      updatedAt: nowIso(),
      isDefault,
    };
  }

  /** scrypt 派生；maxmem 按 N、r 计算，避免大参数时被 Node 默认 32MB 限制拒绝。 */
  private derive(password: string, salt: Buffer, cost: number): Buffer {
    const maxmem = Math.max(32 * 1024 * 1024, 256 * cost * BLOCK_SIZE);
    return crypto.scryptSync(password, salt, KEY_LENGTH, {
      N: cost,
      r: BLOCK_SIZE,
      p: PARALLELISM,
      maxmem,
    });
  }

  private readRecord(): InstanceAuthRecord | null {
    const raw = this.db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', AUTH_KEY)?.value;
    if (typeof raw !== 'string' || !raw) return null;
    const parsed = parseJson<Partial<InstanceAuthRecord>>(raw, {});
    if (parsed.algo !== ALGO) return null;
    if (typeof parsed.salt !== 'string' || !isHex(parsed.salt, 16)) return null;
    if (typeof parsed.hash !== 'string' || !isHex(parsed.hash, KEY_LENGTH)) return null;
    const iterations = Number(parsed.iterations);
    if (!Number.isInteger(iterations) || iterations < 2 || (iterations & (iterations - 1)) !== 0) return null;
    return {
      algo: ALGO,
      salt: parsed.salt,
      hash: parsed.hash,
      iterations,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
      isDefault: parsed.isDefault === true,
    };
  }

  private writeRecord(record: InstanceAuthRecord): void {
    this.db.run(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      AUTH_KEY,
      toJson(record),
    );
  }
}
