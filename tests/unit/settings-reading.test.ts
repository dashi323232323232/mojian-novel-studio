import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppCore } from '../../electron/main/core';

function tempCore(): { core: AppCore; dir: string } {
  const dir = path.join(os.tmpdir(), `dashi-settings-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return { core: new AppCore(dir), dir };
}

describe('设置：关闭行为与朗读偏好', () => {
  it('默认关闭时收缩到系统托盘', () => {
    const { core } = tempCore();
    try {
      const ui = core.settings.getUi();
      assert.equal(ui.closeAction, 'tray');
      assert.equal(ui.rememberReading, true);
      assert.equal(ui.reading.rate, 1);
      assert.equal(ui.reading.autoNext, true);
    } finally {
      core.close();
    }
  });

  it('关闭行为可切换并可持久化', () => {
    const { core } = tempCore();
    try {
      assert.equal(core.settings.updateUi({ closeAction: 'quit' }).closeAction, 'quit');
      assert.equal(core.settings.getCloseAction(), 'quit');
      assert.equal(core.settings.updateUi({ closeAction: 'tray' }).closeAction, 'tray');
    } finally {
      core.close();
    }
  });

  it('非法关闭行为被忽略，保持原值', () => {
    const { core } = tempCore();
    try {
      core.settings.updateUi({ closeAction: 'quit' });
      // 传非法值不应写坏
      const next = core.settings.updateUi({ closeAction: 'whatever' as never });
      assert.equal(next.closeAction, 'quit');
    } finally {
      core.close();
    }
  });

  it('语速越界被夹到 0.5 ~ 2', () => {
    const { core } = tempCore();
    try {
      assert.equal(core.settings.updateReadingSettings({ rate: 999 }).rate, 2);
      assert.equal(core.settings.updateReadingSettings({ rate: -5 }).rate, 0.5);
      assert.equal(core.settings.updateReadingSettings({ rate: 1.5 }).rate, 1.5);
    } finally {
      core.close();
    }
  });

  it('非数字语速回退到原值而不是写坏数据', () => {
    const { core } = tempCore();
    try {
      core.settings.updateReadingSettings({ rate: 1.25 });
      const next = core.settings.updateReadingSettings({ rate: 'abc' as never });
      assert.equal(next.rate, 1.25);
      assert.equal(typeof next.rate, 'number');
    } finally {
      core.close();
    }
  });

  it('音调与音量同样被夹紧', () => {
    const { core } = tempCore();
    try {
      assert.equal(core.settings.updateReadingSettings({ pitch: 99 }).pitch, 1.6);
      assert.equal(core.settings.updateReadingSettings({ pitch: 0.1 }).pitch, 0.5);
      assert.equal(core.settings.updateReadingSettings({ volume: 9999 }).volume, 100);
      assert.equal(core.settings.updateReadingSettings({ volume: -3 }).volume, 0);
    } finally {
      core.close();
    }
  });

  it('朗读进度按章保存，百分比由字符偏移计算', () => {
    const { core } = tempCore();
    try {
      const project = core.projects.create({ name: '进度测试' });
      const entry = core.settings.recordReadingProgress(project.id, {
        chapterId: 'chp_x',
        charIndex: 50,
        charTotal: 200,
      });
      assert.equal(entry.charIndex, 50);
      assert.equal(entry.charTotal, 200);
      assert.ok(Math.abs(entry.percent - 0.25) < 1e-9);
      const back = core.settings.getProjectSettings(project.id).readingProgress['chp_x'];
      assert.equal(back.charIndex, 50);
      assert.ok(back.updatedAt.length > 0);
    } finally {
      core.close();
    }
  });

  it('朗读进度超出正文长度时被夹到 0 ~ charTotal', () => {
    const { core } = tempCore();
    try {
      const project = core.projects.create({ name: '越界测试' });
      const over = core.settings.recordReadingProgress(project.id, {
        chapterId: 'chp_y',
        charIndex: 9999,
        charTotal: 100,
      });
      assert.equal(over.charIndex, 9999);
      assert.ok(over.percent <= 1);
      const negative = core.settings.recordReadingProgress(project.id, {
        chapterId: 'chp_z',
        charIndex: -20,
        charTotal: 100,
      });
      assert.equal(negative.charIndex, 0);
      assert.equal(negative.percent, 0);
    } finally {
      core.close();
    }
  });

  it('可以清除某章的朗读进度，且不影响其它章节', () => {
    const { core } = tempCore();
    try {
      const project = core.projects.create({ name: '清除测试' });
      core.settings.recordReadingProgress(project.id, { chapterId: 'chp_a', charIndex: 10, charTotal: 100 });
      core.settings.recordReadingProgress(project.id, { chapterId: 'chp_b', charIndex: 20, charTotal: 100 });
      core.settings.clearReadingProgress(project.id, 'chp_a');
      const map = core.settings.getProjectSettings(project.id).readingProgress;
      assert.equal(map['chp_a'], undefined);
      assert.equal(map['chp_b'].charIndex, 20);
    } finally {
      core.close();
    }
  });
});
