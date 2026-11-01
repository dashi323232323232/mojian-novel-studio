import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSegments, findSegmentIndex, estimateMs, formatClock, sortVoices } from '../../src/lib/reading';

/** 把片段拼起来再抹掉空白，用于和原文同样处理后的结果比较。 */
const strip = (s: string): string => s.replace(/\s+/g, '');

/** 90 字硬切上限：源码里 MAX_SEGMENT_CHARS * 1.5。 */
const HARD_LIMIT = 90 * 1.5;

describe('朗读引擎：断句 buildSegments', () => {
  test('中文句号能断句', () => {
    const segs = buildSegments('第一句。第二句。');
    assert.equal(segs.length, 2);
    assert.deepEqual(segs.map((s) => s.text), ['第一句。', '第二句。']);
    assert.deepEqual(segs.map((s) => [s.start, s.end]), [[0, 4], [4, 8]]);
  });

  test('感叹号与问号都能断句', () => {
    assert.equal(buildSegments('停！走。').length, 2);
    assert.equal(buildSegments('真的？假的。').length, 2);
    const segs = buildSegments('真的？假的。');
    assert.deepEqual(segs.map((s) => s.text), ['真的？', '假的。']);
  });

  test('省略号能断句，连续省略号不被切碎', () => {
    const segs = buildSegments('等等……然后呢？');
    assert.equal(segs.length, 2);
    // 第一个“…”断句，紧跟的第二个“…”属于收尾符号，归入前一句
    assert.deepEqual(segs.map((s) => s.text), ['等等……', '然后呢？']);
  });

  test('分号能断句', () => {
    const segs = buildSegments('第一句；第二句；第三句。');
    assert.equal(segs.length, 3);
    assert.deepEqual(segs.map((s) => s.text), ['第一句；', '第二句；', '第三句。']);
  });

  test('换行能断句，且空白行不产生空片段', () => {
    const segs = buildSegments('第一行\n第二行\n\n第三行');
    assert.equal(segs.length, 3);
    assert.deepEqual(segs.map((s) => s.text), ['第一行\n', '第二行\n', '第三行']);
  });

  test('断句后紧跟的右引号归入前一句', () => {
    // 关键回归：右引号不能被切成下一句的开头
    const segs = buildSegments('他说：“走吧。”然后他走了。');
    assert.equal(segs.length, 2);
    assert.equal(segs[0].text, '他说：“走吧。”');
    assert.equal(segs[1].text, '然后他走了。');
    assert.ok(segs[0].text.endsWith('。”'), '右引号应留在本句末尾');

    const corner = buildSegments('「他说：“走吧。”」');
    assert.equal(corner.length, 1);
    assert.equal(corner[0].text, '「他说：“走吧。”」');

    const ascii = buildSegments('He said "go."');
    assert.equal(ascii.length, 1, '英文右引号同样应归入前一句');
  });

  test('断句后紧跟的右括号归入前一句', () => {
    const paren = buildSegments('（他走了。）');
    assert.equal(paren.length, 1);
    assert.equal(paren[0].text, '（他走了。）');

    const bracket = buildSegments('【他走了。】');
    assert.equal(bracket.length, 1);
    assert.equal(bracket[0].text, '【他走了。】');
  });

  test('每个片段的 text 严格等于原文 slice(start, end)', () => {
    const raw = '第一句。他说：“走吧。”\n（补一句）\n\n最后一句！';
    for (const seg of buildSegments(raw)) {
      assert.equal(seg.text, raw.slice(seg.start, seg.end), `片段 [${seg.start}, ${seg.end}) 与原文不一致`);
      assert.ok(seg.end > seg.start);
      assert.ok(seg.text.trim().length > 0, '不应产出纯空白片段');
    }
  });

  test('片段首尾相接、完整覆盖非空白内容', () => {
    const raw = '第一句。他说：“走吧。”\n（补一句）\n\n最后一句！';
    const segs = buildSegments(raw);
    assert.ok(segs.length > 0);

    // 片段之间不重叠、顺序单调递增；被跳过的只有纯空白
    for (let i = 1; i < segs.length; i += 1) {
      assert.ok(segs[i].start >= segs[i - 1].end, '片段不应重叠');
      const gap = raw.slice(segs[i - 1].end, segs[i].start);
      assert.equal(gap.trim(), '', `片段之间只允许出现空白，实际为 ${JSON.stringify(gap)}`);
    }
    assert.equal(strip(segs.map((s) => s.text).join('')), strip(raw), '拼起来去空白后应等于原文去空白');
  });

  test('超过 90 字的超长句会被切开', () => {
    const raw = ('甲'.repeat(89) + '，').repeat(2) + '。';
    const segs = buildSegments(raw);
    assert.ok(segs.length > 1, '超长句必须被切开');
    assert.ok(segs.length >= 2);
    for (const seg of segs) {
      assert.ok(seg.text.length <= HARD_LIMIT, `单段 ${seg.text.length} 字，超过上限 ${HARD_LIMIT}`);
      assert.equal(seg.text, raw.slice(seg.start, seg.end));
    }
    assert.equal(strip(segs.map((s) => s.text).join('')), strip(raw), '切分后内容不能丢失');
  });

  test('无逗号的超长句硬切后，每段长度不超过 90*1.5（135 字）', () => {
    const raw = '甲'.repeat(300) + '。';
    const segs = buildSegments(raw);
    assert.ok(segs.length > 1, '超长句必须被切开');
    for (const seg of segs) {
      assert.ok(seg.text.length <= HARD_LIMIT, `单段 ${seg.text.length} 字，超过上限 ${HARD_LIMIT}`);
      assert.equal(seg.text, raw.slice(seg.start, seg.end), '切片必须与原文一致');
    }
    assert.equal(strip(segs.map((s) => s.text).join('')), strip(raw), '硬切后内容不能丢失');
  });

  test('纯空白与空字符串返回空数组', () => {
    assert.deepEqual(buildSegments(''), []);
    assert.deepEqual(buildSegments('   '), []);
    assert.deepEqual(buildSegments('\n\n  \n'), []);
  });
});

