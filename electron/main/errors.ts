/**
 * 统一错误类型：主进程、IPC 与 HTTP API 共用。
 */
export class NovelError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'NovelError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export function validationError(message: string, details?: unknown): NovelError {
  return new NovelError('VALIDATION_ERROR', message, 400, details);
}

export function notFound(message: string, details?: unknown): NovelError {
  return new NovelError('NOT_FOUND', message, 404, details);
}

export function conflict(message: string, details?: unknown): NovelError {
  return new NovelError('CONFLICT', message, 409, details);
}

export function forbidden(message: string, details?: unknown): NovelError {
  return new NovelError('FORBIDDEN', message, 403, details);
}

export function unauthorized(message = '缺少或错误的访问令牌'): NovelError {
  return new NovelError('UNAUTHORIZED', message, 401);
}

export function confirmationRequired(message: string, details?: unknown): NovelError {
  return new NovelError('CONFIRMATION_REQUIRED', message, 409, details);
}

export function unsupported(message: string): NovelError {
  return new NovelError('UNSUPPORTED', message, 501);
}

export function internalError(message: string, details?: unknown): NovelError {
  return new NovelError('INTERNAL_ERROR', message, 500, details);
}

export function toNovelError(err: unknown): NovelError {
  if (err instanceof NovelError) return err;
  if (err instanceof Error) {
    return new NovelError('INTERNAL_ERROR', err.message || '未知错误', 500);
  }
  return new NovelError('INTERNAL_ERROR', String(err ?? '未知错误'), 500);
}

export function errorPayload(err: unknown): {
  error: { code: string; message: string; details?: unknown };
} {
  const e = toNovelError(err);
  return {
    error: {
      code: e.code,
      message: e.message,
      ...(e.details !== undefined ? { details: e.details } : {}),
    },
  };
}
