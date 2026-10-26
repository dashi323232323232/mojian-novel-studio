import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { AppCore } from '../core';
import type { ApiServerStatus } from '@shared/types';
import { API_HOST, API_DEFAULT_PORT, EndpointFileService, buildStatus } from './discovery';
import { ApiRouter } from './router';
import { errorPayload, toNovelError, NovelError } from '../errors';
import { API_VERSION } from '@shared/constants';

const MAX_BODY_BYTES = 40 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface ApiServerOptions {
  core: AppCore;
  endpoint: EndpointFileService;
  token: string;
  onLog?: (entry: { method: string; path: string; status: number; durationMs: number; summary: string }) => void;
}

export class ApiServer {
  private server: http.Server | null = null;
  private router: ApiRouter;
  private port = API_DEFAULT_PORT;
  private startedAt: string | null = null;
  private requestCount = 0;
  private lastRequestAt: string | null = null;
  private error: string | null = null;
  private running = false;
  private inFlight = 0;

  constructor(private opts: ApiServerOptions) {
    this.router = new ApiRouter(opts.core);
  }

  get status(): ApiServerStatus {
    return buildStatus({
      running: this.running,
      port: this.port,
      token: this.opts.token,
      endpointFilePath: this.opts.endpoint.filePath,
      startedAt: this.startedAt,
      requestCount: this.requestCount,
      lastRequestAt: this.lastRequestAt,
      error: this.error,
      authRequired: true,
    });
  }

  setToken(token: string): void {
    this.opts.token = token;
  }

  getToken(): string {
    return this.opts.token;
  }

  getBaseUrl(): string {
    return `http://${API_HOST}:${this.port}`;
  }

  getRouter(): ApiRouter {
    return this.router;
  }

