import { existsSync, readFileSync } from 'node:fs';

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseValue(rawValue: string): string {
  const value = rawValue.trim();
  const quote = value[0];
  if (quote !== '"' && quote !== "'") {
    const commentIndex = value.indexOf(' #');
    return commentIndex >= 0 ? value.slice(0, commentIndex).trim() : value;
  }
  const closingQuote = value.indexOf(quote, 1);
  if (closingQuote === -1) throw new Error('NEXUS_DEMO .env 引号不完整');
  return value.slice(1, closingQuote);
}

/** Load repository-local development env without replacing deployment-provided values. */
export function loadDemoProjectEnv(): void {
  if (process.env.NODE_ENV === 'test') return;

  const envUrl = new URL('../../../.env', import.meta.url);
  if (!existsSync(envUrl)) return;

  for (const [index, rawLine] of readFileSync(envUrl, 'utf8')
    .split(/\r\n|\n|\r/)
    .entries()) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    if (separator <= 0 || !ENV_KEY_PATTERN.test(key)) {
      throw new Error(`NEXUS_DEMO .env 第 ${index + 1} 行格式非法`);
    }
    if (process.env[key] === undefined) process.env[key] = parseValue(line.slice(separator + 1));
  }
}
