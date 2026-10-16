/**
 * S1 证伪测试：Catalog schema.pattern 的注册闸门与有界匹配。
 *
 * 修复前：注册只查「能被原生 RegExp 编译」；匹配用裸 `new RegExp(schema.pattern).test(value)`，
 * `(a+)+$` / `(a|aa)+$` 类歧义 pattern 在失败值上指数回溯。
 * 修复后：注册增加与 checks 路径一致的长度上限与嵌套量词拒绝；匹配走
 * compileSafeRegExp（Thompson NFA 线性引擎），编译失败产生 schema 诊断。
 */
import { expect } from 'chai';
import {
  validateComponentPropsDiagnostics,
  validateComponentSchema,
} from '../../src/catalog/schema';
import type { Component } from '../../src/protocol/types';

const widget = (props: Record<string, unknown>): Component =>
  ({ id: 'w1', component: 'Widget', ...props }) as unknown as Component;

describe('catalog schema · pattern 注册闸门', () => {
  const schemaWithPattern = (pattern: string): unknown => ({
    type: 'object',
    properties: { code: { type: 'string', pattern } },
  });

  it('嵌套量词 pattern 注册显式报错', () => {
    expect(() => validateComponentSchema(schemaWithPattern('(a+)+$'), 'Widget')).to.throw(
      /含嵌套量词/,
    );
  });

  it('超长 pattern 注册显式报错（上限与 checks 口径一致）', () => {
    expect(() => validateComponentSchema(schemaWithPattern('a'.repeat(201)), 'Widget')).to.throw(
      /长度不得超过 200/,
    );
  });

  it('非法 pattern 注册报错（既有行为保留）', () => {
    expect(() => validateComponentSchema(schemaWithPattern('['), 'Widget')).to.throw(
      /必须是合法正则表达式/,
    );
  });

  it('合法 pattern 注册通过', () => {
    expect(() => validateComponentSchema(schemaWithPattern('^[a-z]+$'), 'Widget')).to.not.throw();
  });
});

describe('catalog schema · pattern 匹配走有界引擎', () => {
  it('引擎不支持的 pattern（环视）产生「无法求值」诊断而非静默通过', () => {
    const diagnostics = validateComponentPropsDiagnostics(widget({ code: 'xb' }), {
      type: 'object',
      properties: { code: { type: 'string', pattern: '(?=a)b' } },
    });
    expect(diagnostics.some((d) => d.message.includes('无法求值'))).to.equal(true);
  });

  it('歧义 pattern（原生指数回溯）在失败值上快速返回不符合诊断', () => {
    const diagnostics = validateComponentPropsDiagnostics(widget({ code: `${'a'.repeat(60)}b` }), {
      type: 'object',
      properties: { code: { type: 'string', pattern: '(a|aa)+$' } },
    });
    expect(diagnostics.some((d) => d.message.includes('不符合 schema.pattern'))).to.equal(true);
  });

  it('合规 pattern 判定结果与语义一致（通过/不通过）', () => {
    const schema = {
      type: 'object',
      properties: { code: { type: 'string', pattern: '^[a-z]+$' } },
    } as const;
    expect(validateComponentPropsDiagnostics(widget({ code: 'abc' }), schema)).to.deep.equal([]);
    expect(
      validateComponentPropsDiagnostics(widget({ code: 'a1' }), schema).some((d) =>
        d.message.includes('不符合 schema.pattern'),
      ),
    ).to.equal(true);
  });
});
