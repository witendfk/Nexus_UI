import { verifyExternalAgentIntegration, verifyExternalAgentOnboarding } from '../src/host/verify';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const endpoint =
  process.env.NEXUS_VERIFY_AGENT_ENDPOINT ??
  process.env.NEXUS_DEMO_AGENT_ENDPOINT ??
  readArg('--endpoint');

const contractUrl = process.env.NEXUS_VERIFY_ONBOARDING_URL ?? readArg('--contract-url');

if (!contractUrl && !endpoint) {
  console.error(
    [
      'Missing external Agent endpoint or onboarding contract URL.',
      'Set NEXUS_VERIFY_AGENT_ENDPOINT=https://your-agent.example/a2ui',
      'Set NEXUS_VERIFY_ONBOARDING_URL=https://host.example/api/a2ui/agent-onboarding?catalogId=...',
      'or pass one of:',
      '  pnpm --filter @nexus-ui/standalone-host-demo verify -- --endpoint https://...',
      '  pnpm --filter @nexus-ui/standalone-host-demo verify -- --contract-url https://...',
    ].join('\n'),
  );
  process.exit(2);
}

try {
  const report = contractUrl
    ? await verifyExternalAgentOnboarding({
        contractUrl,
        ...(endpoint === undefined ? {} : { endpoint }),
        message: process.env.NEXUS_VERIFY_MESSAGE ?? '创建营销活动审批任务',
        timeoutMs: Number(process.env.NEXUS_VERIFY_TIMEOUT_MS ?? 30_000),
      })
    : await verifyExternalAgentIntegration({
        endpoint: endpoint as string,
        message: process.env.NEXUS_VERIFY_MESSAGE ?? '创建营销活动审批任务',
        timeoutMs: Number(process.env.NEXUS_VERIFY_TIMEOUT_MS ?? 30_000),
      });

  console.log('[ok] Nexus host integration verified');
  const passedChecks = report.checks.filter((check) => check.status === 'passed').length;
  const skippedChecks = report.checks.length - passedChecks;
  console.log(
    `[ok] Agent onboarding checks: ${passedChecks}/${report.checks.length} passed` +
      (skippedChecks === 0 ? '' : ` (${skippedChecks} skipped)`),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error('[failed] Nexus host integration');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
