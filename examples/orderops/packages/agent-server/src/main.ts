import { createApp } from './http/app';
import { CatalogContractClient } from './catalog-contract/client';
import { CaseContextClient } from './tools/case-context';
import { createAnalysisGeneration } from './a2ui/generate';
import { analyzeCase } from './analysis/engine';
import { ModelClient } from './analysis/model-client';
import { loadAgentConfig } from './config';

const config = loadAgentConfig();
const contextClient = new CaseContextClient({
  hostBaseUrl: config.hostBaseUrl,
  internalToken: config.internalToken,
});

createApp({
  contractClient: new CatalogContractClient({ hostBaseUrl: config.hostBaseUrl }),
  generate: createAnalysisGeneration({
    contextClient,
    analyze: (context, promptContract) =>
      analyzeCase(context, {
        mode: config.mode,
        attempts: config.analysisAttempts,
        promptContract,
        model:
          config.mode === 'model'
            ? new ModelClient({
                baseUrl: config.model.baseUrl,
                apiKey: config.model.apiKey,
                model: config.model.model,
                timeoutMs: config.model.timeoutMs,
              })
            : undefined,
      }),
  }),
}).listen(config.port, '127.0.0.1', () => {
  console.log(
    `@orderops/agent-server listening on http://127.0.0.1:${config.port} (mode=${config.mode})`,
  );
});
