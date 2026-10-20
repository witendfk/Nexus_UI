import {
  CatalogRegistry,
  createCatalogPromptContract,
  type CatalogDefinition,
} from '@nexus-ui/core';
import { SERVER_API_VERSION } from '../version';
import type { CatalogContractPayload } from '../api/routes';
import {
  CATALOG_CONTRACT_VERSION,
  createCatalogContractHash,
  isCatalogContractHash,
} from './catalog-contract';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * onboarding 发布与消费共用的内部准入：完整注册规则、版本、hash 与标准
 * prompt 必须一致。只复用 core 注册闸门和现有 hash/prompt 实现，不维护
 * 第二套能力解释器，也不扩展 server 公开根入口。
 */
export function assertValidCatalogContractPayload(
  payload: unknown,
): asserts payload is CatalogContractPayload {
  const label = 'agent onboarding 的 catalog contract 无效';
  if (!isRecord(payload)) throw new Error(`${label}: 必须是 catalog contract 对象`);
  if (payload.serverApiVersion !== SERVER_API_VERSION) {
    throw new Error(`${label}: serverApiVersion 必须是 ${SERVER_API_VERSION}`);
  }
  if (payload.kind !== 'catalog-contract') {
    throw new Error(`${label}: kind 必须是 catalog-contract`);
  }
  if (payload.contractVersion !== CATALOG_CONTRACT_VERSION) {
    throw new Error(`${label}: contractVersion 必须是 ${CATALOG_CONTRACT_VERSION}`);
  }
  if (!isCatalogContractHash(payload.contractHash)) {
    throw new Error(
      `${label}: Catalog contract hash 不匹配（contractHash 必须是 sha256:<64 hex> 格式）`,
    );
  }
  if (
    !isRecord(payload.catalog) ||
    typeof payload.catalog.catalogId !== 'string' ||
    payload.catalog.catalogId === ''
  ) {
    throw new Error(`${label}: catalog 必须是带非空 catalogId 的对象`);
  }
  // 类型收窄的事实由下面的运行时注册闸门建立，不能仅信任 JSON 类型断言。
  const catalog = payload.catalog as unknown as CatalogDefinition;
  new CatalogRegistry([catalog]);
  if (payload.promptContract !== createCatalogPromptContract(catalog)) {
    throw new Error(`${label}: promptContract 与 catalog 内容不一致`);
  }
  if (typeof payload.promptContract !== 'string' || payload.promptContract === '') {
    throw new Error(`${label}: promptContract 必须是非空字符串`);
  }
  if (payload.contractHash !== createCatalogContractHash(catalog)) {
    throw new Error(`${label}: Catalog contract hash 不匹配（contractHash 与 catalog 内容不一致）`);
  }
}
