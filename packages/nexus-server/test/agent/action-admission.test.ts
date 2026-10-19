import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  standardCatalogComponentDeclarations,
  type CatalogDefinition,
  type Component,
} from '@nexus-ui/core';
import {
  admitAction,
  createEditablePathWhitelist,
  normalizeJsonPointer,
  rejectUndeclaredClientContext,
  validateActionParams,
} from '../../src/agent/action-admission';
import type { SurfaceActionSnapshot } from '../../src/agent/surface-action-state';

const HASH = 'sha256:' + 'a'.repeat(64);

/** 双绑定夹具 Catalog：标准输入 + 自定义评分（非 value 属性）+ 嵌套路径组件。 */
function hostCatalog(): CatalogDefinition {
  return {
    catalogId: 'host',
    components: {
      ...standardCatalogComponentDeclarations(),
      RatingInput: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { score: { type: 'integer', dynamic: 'required' } },
        },
        inputs: { score: { type: 'integer', minimum: 1, maximum: 5 } },
      },
      ProfileEditor: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', dynamic: 'allowed' },
            city: { type: 'string', dynamic: 'allowed' },
          },
        },
        inputs: { name: { type: 'string', minLength: 1 } },
      },
    },
    actions: [
      {
        name: 'rate',
        sources: ['RatingInput'],
        paramSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['score'],
          properties: { score: { type: 'integer', minimum: 1, maximum: 5 } },
        },
      },
      { name: 'submit', sources: ['Button', 'ProfileEditor'] },
    ],
  };
}

function snapshotOf(
  components: readonly Component[],
  dataModel: unknown,
  overrides: Partial<SurfaceActionSnapshot> = {},
): SurfaceActionSnapshot {
  return {
    surfaceId: 's',
    catalogId: 'host',
    version: 1,
    epoch: 1,
    components: new Map(components.map((component) => [component.id, component])),
    dataModel,
    contract: { catalogHash: HASH, contractVersion: 2, catalog: hostCatalog() },
    ...overrides,
  };
}

const RATING = {
  id: 'r1',
  component: 'RatingInput',
  score: { path: '/score' },
  action: { event: { name: 'rate', context: { score: { path: '/score' } } } },
} as unknown as Component;

function strictNexus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionVersion: 1,
    actionId: 'a-1',
    surfaceRevision: 1,
    catalogHash: HASH,
    inputs: [],
    ...overrides,
  };
}

function admit(
  snapshot: SurfaceActionSnapshot,
  request: Record<string, unknown>,
  editable: readonly string[] = ['/score', '/profile', '/profile/name'],
) {
  // 单元夹具默认 actionId 与 strictNexus 对齐；显式传入的用例（不一致反例）优先
  const normalized = { actionId: 'a-1', ...request };
  return admitAction(
    {
      snapshot,
      editablePaths: createEditablePathWhitelist(editable),
    },
    normalized as unknown as Parameters<typeof admitAction>[1],
  );
}

describe('normalizeJsonPointer / createEditablePathWhitelist（可信装配配置）', () => {
  it('指针语法不把对象键误判为数组；数组下标在实际容器上检查', () => {
    assert.throws(() => normalizeJsonPointer('/'));
    assert.equal(normalizeJsonPointer('/obj/01'), '/obj/01');
  });

  it('绝对指针与转义归一：~1 键与嵌套键不碰撞，非法转义抛错', () => {
    assert.equal(normalizeJsonPointer('/a/b'), '/a/b');
    assert.equal(normalizeJsonPointer('/a~1b'), '/a~1b');
    assert.notEqual(normalizeJsonPointer('/a~1b'), normalizeJsonPointer('/a/b'));
    assert.equal(normalizeJsonPointer('/a~0b'), '/a~0b');
    assert.throws(() => normalizeJsonPointer(''), /空串根指针/);
    assert.throws(() => normalizeJsonPointer('a/b'), /绝对 JSON Pointer/);
    assert.throws(() => normalizeJsonPointer('/a~2b'), /非法转义/);
    assert.throws(() => normalizeJsonPointer('/a~'), /非法转义/);
  });

  it('白名单规范化后重复即配置错误；嵌套重叠合法；非数组抛错', () => {
    assert.throws(() => createEditablePathWhitelist(['/a', '/a']), /重复/);
    assert.doesNotThrow(() => createEditablePathWhitelist(['/profile', '/profile/name']));
    assert.throws(() => createEditablePathWhitelist(undefined as never), /字符串数组/);
  });
});

