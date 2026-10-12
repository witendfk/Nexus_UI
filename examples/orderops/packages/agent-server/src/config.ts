export type AgentMode = 'deterministic' | 'model';

export interface AgentConfig {
  port: number;
  /** 宿主服务基址：catalog-contract 与内部只读工具都在宿主侧。 */
  hostBaseUrl: string;
  /** /internal/* 共享鉴权 token；空串时 case-context 客户端 fail-closed 拒绝调用。 */
  internalToken: string;
  /** 分析模式：deterministic 为 CI 默认；model 接真实模型（单独冒烟，docs/SPEC.md §3）。 */
  mode: AgentMode;
  model: {
    /** OpenAI 兼容 chat/completions 基址，如 https://api.openai.com/v1。 */
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
  };
  /** 模型输出的最大尝试次数（schema 非法/证据越界都计一次）。 */
  analysisAttempts: number;
}

function requirePositive(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`配置非法：${key} 必须是正整数，当前为 ${String(raw)}`);
  }
  return value;
}

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const mode: AgentMode = env.ORDEROPS_AGENT_MODE === 'model' ? 'model' : 'deterministic';
  if (env.ORDEROPS_AGENT_MODE !== undefined && env.ORDEROPS_AGENT_MODE !== 'model' && env.ORDEROPS_AGENT_MODE !== 'deterministic') {
    throw new Error(`配置非法：ORDEROPS_AGENT_MODE 只支持 deterministic|model，当前为 ${env.ORDEROPS_AGENT_MODE}`);
  }
  const model = {
    baseUrl: env.ORDEROPS_MODEL_BASE_URL ?? '',
    apiKey: env.ORDEROPS_MODEL_API_KEY ?? '',
    model: env.ORDEROPS_MODEL_NAME ?? '',
    timeoutMs: requirePositive(env, 'ORDEROPS_MODEL_TIMEOUT_MS', 60_000),
  };
  if (mode === 'model' && (model.baseUrl === '' || model.apiKey === '' || model.model === '')) {
    throw new Error('配置非法：ORDEROPS_AGENT_MODE=model 需要 ORDEROPS_MODEL_BASE_URL / ORDEROPS_MODEL_API_KEY / ORDEROPS_MODEL_NAME 全部就绪');
  }
  return {
    port: Number(env.PORT ?? 3202),
    hostBaseUrl: env.ORDEROPS_HOST_URL ?? 'http://127.0.0.1:3201',
    internalToken: env.ORDEROPS_INTERNAL_TOKEN ?? '',
    mode,
    model,
    analysisAttempts: requirePositive(env, 'ORDEROPS_ANALYSIS_ATTEMPTS', 2),
  };
}
