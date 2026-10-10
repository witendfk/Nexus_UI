export interface AgentConfig {
  port: number;
  /** 宿主服务基址：catalog-contract 与内部只读工具都在宿主侧。 */
  hostBaseUrl: string;
  /** /internal/* 共享鉴权 token（T3.4 case-context 工具用）。 */
  internalToken: string;
}

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    port: Number(env.PORT ?? 3202),
    hostBaseUrl: env.ORDEROPS_HOST_URL ?? 'http://127.0.0.1:3201',
    internalToken: env.ORDEROPS_INTERNAL_TOKEN ?? '',
  };
}
