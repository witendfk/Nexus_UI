import { createApp } from './http/app';
import { CatalogContractClient } from './catalog-contract/client';
import { fixtureGeneration } from './a2ui/fixture-source';
import { loadAgentConfig } from './config';

const config = loadAgentConfig();

createApp({
  contractClient: new CatalogContractClient({ hostBaseUrl: config.hostBaseUrl }),
  // T3.4/T3.5 落地后替换为「分析（fixture/model）→ a2ui/compile」真实管线
  generate: fixtureGeneration,
}).listen(config.port, '127.0.0.1', () => {
  console.log(`@orderops/agent-server listening on http://127.0.0.1:${config.port}`);
});
