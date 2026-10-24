import { CatalogRegistry, type NexusSurfaceCommit } from '@nexus-ui/core';
import { createCatalogContractHash } from '../agent/catalog-contract';
import { assertRunCommit } from '../agent/run-manager';
import type { RunDiagnosticReporter } from '../agent/run-diagnostic';
import type {
  SurfaceActionContract,
  SurfaceActionSnapshot,
  SurfaceCommitResult,
} from '../agent/surface-action-state';
import { RunTaskError, UnknownCommitError } from './run-handle';

/** Store confirmation is a runtime boundary, including for typed host implementations. */
export async function commitSurface(
  write: () => Promise<SurfaceCommitResult>,
  expected: {
    runId: string;
    surfaceId: string;
    catalogId: string;
    contract: SurfaceActionContract;
    baseline?: Pick<SurfaceActionSnapshot, 'version' | 'epoch'>;
  },
  report: RunDiagnosticReporter,
): Promise<NexusSurfaceCommit> {
  let raw: unknown;
  try {
    raw = await write();
  } catch (error) {
    throw new UnknownCommitError(errorMessage(error));
  }

  let result:
    | Exclude<SurfaceCommitResult, { outcome: 'committed' }>
    | { outcome: 'committed'; commit: NexusSurfaceCommit };
  try {
    if (!isRecord(raw)) throw new Error('store 提交结果必须为对象');
    if (raw.outcome === 'notCommitted') {
      if (typeof raw.reason !== 'string') throw new Error('notCommitted 缺少拒绝原因');
      result = { outcome: 'notCommitted', reason: raw.reason };
    } else if (raw.outcome === 'unknown') {
      if (raw.reason !== undefined && typeof raw.reason !== 'string')
        throw new Error('unknown 原因必须为字符串');
      result = { outcome: 'unknown', reason: raw.reason };
    } else if (raw.outcome === 'committed') {
      const snapshot = raw.snapshot;
      if (!isRecord(snapshot) || !isRecord(snapshot.contract))
        throw new Error('committed 缺少完整快照/契约');
      const contract = snapshot.contract;
      const catalog = contract.catalog;
      if (!isRecord(catalog) || catalog.catalogId !== expected.catalogId)
        throw new Error('快照 Catalog 身份不一致');
      // 注册闸门与 hash 核对共用既有实现，不能仅信任快照携带的 hash 字符串。
      const registry = new CatalogRegistry([
        catalog as unknown as SurfaceActionContract['catalog'],
      ]);
      const fixedCatalog = registry.require(expected.catalogId);
      if (
        contract.contractVersion !== expected.contract.contractVersion ||
        contract.catalogHash !== expected.contract.catalogHash ||
        createCatalogContractHash(fixedCatalog) !== expected.contract.catalogHash
      ) {
        throw new Error('快照执行契约与本次提交不一致');
      }
      if (!positiveInteger(snapshot.epoch) || !positiveInteger(snapshot.version))
        throw new Error('快照 epoch/revision 非法');
      if (
        expected.baseline &&
        (snapshot.epoch !== expected.baseline.epoch ||
          snapshot.version <= expected.baseline.version)
      ) {
        throw new Error('action 快照 epoch/revision 未遵循提交基准');
      }
      if (!(snapshot.components instanceof Map) || !snapshot.components.has('root'))
        throw new Error('快照缺少 root 组件');
      for (const [id, component] of snapshot.components) {
        if (
          typeof id !== 'string' ||
          !isRecord(component) ||
          component.id !== id ||
          typeof component.component !== 'string' ||
          !Object.prototype.hasOwnProperty.call(fixedCatalog.components, component.component)
        ) {
          throw new Error('快照组件结构非法');
        }
      }
      // 固定提交的形状与 run/surface/Catalog 身份仍由所有运行共用的闸门核对。
      const fixed = assertRunCommit(
        {
          sessionVersion: 1,
          runId: expected.runId,
          surfaceId: snapshot.surfaceId,
          catalogId: snapshot.catalogId,
          contractVersion: contract.contractVersion,
          catalogHash: contract.catalogHash,
          surfaceRevision: snapshot.version,
        },
        { id: expected.runId, ...expected, catalogHash: expected.contract.catalogHash },
      );
      result = { outcome: 'committed', commit: fixed };
    } else {
      throw new Error('store 提交 outcome 非法');
    }
  } catch (error) {
    report('commit-identity', errorMessage(error));
    throw new UnknownCommitError(`store 提交确认非法: ${errorMessage(error)}`);
  }
  if (result.outcome === 'notCommitted') throw new RunTaskError('RUN_FAILED', result.reason);
  if (result.outcome === 'unknown')
    throw new UnknownCommitError(result.reason ?? 'store 提交结果不确定');
  return result.commit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
