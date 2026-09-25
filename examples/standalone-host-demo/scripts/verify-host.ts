import { verifyExternalAgentIntegration } from '../src/host/verify';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const endpoint =
  process.env.NEXUS_VERIFY_AGENT_ENDPOINT ??
  process.env.NEXUS_DEMO_AGENT_ENDPOINT ??
  readArg('--endpoint');

if (!endpoint) {
  console.error(
    [
      'Missing external Agent endpoint.',
      'Set NEXUS_VERIFY_AGENT_ENDPOINT=https://your-agent.example/a2ui',
      'or pass: pnpm --filter @nexus-ui/standalone-host-demo verify -- --endpoint https://...',
    ].join('\n'),
  );
  process.exit(2);
}

try {
  const report = await verifyExternalAgentIntegration({
    endpoint,
    message: process.env.NEXUS_VERIFY_MESSAGE ?? '创建营销活动审批任务',
    timeoutMs: Number(process.env.NEXUS_VERIFY_TIMEOUT_MS ?? 30_000),
  });

  console.log('[ok] Nexus host integration verified');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error('[failed] Nexus host integration');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
