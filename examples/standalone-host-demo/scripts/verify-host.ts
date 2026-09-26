import {
  type VerifyHostReport,
  type VerifyOnboardingByDiscoveryReport,
  type VerifyOnboardingReport,
  verifyExternalAgentIntegration,
  verifyExternalAgentOnboarding,
  verifyExternalAgentOnboardingByDiscovery,
} from '../src/host/verify';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const endpoint =
  process.env.NEXUS_VERIFY_AGENT_ENDPOINT ??
  process.env.NEXUS_DEMO_AGENT_ENDPOINT ??
  readArg('--endpoint');

const contractUrl = process.env.NEXUS_VERIFY_ONBOARDING_URL ?? readArg('--contract-url');
const discoveryUrl =
  process.env.NEXUS_DISCOVERY_URL ??
  process.env.NEXUS_VERIFY_DISCOVERY_URL ??
  readArg('--discovery-url');
const catalogId = process.env.NEXUS_VERIFY_CATALOG_ID ?? readArg('--catalog-id');

if (discoveryUrl && contractUrl) {
  console.error(
    [
      'Discovery URL 和 onboarding contract URL 只能选择一个。',
      'Use NEXUS_DISCOVERY_URL or NEXUS_VERIFY_ONBOARDING_URL, not both.',
    ].join('\n'),
  );
  process.exit(2);
}

if (!discoveryUrl && !contractUrl && !endpoint) {
  console.error(
    [
      'Missing discovery URL, external Agent endpoint, or onboarding contract URL.',
      'Set NEXUS_DISCOVERY_URL=https://host.example/api/a2ui/published-catalogs',
      'Set NEXUS_VERIFY_AGENT_ENDPOINT=https://your-agent.example/a2ui',
      'Set NEXUS_VERIFY_ONBOARDING_URL=https://host.example/api/a2ui/agent-onboarding?catalogId=...',
      'or pass one of:',
      '  pnpm --filter @nexus-ui/standalone-host-demo verify -- --discovery-url https://...',
      '  pnpm --filter @nexus-ui/standalone-host-demo verify -- --endpoint https://...',
      '  pnpm --filter @nexus-ui/standalone-host-demo verify -- --contract-url https://...',
    ].join('\n'),
  );
  process.exit(2);
}

try {
  const report: VerifyHostReport | VerifyOnboardingReport | VerifyOnboardingByDiscoveryReport =
    discoveryUrl
      ? await verifyExternalAgentOnboardingByDiscovery({
          discoveryUrl,
          ...(catalogId === undefined ? {} : { catalogId }),
          ...(endpoint === undefined ? {} : { endpoint }),
          message: process.env.NEXUS_VERIFY_MESSAGE ?? '创建营销活动审批任务',
          timeoutMs: Number(process.env.NEXUS_VERIFY_TIMEOUT_MS ?? 30_000),
          discoveryTimeoutMs: Number(process.env.NEXUS_DISCOVERY_TIMEOUT_MS ?? 15_000),
        })
      : contractUrl
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
  if ('discovery' in report) {
    const discoveredReport = report as VerifyOnboardingByDiscoveryReport;
    console.log(`[ok] Discovered catalog: ${discoveredReport.discovery.catalogId}`);
  }
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
