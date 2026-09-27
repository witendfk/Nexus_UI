import type { PublishedCatalogsPayload } from './routes';
import { SERVER_API_VERSION } from '../version';

export interface PublishedCatalogsClientOptions {
  /** Absolute discovery URL served by a Nexus host. */
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  fetch?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertHttpUrl(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${url} (${reason})`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid ${label}: ${url} (protocol must be http or https)`);
  }
}

function assertPositiveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} 必须是正数`);
  }
}

function isJsonContentType(contentType: string | null): boolean {
  return /^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(contentType ?? '');
}

async function readErrorResponse(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '';
  }
}

function validatePublishedCatalogs(value: unknown, url: string): PublishedCatalogsPayload {
  if (!isRecord(value) || value.serverApiVersion !== SERVER_API_VERSION) {
    throw new Error(`Published catalog discovery serverApiVersion 无效: ${url}`);
  }
  if (value.kind !== 'published-catalog-list') {
    throw new Error(`Published catalog discovery kind 无效: ${url}`);
  }
  const catalogs = value.catalogs;
  if (!Array.isArray(catalogs)) {
    throw new Error(`Published catalog discovery catalogs 必须是数组: ${url}`);
  }

  for (const catalog of catalogs) {
    if (
      !isRecord(catalog) ||
      typeof catalog.catalogId !== 'string' ||
      catalog.catalogId === '' ||
      !Array.isArray(catalog.components) ||
      typeof catalog.catalogContractUrl !== 'string' ||
      catalog.catalogContractUrl === '' ||
      typeof catalog.agentOnboardingUrl !== 'string' ||
      catalog.agentOnboardingUrl === ''
    ) {
      throw new Error(`Published catalog discovery 包含无效 catalog: ${url}`);
    }
    if (catalog.actions !== undefined && !Array.isArray(catalog.actions)) {
      throw new Error(`Published catalog discovery 包含无效 actions: ${url}`);
    }
  }

  return value as unknown as PublishedCatalogsPayload;
}

/**
 * Fetch and validate a host-published catalog discovery payload.
 * This client does not authorize an Agent, expose credentials, or start a listener.
 */
export async function fetchPublishedCatalogs(
  options: PublishedCatalogsClientOptions,
): Promise<PublishedCatalogsPayload> {
  assertHttpUrl(options.url, 'published catalog discovery URL');
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 1_000_000;
  assertPositiveNumber('timeoutMs', timeoutMs);
  assertPositiveNumber('maxBytes', maxBytes);

  const fetchImpl = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(options.url, {
      method: 'GET',
      headers: { ...options.headers, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Published catalog discovery 请求失败 (${response.status}): ${await readErrorResponse(response)}`,
      );
    }
    if (!isJsonContentType(response.headers.get('content-type'))) {
      throw new Error('Published catalog discovery 必须返回 JSON');
    }

    const body = await response.arrayBuffer();
    if (body.byteLength > maxBytes) {
      throw new Error(`Published catalog discovery 超过 ${maxBytes} 字节上限`);
    }
    return validatePublishedCatalogs(
      JSON.parse(new TextDecoder().decode(body)) as unknown,
      options.url,
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Published catalog discovery 请求超过 ${timeoutMs}ms 未完成`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
