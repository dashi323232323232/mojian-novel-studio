/**
 * 把 OpenAPI 定义与 Agent 文档写入仓库，方便外部工具直接读取机器接口定义。
 * 用法： npm run openapi
 */
import fs from 'node:fs';
import path from 'node:path';
import { AppCore } from '../electron/main/core';
import { buildOpenApiSpec } from '../electron/main/api/openapi';
import { buildAgentGuide } from '../electron/main/api/agentGuide';

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs');
fs.mkdirSync(outDir, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mojian-docgen-'));
const core = new AppCore(dataDir);
try {
  const spec = buildOpenApiSpec('http://127.0.0.1:45871');
  fs.writeFileSync(path.join(outDir, 'openapi.json'), JSON.stringify(spec, null, 2), 'utf8');
  const guide = buildAgentGuide({
    core,
    baseUrl: 'http://127.0.0.1:45871',
    token: '<从软件 Agent 接入页复制>',
    endpointFilePath: '%APPDATA%\\墨笺小说工作台\\api-endpoint.json',
    dataDir: '%APPDATA%\\墨笺小说工作台',
  });
  fs.writeFileSync(path.join(outDir, 'AGENT_GUIDE.md'), guide, 'utf8');
  console.log('已生成 docs/openapi.json 与 docs/AGENT_GUIDE.md');
} finally {
  core.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