  async start(preferredPort = API_DEFAULT_PORT): Promise<ApiServerStatus> {
    if (this.running) return this.status;
    const ports = [preferredPort, preferredPort + 1, preferredPort + 2, 0];
    let lastErr: unknown = null;
    for (const p of ports) {
      try {
        await this.listen(p);
        this.running = true;
        this.error = null;
        this.startedAt = new Date().toISOString();
        this.port = (this.server!.address() as { port: number }).port;
        this.opts.endpoint.write(this.port);
        return this.status;
      } catch (err) {
        lastErr = err;
      }
    }
    this.running = false;
    this.error = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new NovelError('INTERNAL_ERROR', `本地 API 启动失败：${this.error}`, 500);
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.onRequest(req, res);
      });
      server.keepAliveTimeout = 5000;
      server.headersTimeout = 10000;
      server.requestTimeout = 240000;
      server.on('error', (err) => {
        server.close();
        reject(err);
      });
      server.listen(port, API_HOST, () => {
        this.server = server;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.running = false;
      return;
    }
    const server = this.server;
    this.server = null;
    this.running = false;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(() => resolve(), 3000);
    });
    this.opts.endpoint.remove();
  }

  private setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers.origin;
    // 只允许同源 / 本地 Electron 渲染进程；不返回通配符，防止浏览器跨站调用。
    if (origin && (origin.startsWith('http://127.0.0.1:') || origin.startsWith('http://localhost:'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Mojian-Actor, X-Request-Id');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
  }

  private checkAuth(req: http.IncomingMessage, method: string, pathname: string): { ok: boolean; actor: string } {
    const info = this.router.getRouteInfo(method, pathname);
    if (info && !info.auth) return { ok: true, actor: 'public' };
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const provided = match?.[1]?.trim() ?? '';
    const expected = this.opts.token;
    let ok = false;
    if (provided && expected && provided.length === expected.length) {
      try {
        ok = timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
      } catch {
        ok = false;
      }
    }
    const actor = req.headers['x-mojian-actor'];
    return { ok, actor: typeof actor === 'string' && actor.trim() ? actor.trim().slice(0, 60) : 'agent' };
  }

  private validateHostAndOrigin(req: http.IncomingMessage): { ok: boolean; reason?: string } {
    const host = (req.headers.host ?? '').split(':')[0];
    if (host && !ALLOWED_HOSTS.has(host) && !ALLOWED_HOSTS.has(host.toLowerCase())) {
      return { ok: false, reason: '仅允许通过本机地址访问' };
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        const url = new URL(origin);
        if (!ALLOWED_HOSTS.has(url.hostname)) {
          return { ok: false, reason: '拒绝跨站请求：来源不被允许' };
        }
      } catch {
        return { ok: false, reason: '拒绝跨站请求：Origin 无效' };
      }
    }
    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string' && site === 'cross-site') {
      return { ok: false, reason: '拒绝跨站请求：Sec-Fetch-Site 为 cross-site' };
    }
    return { ok: true };
  }

  private async readBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
          reject(new NovelError('VALIDATION_ERROR', '请求体超过 40MB 上限', 413));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const start = Date.now();
    this.requestCount++;
    this.lastRequestAt = new Date().toISOString();
    this.inFlight++;
    this.setCorsHeaders(req, res);
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? API_HOST}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();
    let status = 200;
    let summary = '';
    let actor = 'agent';

    try {
      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const gate = this.validateHostAndOrigin(req);
      if (!gate.ok) {
        status = 403;
        this.sendJson(res, status, {
          error: { code: 'FORBIDDEN', message: gate.reason ?? '请求被拒绝' },
        });
        return;
      }
      const info = this.router.getRouteInfo(method, pathname);
      if (!info) {
        status = 404;
        this.sendJson(res, 404, {
          error: { code: 'NOT_FOUND', message: `接口不存在：${method} ${pathname}` },
        });
        return;
      }
      const auth = this.checkAuth(req, method, pathname);
      actor = auth.actor;
      if (!auth.ok) {
        status = 401;
        this.sendJson(res, 401, {
          error: {
            code: 'UNAUTHORIZED',
            message: '缺少或错误的访问令牌。请在请求头携带 Authorization: Bearer <token>，令牌见软件「Agent 接入」页面。',
          },
        });
        return;
      }
      if (info.destructive && !this.opts.core.settings.getApiSettings().allowDestructive) {
        status = 403;
        this.sendJson(res, 403, {
          error: {
            code: 'FORBIDDEN',
            message: '高危操作未启用：请由用户在「Agent 接入」页面开启「允许 API 执行高危操作」。',
          },
        });
        return;
      }
      let body: unknown = undefined;
      let rawBody: Buffer = Buffer.alloc(0);
      if (method !== 'GET' && method !== 'HEAD') {
        rawBody = await this.readBody(req);
        if (rawBody.length) {
          const contentType = String(req.headers['content-type'] ?? '');
          if (contentType.includes('application/json') || rawBody[0] === 0x7b || rawBody[0] === 0x5b) {
            try {
              body = JSON.parse(rawBody.toString('utf8'));
            } catch {
              throw new NovelError('VALIDATION_ERROR', '请求体不是合法的 JSON', 400);
            }
          } else {
            throw new NovelError('VALIDATION_ERROR', '请求体必须是 application/json', 415);
          }
        }
      }
      const result = await this.router.handle({
        req,
        res,
        method,
        pathname,
        query: url.searchParams,
        body,
        rawBody,
        ip: req.socket.remoteAddress ?? '',
        actor,
        core: this.opts.core,
        baseUrl: this.getBaseUrl(),
        token: this.opts.token,
        startTime: start,
      });
      status = result.status;
      summary = result.summary;
      const payload = result.payload;
      if (typeof payload === 'string') {
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        res.end(payload);
      } else {
        this.sendJson(res, 200, payload);
      }
    } catch (err) {
      const e = toNovelError(err);
      status = e.status >= 400 ? e.status : 500;
      if (status >= 500) console.error('[api] 处理失败', pathname, err);
      this.sendJson(res, status, errorPayload(e));
    } finally {
      this.inFlight--;
      const duration = Date.now() - start;
      try {
        this.opts.core.settings.recordApiRequest({
          method,
          path: pathname,
          status,
          durationMs: duration,
          actor,
          ip: req.socket.remoteAddress ?? '',
          summary,
        });
        this.opts.core.settings.trimApiLogs(500);
        this.opts.onLog?.({ method, path: pathname, status, durationMs: duration, summary });
      } catch {
        /* 日志失败不影响响应 */
      }
    }
  }

  private sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  async close(): Promise<void> {
    await this.stop();
  }

  get version(): string {
    return API_VERSION;
  }
}
