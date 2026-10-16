/**
 * 媒体 URL 安全判定（协议准入与 React 渲染层共用）。
 *
 * 仅接受经 WHATWG URL 解析后 protocol 为 `http:` / `https:` 的绝对 URL。
 * 用 URL 构造器解析而非字符串前缀匹配：`javascript:`、`data:`、协议相对
 * （`//host/x`）与畸形输入（含大小写、前后空白与控制字符变体，URL 解析
 * 会统一规范化）一律非法。`{ path }` 绑定的真值无法在准入层判定，由渲染层
 * 在解析后复用本判定守卫（参考同范式实现：nexus-server catalog-discovery-client）。
 */
export function isSafeMediaUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}
