import type { IncomingMessage } from 'node:http';

export const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;
export const DEFAULT_BODY_TIMEOUT_MS = 10_000;

export interface JsonBodyOptions {
  maxBodySize?: number;
  timeoutMs?: number;
}

function validateLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
}

function hasJsonContentType(req: IncomingMessage): boolean {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string') return false;
  const mimeType = contentType.split(';')[0]?.trim().toLowerCase();
  return mimeType === 'application/json' || mimeType?.endsWith('+json') === true;
}

export async function readJsonBody(
  req: IncomingMessage,
  options: JsonBodyOptions = {},
): Promise<unknown> {
  const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_BODY_TIMEOUT_MS;
  validateLimit('maxBodySize', maxBodySize);
  validateLimit('timeoutMs', timeoutMs);

  if (!hasJsonContentType(req)) throw new Error('Content-Type 必须是 application/json');

  const contentLengthHeader = req.headers['content-length'];
  if (contentLengthHeader !== undefined) {
    if (!/^\d+$/.test(contentLengthHeader)) throw new Error('Content-Length 格式非法');
    const contentLength = Number(contentLengthHeader);
    if (contentLength > maxBodySize) throw new Error(`请求体超过 ${maxBodySize} 字节限制`);
  }

  const chunks: Buffer[] = [];
  let size = 0;
  const readBody = async (): Promise<unknown> => {
    for await (const chunk of req) {
      const value = chunk as Buffer;
      size += value.length;
      if (size > maxBodySize) throw new Error(`请求体超过 ${maxBodySize} 字节限制`);
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) return {};
    return JSON.parse(text);
  };

  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      req.destroy(new Error('Request body timed out'));
      reject(new Error(`请求体超过 ${timeoutMs}ms 未完成`));
    }, timeoutMs);
  });

  const readPromise = readBody();
  // The losing side of the race can still reject after the socket is destroyed.
  void readPromise.catch(() => undefined);

  try {
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