describe('admitAction：nexus 与 action 来源核对', () => {
  const snapshot = snapshotOf([RATING], { score: 3 });

  it('严格入口缺失 nexus 显式拒绝（旧格式不解释）', () => {
    const result = admit(snapshot, {
      name: 'rate',
      surfaceId: 's',
      sourceComponentId: 'r1',
      context: {},
    });
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, 'nexus-invalid');
  });

  it('sessionVersion 非 1、actionId 不一致分别拒绝', () => {
    const bad = admit(snapshot, {
      name: 'rate',
      surfaceId: 's',
      sourceComponentId: 'r1',
      context: {},
      nexus: strictNexus({ sessionVersion: 2 }),
    });
    assert.equal((bad as { code: string }).code, 'nexus-invalid');

    const mismatch = admit(snapshot, {
      name: 'rate',
      surfaceId: 's',
      sourceComponentId: 'r1',
      context: {},
      actionId: 'other',
      nexus: strictNexus(),
    });
    assert.equal((mismatch as { code: string }).code, 'nexus-invalid');
  });

  it('nexus.inputs 非数组显式拒绝（不得静默忽略）', () => {
    const result = admit(snapshot, {
      name: 'rate',
      surfaceId: 's',
      sourceComponentId: 'r1',
      context: {},
      nexus: strictNexus({ inputs: 'score=9' }),
    });
    assert.equal((result as { code: string }).code, 'nexus-invalid');
  });

  it('surfaceRevision 与快照 version 不一致拒绝（正安全整数校验）', () => {
    for (const surfaceRevision of [2, 0, -1, 1.5]) {
      const result = admit(snapshot, {
        name: 'rate',
        surfaceId: 's',
        sourceComponentId: 'r1',
        context: {},
        nexus: strictNexus({ surfaceRevision }),
      });
      assert.equal((result as { code: string }).code, 'revision-mismatch', String(surfaceRevision));
    }
  });

  it('catalogHash 与快照固定值不一致拒绝；快照未固定契约时拒绝核对', () => {
    const mismatch = admit(snapshot, {
      name: 'rate',
      surfaceId: 's',
      sourceComponentId: 'r1',
      context: {},
      nexus: strictNexus({ catalogHash: 'sha256:' + 'b'.repeat(64) }),
    });
    assert.equal((mismatch as { code: string }).code, 'hash-mismatch');
  });

  it('action 未声明、sources 越权分别拒绝', () => {
    const unknownAction = admit(snapshot, {
      name: 'ghost',
      surfaceId: 's',
      sourceComponentId: 'r1',
      context: {},
      nexus: strictNexus(),
    });
    assert.equal((unknownAction as { code: string }).code, 'undeclared');

    // 组件携带 rate 事件但组件名不在 sources（防御性核对：生成 guard 之外的直达调用）
    const crossSourceSnapshot = snapshotOf(
      [
        RATING,
        { id: 'imposter', component: 'Button', action: { event: { name: 'rate' } } },
      ] as unknown as Component[],
      { score: 3 },
    );
    const crossSource = admit(crossSourceSnapshot, {
      name: 'rate',
      surfaceId: 's',
      sourceComponentId: 'imposter',
      context: {},
      nexus: strictNexus(),
    });
    assert.equal((crossSource as { code: string }).code, 'undeclared');
  });

  it('严格入口全绿通过且参数从临时模型重算；已提交模型不变', () => {
    const result = admit(snapshot, {
      name: 'rate',
      surfaceId: 's',
      sourceComponentId: 'r1',
      context: { score: 'client 值不作为权威' },
      nexus: strictNexus({ inputs: [{ componentId: 'r1', property: 'score', value: 4 }] }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual((result as { params: unknown }).params, { score: 4 });
    assert.deepEqual(snapshot.dataModel, { score: 3 }, '临时模型不得写回快照');
  });
});

describe('admitAction：浏览器输入整批校验', () => {
  const snapshot = snapshotOf(
    [
      RATING,
      { id: 'r2', component: 'RatingInput', score: { path: '/score' } },
      {
        id: 'panel',
        component: 'ProfileEditor',
        name: { path: '/profile/name' },
        city: { path: '/profile/city' },
      },
      { id: 'lit', component: 'TextField', value: 'literal' },
      { id: 'unsafe', component: 'TextField', label: 'x', value: { path: '/a/__proto__/x' } },
    ] as unknown as Component[],
    { score: 3, profile: { name: 'n', city: 'c' }, a: {} },
  );

  const base = { name: 'rate', surfaceId: 's', sourceComponentId: 'r1', context: {} };

  function inputCase(inputs: readonly unknown[]) {
    return admit(snapshot, { ...base, nexus: strictNexus({ inputs }) });
  }

  it('伪造写路径（额外键）、缺失键、非对象项均拒绝', () => {
    assert.equal(
      (
        inputCase([{ componentId: 'r1', property: 'score', value: 4, path: '/config' }]) as {
          code: string;
        }
      ).code,
      'input-invalid',
    );
    assert.equal(
      (inputCase([{ componentId: 'r1', property: 'score' }]) as { code: string }).code,
      'input-invalid',
    );
    assert.equal((inputCase(['score']) as { code: string }).code, 'input-invalid');
  });

  it('未提交组件、未声明属性、字面值缺绑定分别拒绝', () => {
    assert.equal(
      (inputCase([{ componentId: 'ghost', property: 'score', value: 4 }]) as { code: string }).code,
      'undeclared',
    );
    assert.equal(
      (inputCase([{ componentId: 'r1', property: 'level', value: 4 }]) as { code: string }).code,
      'undeclared',
    );
    // TextField.inputs.value 已声明，但组件侧是字面值、无 { path } 绑定可写
    assert.equal(
      (inputCase([{ componentId: 'lit', property: 'value', value: 'x' }]) as { code: string }).code,
      'input-invalid',
    );
  });

  it('只读绑定属性（未在 inputs 声明）拒绝；危险路径拒绝', () => {
    // city 在 schema 中可绑定但不在 inputs 中：只读，不得写回
    const readOnly = admit(snapshot, {
      ...base,
      nexus: strictNexus({ inputs: [{ componentId: 'panel', property: 'city', value: 'x' }] }),
    });
    assert.equal((readOnly as { code: string }).code, 'undeclared');
    assert.equal(
      (inputCase([{ componentId: 'unsafe', property: 'value', value: 'x' }]) as { code: string })
        .code,
      'path-forbidden',
    );
  });

  it('白名单精确匹配：未列入路径拒绝，嵌套重叠各自可写', () => {
    const outside = admit(
      snapshot,
      {
        ...base,
        nexus: strictNexus({ inputs: [{ componentId: 'panel', property: 'name', value: 'x' }] }),
      },
      ['/score'],
    );
    assert.equal((outside as { code: string }).code, 'path-forbidden');

    const nested = admit(
      snapshotOf(
        [
          {
            id: 'editor',
            component: 'ProfileEditor',
            name: { path: '/profile/name' },
            action: { event: { name: 'submit' } },
          },
        ] as unknown as Component[],
        { profile: { name: 'n' } },
      ),
      {
        name: 'submit',
        surfaceId: 's',
        sourceComponentId: 'editor',
        context: {},
        actionId: 'a-2',
        nexus: strictNexus({
          actionId: 'a-2',
          inputs: [{ componentId: 'editor', property: 'name', value: 'x' }],
        }),
      },
      ['/profile', '/profile/name'],
    );
    assert.equal(nested.ok, true, nested.ok ? '' : nested.message);
  });

  it('值 schema 违规拒绝并携带诊断；重复（同组件同属性）拒绝', () => {
    const schema = inputCase([{ componentId: 'r1', property: 'score', value: 9 }]);
    assert.equal((schema as { code: string }).code, 'input-schema');
    const failure = schema as unknown as { diagnostics?: unknown[] };
    assert.ok(failure.diagnostics && failure.diagnostics.length > 0);
    assert.equal(
      (
        inputCase([
          { componentId: 'r1', property: 'score', value: 4 },
          { componentId: 'r1', property: 'score', value: 5 },
        ]) as { code: string }
      ).code,
      'input-conflict',
    );
  });

  it('同目标路径与祖先/后代冲突均拒绝，且与数组顺序无关', () => {
    const samePath = [
      [
        { componentId: 'r1', property: 'score', value: 4 },
        { componentId: 'r2', property: 'score', value: 5 },
      ],
      [
        { componentId: 'r2', property: 'score', value: 5 },
        { componentId: 'r1', property: 'score', value: 4 },
      ],
    ] as const;
    for (const [index, inputs] of samePath.entries()) {
      assert.equal(
        (inputCase(inputs) as { code: string }).code,
        'input-conflict',
        `order ${index}`,
      );
    }
  });

  it('未变化输入幂等合法（普通写回）', () => {
    const result = inputCase([{ componentId: 'r1', property: 'score', value: 3 }]);
    assert.equal(result.ok, true, result.ok ? '' : result.message);
  });
});

describe('admitAction：参数校验与兼容入口', () => {
  it('重算参数按返回值交付，paramSchema 校验由调用方在最终参数上适用', () => {
    // 模型含越界值：admitAction 返回重算参数（不在此否决），validateActionParams 判违例
    const violating = admit(snapshotOf([RATING], { score: 9 }), {
      name: 'rate',
      surfaceId: 's',
      sourceComponentId: 'r1',
      context: {},
      nexus: strictNexus(),
    });
    assert.equal(violating.ok, true, violating.ok ? '' : violating.message);
    const declaration = hostCatalog().actions[0];
    assert.match(
      validateActionParams(
        (violating as { params: Record<string, unknown> }).params,
        declaration,
      ) ?? '',
      /action\.params\.score/,
    );
    assert.equal(validateActionParams({ score: 3 }, declaration), null);
  });

  it('缺失 nexus 或部分缺元数据一律拒绝：不存在「缺元数据则跳过」的兼容旁路', () => {
    const snapshot = snapshotOf([RATING], { score: 3 });
    const missing = admit(snapshot, {
      name: 'rate',
      surfaceId: 's',
      sourceComponentId: 'r1',
      context: {},
    });
    assert.equal((missing as { code: string }).code, 'nexus-invalid');

    const partial = admit(snapshot, {
      name: 'rate',
      surfaceId: 's',
      sourceComponentId: 'r1',
      context: {},
      nexus: { inputs: [{ componentId: 'r1', property: 'score', value: 4 }] },
    });
    assert.equal((partial as { code: string }).code, 'nexus-invalid');
  });
});

describe('validateActionParams / rejectUndeclaredClientContext', () => {
  it('paramSchema 缺省即参数必须为空对象；客户端未声明键被点名', () => {
    assert.equal(validateActionParams({}, undefined), null);
    assert.match(validateActionParams({ a: 1 }, undefined) ?? '', /必须为空对象/);
    const declaration = { context: { score: { path: '/score' } } };
    assert.equal(rejectUndeclaredClientContext(declaration as never, { score: 1 }), null);
    assert.match(
      rejectUndeclaredClientContext(declaration as never, { score: 1, hack: true }) ?? '',
      /hack/,
    );
  });
});
