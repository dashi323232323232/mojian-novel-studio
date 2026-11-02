import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_RATE, MAX_RATE, RATE_PRESETS, clampRate, formatRate } from '../../src/lib/readingRate';

describe('语速工具：clampRate 夹紧范围', () => {
  test('低于下限夹到 0.1', () => {
    assert.equal(clampRate(0.05), MIN_RATE);
    assert.equal(clampRate(-1), MIN_RATE);
    assert.equal(clampRate(0), MIN_RATE);
  });

  test('高于上限夹到 3', () => {
    assert.equal(clampRate(9), MAX_RATE);
    assert.equal(clampRate(3.0001), MAX_RATE);
  });

  test('范围内保留原值，且只保留两位小数', () => {
    assert.equal(clampRate(1), 1);
    assert.equal(clampRate(1.5), 1.5);
    assert.equal(clampRate(1.234), 1.23);
    assert.equal(clampRate(0.876), 0.88);
  });

  test('非数字回退到 fallback（默认 1）', () => {
    assert.equal(clampRate('abc'), 1);
    assert.equal(clampRate(undefined), 1);
    assert.equal(clampRate(null), 1);
    assert.equal(clampRate(Number.NaN), 1);
    assert.equal(clampRate(Number.POSITIVE_INFINITY), 1);
  });

  test('显式 fallback 生效，且 fallback 自身也被夹紧', () => {
    assert.equal(clampRate('abc', 1.25), 1.25);
    assert.equal(clampRate('abc', 9), MAX_RATE);
    assert.equal(clampRate('abc', 0.01), MIN_RATE);
  });

  test('数字字符串按数字处理', () => {
    assert.equal(clampRate('1.5'), 1.5);
    assert.equal(clampRate(' 0.85 '), 0.85);
    assert.equal(clampRate('9'), MAX_RATE);
    assert.equal(clampRate(''), 1, '空串视为非数字');
  });

  test('结果永远落在 [MIN_RATE, MAX_RATE] 内', () => {
    for (const v of [-100, -1, 0, 0.0001, 0.5, 1, 2, 3, 99, 1e6]) {
      const r = clampRate(v);
      assert.ok(r >= MIN_RATE && r <= MAX_RATE, `clampRate(${v}) = ${r} 越界`);
    }
  });
});

describe('语速工具：formatRate 显示格式', () => {
  test('整数不带小数点', () => {
    assert.equal(formatRate(1), '1');
    assert.equal(formatRate(2), '2');
    assert.equal(formatRate(3), '3');
  });

  test('一位小数去掉末尾的 0', () => {
    assert.equal(formatRate(1.5), '1.5');
    assert.equal(formatRate(2.5), '2.5');
    assert.equal(formatRate(0.5), '0.5');
  });

  test('两位小数完整保留', () => {
    assert.equal(formatRate(0.85), '0.85');
    assert.equal(formatRate(0.1), '0.1');
    assert.equal(formatRate(1.23), '1.23');
  });

  test('超过两位小数四舍五入到两位', () => {
    assert.equal(formatRate(1.234), '1.23');
    assert.equal(formatRate(0.876), '0.88');
  });

  test('非法值按 1 倍速显示', () => {
    assert.equal(formatRate(Number.NaN), '1');
  });
});

describe('语速工具：RATE_PRESETS 预设', () => {
  test('严格单调递增', () => {
    assert.ok(RATE_PRESETS.length > 1);
    for (let i = 1; i < RATE_PRESETS.length; i += 1) {
      assert.ok(RATE_PRESETS[i] > RATE_PRESETS[i - 1], `预设第 ${i} 项应大于前一项`);
    }
  });

  test('每一项都落在允许范围内', () => {
    for (const r of RATE_PRESETS) {
      assert.ok(r >= MIN_RATE && r <= MAX_RATE, `预设 ${r} 越界`);
    }
  });

  test('包含 1 倍速，且首尾是常用极限值', () => {
    assert.ok(RATE_PRESETS.includes(1));
    assert.equal(RATE_PRESETS[0], 0.5);
    assert.equal(RATE_PRESETS[RATE_PRESETS.length - 1], 3);
  });

  test('常量本身正确', () => {
    assert.equal(MIN_RATE, 0.1);
    assert.equal(MAX_RATE, 3);
  });
});
