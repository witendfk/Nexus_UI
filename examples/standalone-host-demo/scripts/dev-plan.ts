export interface DemoProcessPlan {
  name: 'agent' | 'host' | 'web';
  command: string;
  args: string[];
}

type DemoProcessEnv = Readonly<Record<string, string | undefined>>;

const agentProcess: DemoProcessPlan = {
  name: 'agent',
  command: 'pnpm',
  args: ['exec', 'tsx', 'scripts/run-agent.ts'],
};

const hostProcess: DemoProcessPlan = {
  name: 'host',
  command: 'pnpm',
  args: ['exec', 'tsx', 'scripts/run-host.ts'],
};

const webProcess: DemoProcessPlan = {
  name: 'web',
  command: 'pnpm',
  args: ['exec', 'vite'],
};

export function createDemoProcessPlan(env: DemoProcessEnv = process.env): DemoProcessPlan[] {
  const hasExternalAgent = Boolean(env.NEXUS_DEMO_AGENT_ENDPOINT?.trim());
  return hasExternalAgent ? [hostProcess, webProcess] : [agentProcess, hostProcess, webProcess];
}
