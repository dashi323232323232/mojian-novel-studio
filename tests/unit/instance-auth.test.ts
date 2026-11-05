import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../../electron/main/db/database';
import { DEFAULT_INSTANCE_PASSWORD, InstanceAuthService } from '../../electron/main/services/instanceAuth';

/** 建一个临时数据库，返回服务实例与目录（测试结束后统一清理）。 */
function tempAuth(): { auth: InstanceAuthService; db: Database; dir: string } {
  const dir = path.join(os.tmpdir(), `dashi-instance-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'dashi.db'));
  return { auth: new InstanceAuthService(db), db, dir };
}

/** 读取 app_settings 中保存的原始值（用于断言「库里不是明文」）。 */
function rawAuthValue(db: Database): string {
  return db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', 'instance.auth')?.value ?? '';
}

describe('实例密码：scrypt 加盐哈希', () => {
  it('默认密码 Qy123456 可以通过校验', () => {
    const { auth, db } = tempAuth();
    try {
      assert.equal(auth.isInitialized(), false);
      assert.equal(auth.isUsingDefaultPassword(), true);
      assert.equal(auth.verify(DEFAULT_INSTANCE_PASSWORD), true);
      assert.equal(auth.isInitialized(), true);
      assert.equal(auth.isUsingDefaultPassword(), true);
    } finally {
      db.close();
    }
  });

  it('错误密码、空串、非字符串、超长密码都不通过', () => {
    const { auth, db } = tempAuth();
    try {
      assert.equal(auth.verify('Qy123457'), false);
      assert.equal(auth.verify(''), false);
      assert.equal(auth.verify(' qy123456 '), false);
      // 非字符串输入直接拒绝，不能抛异常
      assert.equal(auth.verify(undefined as never), false);
      assert.equal(auth.verify(12345678 as never), false);
      assert.equal(auth.verify({ password: DEFAULT_INSTANCE_PASSWORD } as never), false);
      // 超过 1KB 的输入直接拒绝
      assert.equal(auth.verify(DEFAULT_INSTANCE_PASSWORD + 'x'.repeat(2048)), false);
      // 上面这些非法输入不应影响正常密码
      assert.equal(auth.verify(DEFAULT_INSTANCE_PASSWORD), true);
    } finally {
      db.close();
    }
  });

  it('库里保存的不是明文密码', () => {
    const { auth, db } = tempAuth();
    try {
      auth.ensureInitialized();
      const raw = rawAuthValue(db);
      assert.ok(raw.length > 0);
      assert.equal(raw.includes(DEFAULT_INSTANCE_PASSWORD), false);
      assert.equal(raw.toLowerCase().includes(DEFAULT_INSTANCE_PASSWORD.toLowerCase()), false);
      const parsed = JSON.parse(raw) as { algo: string; salt: string; hash: string; iterations: number };
      assert.equal(parsed.algo, 'scrypt');
      assert.match(parsed.salt, /^[0-9a-f]{32}$/);
      assert.match(parsed.hash, /^[0-9a-f]{64}$/);
      assert.ok(parsed.iterations >= 2);
    } finally {
      db.close();
    }
  });

  it('两个库各自初始化，salt 与 hash 都不相同', () => {
    const one = tempAuth();
    const two = tempAuth();
    try {
      one.auth.ensureInitialized();
      two.auth.ensureInitialized();
      const a = JSON.parse(rawAuthValue(one.db)) as { salt: string; hash: string };
      const b = JSON.parse(rawAuthValue(two.db)) as { salt: string; hash: string };
      assert.notEqual(a.salt, b.salt);
      assert.notEqual(a.hash, b.hash);
      // 同一密码在不同盐下派生出不同结果，但两个库都能校验通过
      assert.equal(one.auth.verify(DEFAULT_INSTANCE_PASSWORD), true);
      assert.equal(two.auth.verify(DEFAULT_INSTANCE_PASSWORD), true);
    } finally {
      one.db.close();
      two.db.close();
    }
  });

  it('改密码需要正确的当前密码', () => {
    const { auth, db } = tempAuth();
    try {
      auth.ensureInitialized();
      assert.deepEqual(auth.setPassword('wrong-password', 'NewPass2024'), {
        ok: false,
        error: '当前密码不正确',
      });
      // 失败后旧密码仍然有效，新密码不生效
      assert.equal(auth.verify(DEFAULT_INSTANCE_PASSWORD), true);
      assert.equal(auth.verify('NewPass2024'), false);
      // 非字符串 / 空串 / 超长同样被拒绝
      assert.equal(auth.setPassword(undefined as never, 'NewPass2024').ok, false);
      assert.equal(auth.setPassword(DEFAULT_INSTANCE_PASSWORD, '').ok, false);
      assert.equal(auth.setPassword(DEFAULT_INSTANCE_PASSWORD, 'x'.repeat(2048)).ok, false);
    } finally {
      db.close();
    }
  });

  it('改密码成功后旧密码失效、新密码生效', () => {
    const { auth, db } = tempAuth();
    try {
      auth.ensureInitialized();
      assert.deepEqual(auth.setPassword(DEFAULT_INSTANCE_PASSWORD, 'NewPass2024'), { ok: true });
      assert.equal(auth.verify(DEFAULT_INSTANCE_PASSWORD), false);
      assert.equal(auth.verify('NewPass2024'), true);
      assert.equal(auth.isUsingDefaultPassword(), false);
      // 新密码同样不是明文存储
      const raw = rawAuthValue(db);
      assert.equal(raw.includes('NewPass2024'), false);
      // 再次修改必须使用新密码作为当前密码
      assert.equal(auth.setPassword(DEFAULT_INSTANCE_PASSWORD, 'Another2025').ok, false);
      assert.deepEqual(auth.setPassword('NewPass2024', 'Another2025'), { ok: true });
      assert.equal(auth.verify('NewPass2024'), false);
      assert.equal(auth.verify('Another2025'), true);
    } finally {
      db.close();
    }
  });

  it('新密码太短被拒绝', () => {
    const { auth, db } = tempAuth();
    try {
      auth.ensureInitialized();
      const result = auth.setPassword(DEFAULT_INSTANCE_PASSWORD, 'ab');
      assert.equal(result.ok, false);
      assert.match((result as { error: string }).error, /至少/);
      assert.equal(auth.verify(DEFAULT_INSTANCE_PASSWORD), true);
    } finally {
      db.close();
    }
  });

  it('重新打开数据库后密码仍然有效（持久化）', () => {
    const dir = path.join(os.tmpdir(), `dashi-instance-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'dashi.db');
    const first = new Database(file);
    const authA = new InstanceAuthService(first);
    authA.ensureInitialized();
    assert.deepEqual(authA.setPassword(DEFAULT_INSTANCE_PASSWORD, 'Persist2024'), { ok: true });
    first.close();

    const second = new Database(file);
    const authB = new InstanceAuthService(second);
    try {
      assert.equal(authB.isInitialized(), true);
      assert.equal(authB.verify('Persist2024'), true);
      assert.equal(authB.verify(DEFAULT_INSTANCE_PASSWORD), false);
      assert.equal(authB.isUsingDefaultPassword(), false);
    } finally {
      second.close();
    }
  });

  describe('默认密码变更后的迁移', () => {
    /**
     * 模拟「旧版本留下的默认密码」：直接往 app_settings 写一条 isDefault=true 的记录。
     * 不能用 setPassword，因为它会把 isDefault 置为 false（那代表用户主动改过密码）。
     */
    function authWithDefault(initial: string) {
      const dir = path.join(os.tmpdir(), `dashi-auth-mig-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      fs.mkdirSync(dir, { recursive: true });
      const db = new Database(path.join(dir, 'dashi.db'));
      const auth = new InstanceAuthService(db);
      // 先让服务用当前默认密码初始化，拿到 createRecord 的格式
      auth.ensureInitialized();
      // 再手工把记录改成旧密码 + isDefault=true，等价于旧版本写下的数据
      const parsed = JSON.parse(rawAuthValue(db)) as Record<string, unknown>;
      const salt = crypto.randomBytes(16);
      const hash = crypto.scryptSync(initial, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
      db.run(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        'instance.auth',
        JSON.stringify({ ...parsed, salt: salt.toString('hex'), hash: hash.toString('hex'), isDefault: true }),
      );
      return { auth, db };
    }

    it('旧默认密码会被迁移到当前默认密码', () => {
      const { auth, db } = authWithDefault('OldDefault2020');
      try {
        // 迁移前：旧密码有效、新默认密码无效
        assert.equal(auth.verify('OldDefault2020'), true);
        assert.equal(auth.verify(DEFAULT_INSTANCE_PASSWORD), false);
        assert.equal(auth.migrateDefaultPassword('OldDefault2020'), true);
        assert.equal(auth.verify('OldDefault2020'), false);
        assert.equal(auth.verify(DEFAULT_INSTANCE_PASSWORD), true);
        assert.equal(auth.isUsingDefaultPassword(), true);
      } finally {
        db.close();
      }
    });

    it('用户自己改过的密码绝不会被迁移覆盖', () => {
      const { auth, db } = tempAuth();
      try {
        auth.ensureInitialized();
        assert.deepEqual(auth.setPassword(DEFAULT_INSTANCE_PASSWORD, 'MyOwnPass2024'), { ok: true });
        // isDefault 已变成 false，即使传入「旧默认密码」也不应迁移
        assert.equal(auth.migrateDefaultPassword('MyOwnPass2024'), false);
        assert.equal(auth.verify('MyOwnPass2024'), true);
        assert.equal(auth.verify(DEFAULT_INSTANCE_PASSWORD), false);
      } finally {
        db.close();
      }
    });

    it('传入不匹配的旧密码时不迁移', () => {
      const { auth, db } = authWithDefault('OldDefault2020');
      try {
        assert.equal(auth.migrateDefaultPassword('NotTheOldOne'), false);
        assert.equal(auth.verify('OldDefault2020'), true);
        assert.equal(auth.verify(DEFAULT_INSTANCE_PASSWORD), false);
      } finally {
        db.close();
      }
    });

    it('支持一次传入多个历史默认密码', () => {
      const { auth, db } = authWithDefault('VeryOldDefault');
      try {
        assert.equal(auth.migrateDefaultPassword(['Qy60811', 'VeryOldDefault']), true);
        assert.equal(auth.verify(DEFAULT_INSTANCE_PASSWORD), true);
      } finally {
        db.close();
      }
    });

    it('已经是当前默认密码时不做无意义重写', () => {
      const { auth, db } = tempAuth();
      try {
        auth.ensureInitialized();
        const before = rawAuthValue(db);
        assert.equal(auth.migrateDefaultPassword('Qy60811'), false);
        assert.equal(rawAuthValue(db), before, '不应重写哈希');
      } finally {
        db.close();
      }
    });
  });
});
