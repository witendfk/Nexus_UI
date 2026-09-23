import { createDemoAgentServer } from '../src/agent';
import { loadDemoProjectEnv } from '../src/env';

loadDemoProjectEnv();

if (process.env.NEXUS_DEMO_AGENT_MODE !== 'deterministic' && !process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not configured.');
  process.exit(1);
}

const port = Number(process.env.NEXUS_DEMO_AGENT_PORT ?? 3102);
createDemoAgentServer().listen(port, '127.0.0.1', () => {
  console.log(`Standalone demo Agent: http://127.0.0.1:${port}/agent`);
});