describe('朗读引擎：定位 findSegmentIndex', () => {
  // 「第一句。」[0,4) 「第二句。」[4,8) 「第三句。」[8,12)
  const segs = buildSegments('第一句。第二句。第三句。');

  test('命中第一句', () => {
    assert.equal(findSegmentIndex(segs, 0), 0);
    assert.equal(findSegmentIndex(segs, 2), 0);
  });

  test('命中中间句', () => {
    assert.equal(findSegmentIndex(segs, 5), 1);
  });

  test('命中最后一句', () => {
    assert.equal(findSegmentIndex(segs, 11), 2);
  });

  test('charIndex 正好等于某句 end 时落到下一句', () => {
    assert.equal(findSegmentIndex(segs, 4), 1, '4 是第一句的 end，应落到第二句');
    assert.equal(findSegmentIndex(segs, 8), 2, '8 是第二句的 end，应落到第三句');
  });

  test('落在句间空白时归到下一句', () => {
    const withGap = buildSegments('第一句。\n\n第二句。');
    assert.deepEqual(withGap.map((s) => [s.start, s.end]), [[0, 4], [6, 10]]);
    assert.equal(findSegmentIndex(withGap, 4), 1, '第一句 end 之后即空白，应归到下一句');
    assert.equal(findSegmentIndex(withGap, 5), 1, '空白中间应归到下一句');
  });

  test('负数偏移归到第一句，超出长度归到最后一句', () => {
    assert.equal(findSegmentIndex(segs, -1), 0);
    assert.equal(findSegmentIndex(segs, -1000), 0);
    assert.equal(findSegmentIndex(segs, 12), 2);
    assert.equal(findSegmentIndex(segs, 9999), 2);
  });

  test('空数组返回 -1', () => {
    assert.equal(findSegmentIndex([], 0), -1);
    assert.equal(findSegmentIndex([], 100), -1);
  });
});

describe('朗读引擎：时长估算 estimateMs', () => {
  test('1 倍速下 460 字约等于 100 秒（允许 ±5%）', () => {
    const ms = estimateMs(460, 1);
    assert.ok(Math.abs(ms - 100000) <= 100000 * 0.05, `实际 ${ms}ms，期望 100000ms ±5%`);
  });

  test('2 倍速下耗时约为 1 倍速的一半', () => {
    const once = estimateMs(460, 1);
    const twice = estimateMs(460, 2);
    assert.ok(Math.abs(twice - once / 2) <= once / 2 * 0.05, `实际 ${twice}ms，期望约 ${once / 2}ms`);
  });

  test('语速为 0 或负数时不除零，返回有限值', () => {
    for (const rate of [0, -1, -4.6]) {
      const ms = estimateMs(460, rate);
      assert.ok(Number.isFinite(ms), `rate=${rate} 时结果必须有限，实际 ${ms}`);
      assert.ok(ms >= 0);
    }
    // 非法语速按 1 倍速兜底
    assert.equal(estimateMs(460, 0), estimateMs(460, 1));
  });
});

describe('朗读引擎：时间格式化 formatClock', () => {
  test('0 毫秒显示 0:00', () => {
    assert.equal(formatClock(0), '0:00');
  });

  test('59000 毫秒显示 0:59', () => {
    assert.equal(formatClock(59000), '0:59');
  });

  test('61000 毫秒显示 1:01', () => {
    assert.equal(formatClock(61000), '1:01');
  });

  test('3725000 毫秒显示 1:02:05', () => {
    assert.equal(formatClock(3725000), '1:02:05');
  });
});

describe('朗读引擎：声音排序 sortVoices', () => {
  const voices = [
    { id: 'en-default', name: 'English Default', lang: 'en-US', local: true, default: true },
    { id: 'zh-plain', name: '中文普通', lang: 'zh-CN', local: false, default: false },
    { id: 'zh-default', name: '中文默认', lang: 'zh-CN', local: true, default: true },
  ];

  test('中文语音排在英文之前', () => {
    const sorted = sortVoices(voices);
    const firstEn = sorted.findIndex((v) => /^en/i.test(v.lang));
    const lastZh = sorted.map((v) => v.lang).lastIndexOf('zh-CN');
    assert.ok(lastZh < firstEn, `中文应全部排在英文前，实际顺序 ${sorted.map((v) => v.id).join(' > ')}`);
  });

  test('同语言里系统默认语音靠前', () => {
    const sorted = sortVoices(voices);
    const zh = sorted.filter((v) => v.lang.startsWith('zh'));
    assert.equal(zh[0].id, 'zh-default', '默认中文语音应排在非默认中文语音之前');
  });

  test('排序不修改传入数组', () => {
    const snapshot = voices.map((v) => v.id);
    sortVoices(voices);
    assert.deepEqual(voices.map((v) => v.id), snapshot);
  });
});
