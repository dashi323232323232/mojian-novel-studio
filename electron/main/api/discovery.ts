import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AppCore } from '../core';
import type { ApiServerStatus } from '@shared/types';
import { APP_VERSION, API_VERSION, DEFAULT_API_PORT } from '@shared/constants';

const HOST = '127.0.0.1';

interface EndpointFile {
  app: string;
  appVersion: string;
  apiVersion: string;
  baseUrl: string;
  host: string;
  port: number;
  auth: { type: 'bearer'; header: string; note: string };
  docs: string;
  openapi: string;
  pid: number;
  updatedAt: string;
}

/**
 * 服务发现文件：端口可能因占用而变化，Agent 始终从该文件读取当前地址。
 * 文件位于用户数据目录，默认不含令牌；令牌由用户在「Agent 接入」页复制。
 */
export class EndpointFileService {
  constructor(
    private dataDir: string,
    private getPort: () => number,
  ) {}

  get filePath(): string {
    return path.join(this.dataDir, 'api-endpoint.json');
  }

  write(port: number): EndpointFile {
    const baseUrl = `http://${HOST}:${port}`;
    const payload: EndpointFile = {
      app: '墨笺小说工作台',
      appVersion: APP_VERSION,
      apiVersion: API_VERSION,
      baseUrl,
      host: HOST,
      port,
      auth: {
        type: 'bearer',
        header: 'Authorization: Bearer <token>',
        note: '令牌请在软件「Agent 接入」页面查看或重新生成；本文件不包含令牌。',
      },
      docs: `${baseUrl}/api/v1/agent-guide`,
      openapi: `${baseUrl}/api/v1/openapi.json`,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }

  read(): EndpointFile | null {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as EndpointFile;
    } catch {
      return null;
    }
  }

  remove(): void {
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      /* ignore */
    }
  }

  updatePort(port: number): void {
    this.write(port);
  }
}

export function ensureToken(core: AppCore): string {
  let token = core.settings.getApiToken();
  if (!token) {
    token = 'mj_' + randomBytes(24).toString('hex');
    core.settings.setApiToken(token);
  }
  return token;
}

export function maskToken(token: string): string {
  if (!token) return '未设置';
  if (token.length <= 12) return token.slice(0, 4) + '****';
  return `${token.slice(0, 6)}••••••${token.slice(-4)}`;
}

export function buildStatus(input: {
  running: boolean;
  port: number;
  token: string;
  endpointFilePath: string;
  startedAt: string | null;
  requestCount: number;
  lastRequestAt: string | null;
  error: string | null;
  authRequired: boolean;
}): ApiServerStatus {
  return {
    running: input.running,
    host: HOST,
    port: input.port,
    baseUrl: `http://${HOST}:${input.port}`,
    apiVersion: API_VERSION,
    appVersion: APP_VERSION,
    authRequired: input.authRequired,
    tokenMasked: maskToken(input.token),
    endpointFilePath: input.endpointFilePath,
    startedAt: input.startedAt,
    requestCount: input.requestCount,
    lastRequestAt: input.lastRequestAt,
    error: input.error,
  };
}

export const API_HOST = HOST;
export const API_DEFAULT_PORT = DEFAULT_API_PORT;
