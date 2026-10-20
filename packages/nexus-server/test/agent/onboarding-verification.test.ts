import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCatalogPromptContract, type CatalogDefinition } from '@nexus-ui/core';
import { createAgentOnboardingContract } from '../../src/api/agent-onboarding';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { verifyExternalAgentOnboarding } from '../../src/agent/onboarding-verification';

const catalog: CatalogDefinition = {
  catalogId: 'https://example.com/catalogs/onboarding-consumer/v2',
  components: { Text: { schema: { type: 'object' } } },
  actions: [],
};

describe('onboarding 消费端与发布端复用完整 Catalog Contract 准入', () => {
  for (const [name, override, pattern] of [
    ['内嵌 serverApiVersion 不支持', { serverApiVersion: 999 }, /serverApiVersion/],
    ['非空 prompt 与 Catalog 不一致', { promptContract: 'unrelated prompt' }, /promptContract/],
    ['缺失 prompt', { promptContract: undefined }, /promptContract/],
    [
      'hash 正确但 Catalog 缺失 actions',
      {
        catalog: { catalogId: catalog.catalogId, components: catalog.components },
        contractHash: createCatalogContractHash({
          catalogId: catalog.catalogId,
          components: catalog.components,
        } as CatalogDefinition),
      },
      /actions/,
    ],
  ] as const) {
    it(`在调用 Agent 前拒绝${name}`, async () => {
      const contract = createAgentOnboardingContract({
        catalogContract: {
          serverApiVersion: 1,
          kind: 'catalog-contract',
          contractVersion: 2,
          catalog,
          contractHash: createCatalogContractHash(catalog),
          promptContract: createCatalogPromptContract(catalog),
        },
        rpcEndpoint: 'https://agent.invalid/rpc',
      });
      const invalid = {
        ...contract,
        catalogContract: { ...contract.catalogContract, ...override },
      };
      let agentCalls = 0;
      await assert.rejects(
        verifyExternalAgentOnboarding({
          contractUrl: 'https://host.invalid/onboarding',
          verifyPolicyRejection: false,
          contractFetch: async () => Response.json(invalid),
          fetch: async (_url, init) => {
            agentCalls++;
            const { surfaceId } = JSON.parse(String(init?.body)) as { surfaceId: string };
            return new Response(
              [
                { version: 'v0.9', createSurface: { surfaceId, catalogId: catalog.catalogId } },
                {
                  version: 'v0.9',
                  updateComponents: {
                    surfaceId,
                    components: [{ id: 'root', component: 'Text', text: 'Ready' }],
                  },
                },
              ]
                .map((message) => JSON.stringify(message))
                .join('\n') + '\n',
              {
                headers: { 'Content-Type': 'application/x-ndjson' },
              },
            );
          },
        }),
        pattern,
      );
      assert.equal(agentCalls, 0);
    });
  }
});
