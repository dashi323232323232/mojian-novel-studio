import { _electron as electron } from 'playwright-core';
import path from 'node:path';
const env = { ...process.env, MOJIAN_DATA_DIR: 'E:/小说编辑器/tmp-debug-node' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.resolve('.')], env, timeout: 60000 });
const win = await app.firstWindow();
await win.waitForSelector('.sidebar');
await win.waitForTimeout(1200);
// 新建项目
await win.click('.sidebar .btn-primary');
await win.waitForSelector('.modal input.input');
await win.fill('.modal input.input', '调试项目');
await win.click('.modal-foot .btn-primary');
await win.waitForTimeout(700);
await win.click('.nav-child:has-text("大纲")');
await win.waitForTimeout(800);
await win.click('.palette-item:has-text("剧情事件")');
await win.waitForTimeout(1000);
const info = await win.evaluate(() => {
  const node = document.querySelector('.react-flow__node');
  const card = document.querySelector('.node-card');
  const viewport = document.querySelector('.react-flow__viewport');
  const r = node?.getBoundingClientRect();
  const c = card?.getBoundingClientRect();
  return {
    nodeRect: r && { x: r.x, y: r.y, w: r.width, h: r.height },
    cardRect: c && { x: c.x, y: c.y, w: c.width, h: c.height },
    transform: viewport ? getComputedStyle(viewport).transform : null,
    style: node?.getAttribute('style'),
    cardFont: card ? getComputedStyle(card).fontSize : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await win.screenshot({ path: 'tests/e2e/shots/debug-node.png' });
await app.close();
