import { createDemoHostApp } from '../src/host';

const port = Number(process.env.NEXUS_DEMO_HOST_PORT ?? 3101);
const agentPort = Number(process.env.NEXUS_DEMO_AGENT_PORT ?? 3102);
const endpoint = process.env.NEXUS_DEMO_AGENT_ENDPOINT ?? `http://127.0.0.1:${agentPort}/agent`;

createDemoHostApp({ endpoint, timeoutMs: 60_000 }).listen(port, '127.0.0.1', () => {
  console.log(`Standalone demo host API: http://127.0.0.1:${port}`);
});
