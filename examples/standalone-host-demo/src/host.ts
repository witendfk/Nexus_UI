import type Koa from 'koa';
import { createStandaloneHostApp } from './host/app';
import type { StandaloneHostActionMode } from './shared/action-mode';

export interface DemoHostOptions {
  endpoint: string;
  actionMode?: StandaloneHostActionMode;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRequestBodyBytes?: number;
  requestBodyTimeoutMs?: number;
}

/** Assemble the standalone host API around the demo external Agent. */
export function createDemoHostApp(options: DemoHostOptions): Koa {
  return createStandaloneHostApp(options);
}
