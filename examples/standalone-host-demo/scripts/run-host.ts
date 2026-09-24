import { createDemoHostApp } from '../src/host';
import {
  resolveStandaloneHostActionMode,
  type StandaloneHostActionMode,
} from '../src/shared/action-mode';

const port = Number(process.env.NEXUS_DEMO_HOST_PORT ?? 3101);
const agentPort = Number(process.env.NEXUS_DEMO_AGENT_PORT ?? 3102);
const endpoint = process.env.NEXUS_DEMO_AGENT_ENDPOINT ?? `http://127.0.0.1:${agentPort}/agent`;
let actionMode: StandaloneHostActionMode;
try {
  actionMode = resolveStandaloneHostActionMode(process.env.NEXUS_DEMO_ACTION_MODE);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

createDemoHostApp({ endpoint, actionMode, timeoutMs: 60_000 }).listen(port, '127.0.0.1', () => {
  console.log(`Standalone demo host API: http://127.0.0.1:${port}`);
});
