import { existsSync, readFileSync } from 'node:fs';

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function unquote(value: string): string {
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return value;
  const closingQuote = value.indexOf(quote, 1);
  if (closingQuote === -1) throw new Error('环境变量值引号不完整');
  return value.slice(1, closingQuote);
}

function parseValue(rawValue: string): string {
  let value = rawValue.trim();
  if (!value.startsWith('"') && !value.startsWith("'")) {
    const commentIndex = value.indexOf(' #');
    if (commentIndex >= 0) value = value.slice(0, commentIndex).trim();
  }
  return unquote(value);
}

/** Apply a dotenv-style source without replacing values already provided by the runtime. */
export function applyEnvSource(
  source: string,
  target: Record<string, string | undefined> = process.env,
): string[] {
  const loadedKeys: string[] = [];
  const lines = source.split(/\r\n|\n|\r/);

  for (const [index, rawLine] of lines.entries()) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error(`环境变量文件第 ${index + 1} 行格式非法`);

    const key = line.slice(0, separator).trim();
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`环境变量文件第 ${index + 1} 行 key 非法`);
    }
    const value = parseValue(line.slice(separator + 1));
    if (target[key] === undefined) {
      target[key] = value;
      loadedKeys.push(key);
    }
  }

  return loadedKeys;
}

/** Load the repository-local .env for development; deployment environment variables still win. */
export function loadProjectEnv(): string[] {
  // Tests must not inherit developer secrets from the repository-local .env.
  if (process.env.NODE_ENV === 'test') return [];

  const envUrl = new URL('../../../../.env', import.meta.url);
  if (!existsSync(envUrl)) return [];
  return applyEnvSource(readFileSync(envUrl, 'utf8'));
}
