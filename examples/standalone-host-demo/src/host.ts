import type Koa from 'koa';
import { createStandaloneHostApp } from './host/app';

export interface DemoHostOptions {
  endpoint: string;
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
