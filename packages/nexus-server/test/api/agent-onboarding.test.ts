import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCatalogPromptContract } from '@nexus-ui/core';
import type { CatalogDefinition } from '@nexus-ui/core';
import {
  AGENT_ONBOARDING_CONTRACT_VERSION,
  createAgentOnboardingContract,
} from '../../src/api/agent-onboarding';
import type { CatalogContractPayload } from '../../src/api/routes';
import { createCatalogContractHash } from '../../src/agent/catalog-contract';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * S2.5.5 onboarding 与发布同源：
 * - createAgentOnboardingContract 只接受已校验的 catalog contract payload；
 * - onboarding 内嵌副本与入参隔离，装配后修改入参不能分裂内容/hash；
 * - 本切片不新增必需字段或验收项，onboarding contract 版本保持 1。
 */

function loadFixtureCatalog(name: string): CatalogDefinition {
  const file = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/catalog-v2', name),
    'utf8',
  );
  const parsed = JSON.parse(file) as { catalog: CatalogDefinition };
  return parsed.catalog;
}

const catalog = loadFixtureCatalog('catalog-accept-display-only.json');

function buildCatalogContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serverApiVersion: 1,
    kind: 'catalog-contract',
    contractVersion: 2,
    contractHash: createCatalogContractHash(catalog),
    catalog: structuredClone(catalog),
    promptContract: createCatalogPromptContract(catalog),
    ...overrides,
  };
}

describe('createAgentOnboardingContract 发布一致性', () => {
  it('onboarding contract 版本保持 1', () => {
    assert.equal(AGENT_ONBOARDING_CONTRACT_VERSION, 1);
    const onboarding = createAgentOnboardingContract({
      catalogContract: buildCatalogContract() as unknown as CatalogContractPayload,
    });
    assert.equal(onboarding.contractVersion, 1);
  });

  it('内嵌 catalogContract 为独立副本，装配后修改入参不分裂', () => {
    const catalogContract = buildCatalogContract();
    const onboarding = createAgentOnboardingContract({
      catalogContract: catalogContract as unknown as CatalogContractPayload,
    });
    const embedded = structuredClone(onboarding.catalogContract);

    catalogContract.contractHash = `sha256:${'0'.repeat(64)}`;
    const embeddedCatalog = catalogContract.catalog as { catalogId: string };
    embeddedCatalog.catalogId = 'https://example.com/catalogs/mutated/v9';

    assert.deepEqual(onboarding.catalogContract, embedded);
    assert.equal(onboarding.catalogContract.contractHash, createCatalogContractHash(catalog));
  });

  it('拒绝 hash 与 catalog 内容不一致的 catalog contract', () => {
    assert.throws(
      () =>
        createAgentOnboardingContract({
          catalogContract: buildCatalogContract({
            contractHash: `sha256:${'0'.repeat(64)}`,
          }) as unknown as CatalogContractPayload,
        }),
      /catalog contract/,
    );
  });

  it('拒绝 kind/contractVersion 非法的 catalog contract', () => {
    assert.throws(
      () =>
        createAgentOnboardingContract({
          catalogContract: buildCatalogContract({
            kind: 'not-a-contract',
          }) as unknown as CatalogContractPayload,
        }),
      /catalog contract/,
    );
    assert.throws(
      () =>
        createAgentOnboardingContract({
          catalogContract: buildCatalogContract({
            contractVersion: 1,
          }) as unknown as CatalogContractPayload,
        }),
      /catalog contract/,
    );
  });

  it('拒绝缺失 catalog 或 promptContract 的 catalog contract', () => {
    const missingCatalog = buildCatalogContract();
    delete missingCatalog.catalog;
    assert.throws(
      () =>
        createAgentOnboardingContract({
          catalogContract: missingCatalog as unknown as CatalogContractPayload,
        }),
      /catalog contract/,
    );

    const missingPrompt = buildCatalogContract();
    delete missingPrompt.promptContract;
    assert.throws(
      () =>
        createAgentOnboardingContract({
          catalogContract: missingPrompt as unknown as CatalogContractPayload,
        }),
      /catalog contract/,
    );
  });
});

describe('onboarding 完整契约校验', () => {
  it('拒绝不支持的 serverApiVersion', () => {
    assert.throws(
      () =>
        createAgentOnboardingContract({
          catalogContract: buildCatalogContract({
            serverApiVersion: 999,
          }) as unknown as CatalogContractPayload,
        }),
      /serverApiVersion/,
    );
  });
  it('拒绝 hash 正确但未通过注册闸门的 Catalog', () => {
    const invalid = structuredClone(catalog) as unknown as Record<string, unknown>;
    delete invalid.actions;
    assert.throws(
      () =>
        createAgentOnboardingContract({
          catalogContract: buildCatalogContract({
            catalog: invalid,
            contractHash: createCatalogContractHash(invalid as unknown as CatalogDefinition),
          }) as unknown as CatalogContractPayload,
        }),
      /actions/,
    );
  });
  it('拒绝与声明不一致的非空 prompt', () => {
    assert.throws(
      () =>
        createAgentOnboardingContract({
          catalogContract: buildCatalogContract({
            promptContract: 'unrelated prompt',
          }) as unknown as CatalogContractPayload,
        }),
      /promptContract/,
    );
  });
});
